/**
 * Shopify historical order backfill — deepen the per-SKU sales reference.
 *
 * The reorder engine + COGS read sales_order_lines, but the app only started
 * capturing Shopify orders ~Feb 2026 (~4.5 months), so there is no seasonality
 * to lean on. Shopify itself retains the full order history (verified: 25+
 * months, the October peak is 2-3x the summer trough). QuickBooks can't help
 * (single "Sales" catch-all item). This pulls real historical orders straight
 * from Shopify into sales_order_lines, per-SKU, so velocity/COGS/cadence can
 * eventually see real seasonality.
 *
 * Mirrors POST /api/integrations/shopify/backfill-orders but runs headless
 * (resolves creds without a session) and self-guards to a single run.
 *
 * SAFE: storage.createSalesOrder is a pure insert (no InventoryMovement, no GHL);
 * orders land isHistorical=true. Per-order idempotency skips anything already on
 * file (so a re-run resumes), and a system_logs marker stops it re-running.
 *
 * SCOPE PROBE: Shopify's Admin API only returns orders older than 60 days when
 * the token holds the protected read_all_orders scope. We probe a ~14-month-old
 * window first; if it comes back empty (the store definitely had sales then), we
 * conclude the token is scope-limited and bail with a clear log instead of
 * silently importing only the last 60 days.
 */
import { sql } from "drizzle-orm";
import { storage } from "../storage";
import { db } from "../db";

const rows = (r: any) => r.rows || r;
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

export interface BackfillResult {
  ran: boolean;
  skipped?: string;
  scopeLimited?: boolean;
  pages: number;
  fetched: number;
  inserted: number;
  skippedExisting: number;
  oldestOrderReturned: string | null;
  newestOrderReturned: string | null;
  unmappedSkus: string[];
}

function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const m = part.match(/<([^>]+)>;\s*rel="next"/);
    if (m) return m[1];
  }
  return null;
}

export async function runShopifyHistoricalBackfill(
  opts: { dateFrom?: string; dateTo?: string; maxPages?: number; force?: boolean } = {},
): Promise<BackfillResult> {
  const result: BackfillResult = {
    ran: false, pages: 0, fetched: 0, inserted: 0, skippedExisting: 0,
    oldestOrderReturned: null, newestOrderReturned: null, unmappedSkus: [],
  };
  try {
    if (!opts.force) {
      const prior = await storage.getAllSystemLogs({ type: "SHOPIFY_BACKFILL" });
      // Only a successful completion disarms the job. A prior scope-limit or
      // error leaves it armed so it self-heals (re-probes / retries) next boot.
      if (prior.some((l: any) => l.code === "SHOPIFY_HISTORICAL_BACKFILL_DONE")) {
        result.skipped = "already completed";
        return result;
      }
    }

    // Resolve Shopify creds headlessly (the enabled integration config, else env).
    const cfg = rows(await db.execute(sql`
      SELECT api_key, config->>'shopDomain' AS shop_domain
      FROM integration_configs
      WHERE provider='SHOPIFY' AND COALESCE(is_enabled, true) = true
      ORDER BY last_sync_at DESC NULLS LAST LIMIT 1`))[0];
    const apiKey = cfg?.api_key || process.env.SHOPIFY_ADMIN_API_KEY || process.env.SHOPIFY_ACCESS_TOKEN;
    const shopDomain = cfg?.shop_domain || process.env.SHOPIFY_STORE_DOMAIN || process.env.SHOPIFY_STORE_URL;
    if (!apiKey || !shopDomain) {
      result.skipped = "Shopify not configured";
      await logBackfill(result, "WARN", "Shopify creds not found — cannot backfill.");
      return result;
    }

    const dateFrom = new Date(opts.dateFrom || "2024-01-01");
    const dateTo = opts.dateTo ? new Date(opts.dateTo) : new Date();
    const maxPages = opts.maxPages ?? 400;
    const base = shopDomain.startsWith("http") ? shopDomain : `https://${shopDomain}`;
    const adminUrl = `${base.replace(/\/$/, "")}/admin/api/2024-01`;
    const headers = { "X-Shopify-Access-Token": apiKey, "Content-Type": "application/json" };

    // --- Scope probe: a 13-15 month-old window. Empty => likely no read_all_orders.
    const probeMin = new Date(dateTo); probeMin.setMonth(probeMin.getMonth() - 15);
    const probeMax = new Date(dateTo); probeMax.setMonth(probeMax.getMonth() - 13);
    const probeUrl = `${adminUrl}/orders.json?status=any&created_at_min=${probeMin.toISOString()}&created_at_max=${probeMax.toISOString()}&limit=1`;
    const probe = await fetch(probeUrl, { headers });
    if (probe.status === 401 || probe.status === 403) {
      result.scopeLimited = true;
      await logBackfill(result, "WARN", `Scope probe ${probe.status}: token lacks order-read scope.`);
      return result;
    }
    if (probe.ok) {
      const pj = await probe.json();
      if ((pj.orders ?? []).length === 0) {
        result.scopeLimited = true;
        await logBackfill(result, "WARN",
          "Scope probe returned 0 orders for a 13-15 month-old window despite known sales then — token likely lacks read_all_orders. Use a Shopify Orders CSV export instead.");
        return result;
      }
    }

    // --- Full backfill.
    const allItems = await storage.getAllItems();
    const itemBySku = new Map(allItems.map((i: any) => [i.sku, i] as const));
    const unmapped = new Set<string>();
    const params = new URLSearchParams({
      status: "any",
      created_at_min: dateFrom.toISOString(),
      created_at_max: dateTo.toISOString(),
      limit: "250",
    });
    let nextUrl: string | null = `${adminUrl}/orders.json?${params.toString()}`;

    while (nextUrl && result.pages < maxPages) {
      const resp: Response = await fetch(nextUrl, { headers });
      if (resp.status === 429) { await sleep(2000); continue; }
      if (!resp.ok) {
        const t = await resp.text();
        throw new Error(`Shopify ${resp.status}: ${t.slice(0, 160)}`);
      }
      const data = await resp.json();
      const orders: any[] = data.orders ?? [];
      result.pages++;
      result.fetched += orders.length;

      for (const order of orders) {
        const created = order.created_at ? String(order.created_at).slice(0, 10) : null;
        if (created) {
          if (!result.oldestOrderReturned || created < result.oldestOrderReturned) result.oldestOrderReturned = created;
          if (!result.newestOrderReturned || created > result.newestOrderReturned) result.newestOrderReturned = created;
        }
        const externalId = String(order.id);
        const existing = await storage.getSalesOrdersByExternalId("SHOPIFY", externalId);
        if (existing.length > 0) { result.skippedExisting++; continue; }

        const customer = order.customer ?? {};
        const ship = order.shipping_address ?? {};
        const customerName =
          [customer.first_name, customer.last_name].filter(Boolean).join(" ") || order.email || "Shopify customer";

        const so = await storage.createSalesOrder({
          externalOrderId: externalId,
          orderName: order.name ?? null,
          channel: "SHOPIFY",
          customerName,
          customerEmail: customer.email ?? order.email ?? null,
          customerPhone: customer.phone ?? order.phone ?? null,
          status: order.cancelled_at
            ? "CANCELLED"
            : order.fulfillment_status === "fulfilled"
              ? "DELIVERED"
              : order.financial_status === "refunded"
                ? "REFUNDED"
                : "DELIVERED",
          orderDate: order.created_at ? new Date(order.created_at) : new Date(),
          deliveredAt: order.closed_at ? new Date(order.closed_at) : null,
          cancelledAt: order.cancelled_at ? new Date(order.cancelled_at) : null,
          sourceUrl: `https://${shopDomain.replace(/^https?:\/\//, "")}/admin/orders/${externalId}`,
          totalAmount: order.total_price ? parseFloat(order.total_price) : 0,
          currency: order.currency ?? "USD",
          fulfillmentSource: "PIVOT_EXTENSIV",
          isHistorical: true,
          archivedAt: new Date(),
          rawPayload: order,
          shipToStreet: ship.address1 ?? null,
          shipToCity: ship.city ?? null,
          shipToState: ship.province_code ?? ship.province ?? null,
          shipToZip: ship.zip ?? null,
          shipToCountry: ship.country_code ?? ship.country ?? null,
        } as any);

        for (const li of order.line_items ?? []) {
          const rawSku = (li.sku ?? "").trim();
          const stripped = rawSku.replace(/^SKU:\s*/i, "");
          let canonical = stripped;
          if (!itemBySku.has(canonical)) {
            const mapped =
              (await storage.findCanonicalSku(rawSku, "shopify")) ??
              (await storage.findCanonicalSku(stripped, "shopify"));
            if (mapped) canonical = mapped;
          }
          const item = itemBySku.get(canonical) ?? null;
          if (!item && rawSku) unmapped.add(rawSku);

          await storage.createSalesOrderLine({
            salesOrderId: so.id,
            productId: item?.id ?? null,
            sku: rawSku || canonical || "",
            productName: li.name ?? li.title ?? null,
            qtyOrdered: li.quantity ?? 0,
            qtyAllocated: 0,
            qtyShipped: 0,
            qtyFulfilled: 0,
            backorderQty: 0,
            unitPrice: li.price ? parseFloat(li.price) : null,
          });
        }
        result.inserted++;
      }

      nextUrl = parseNextLink(resp.headers.get("link") ?? resp.headers.get("Link"));
      await sleep(300); // gentle on Shopify's REST rate limit
    }

    result.unmappedSkus = Array.from(unmapped).slice(0, 50);
    result.ran = true;
    await logBackfill(result, "INFO",
      `Shopify historical backfill: ${result.inserted} new orders inserted (${result.fetched} fetched, ${result.skippedExisting} already on file, ${result.pages} pages) back to ${result.oldestOrderReturned ?? "n/a"}.`);
    return result;
  } catch (e: any) {
    await logBackfill(result, "ERROR", `Shopify historical backfill failed: ${e?.message ?? e}`);
    return result;
  }
}

async function logBackfill(result: BackfillResult, severity: string, message: string): Promise<void> {
  // DONE only on a clean completion (disarms the one-shot); SCOPE/ERROR leave it armed.
  const code = result.ran
    ? "SHOPIFY_HISTORICAL_BACKFILL_DONE"
    : result.scopeLimited
      ? "SHOPIFY_HISTORICAL_BACKFILL_SCOPE"
      : "SHOPIFY_HISTORICAL_BACKFILL_ERROR";
  await storage
    .createSystemLog({
      type: "SHOPIFY_BACKFILL",
      severity,
      code,
      message,
      details: { ...result, ranAt: new Date().toISOString() } as any,
    } as any)
    .catch(() => {});
}
