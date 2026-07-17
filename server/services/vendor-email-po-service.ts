/**
 * COUNT.M — Vendor confirmation email → draft Purchase Order.
 *
 * Online vendors (Uline, McMaster-Carr, Home Depot, Silver Fox, Austin Enterprises)
 * are bought on their websites, so those purchases never hit the PO system and the
 * app is blind to that spend + incoming stock. This closes the gap: feed it a vendor
 * order-confirmation email, it parses the lines with Claude and matches them to our
 * SKUs by vendor part number.
 *
 * A confirmation email means the order is ALREADY placed, so when the vendor is
 * recognized and EVERY line matches a SKU there is nothing to confirm — it is logged
 * straight as "ordered" (status SENT) and lands in the Incoming queue. Only an
 * unmatched line or an unresolved vendor holds it as a DRAFT for review. Either way
 * nothing touches live inventory or QuickBooks until it is marked received.
 *
 * Delivery-agnostic: the same entry point serves the manual "paste an email" box and
 * an n8n Gmail watcher POSTing to /api/purchase-orders/from-vendor-email. Re-delivery
 * is de-duped on (supplier, vendorOrderNumber).
 */
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "crypto";

const CLAUDE_MODEL = "claude-sonnet-4-5-20250929";

// Known vendor sender domains → canonical supplier name. Vendors without a stable
// domain (Silver Fox, Austin Enterprises) fall back to the parsed supplier name.
export const VENDOR_DOMAINS: Record<string, string> = {
  "uline.com": "Uline",
  "mcmaster.com": "McMaster-Carr",
  "homedepot.com": "Home Depot",
  "silverfox.com": "Silver Fox LLC",
};

export interface ParsedVendorLine { partNumber: string | null; description: string; quantity: number; unitCost: number; }
export interface ParsedVendorOrder {
  supplierName: string | null;
  orderNumber: string | null;
  orderDate: string | null;       // YYYY-MM-DD
  expectedDate: string | null;    // YYYY-MM-DD
  lineItems: ParsedVendorLine[];
  subtotal: number | null;
  shipping: number | null;
  tax: number | null;
  total: number | null;
}

export interface SupplierLite { id: string; name: string }
export interface SupplierItemLite { itemId: string; supplierSku: string | null }
export interface ItemLite { id: string; sku: string; name: string }

export interface MatchedLine { itemId: string; sku: string; itemName: string; vendorPart: string | null; qty: number; unitCost: number; matchedBy: "part" | "name"; }
export interface UnmatchedLine { description: string; vendorPart: string | null; qty: number; unitCost: number; }

const normPart = (s: string | null | undefined) => (s ?? "").trim().toUpperCase().replace(/\s+/g, "");
const domainOf = (from: string | null | undefined): string => {
  const m = String(from ?? "").toLowerCase().match(/@([a-z0-9.-]+)/);
  if (!m) return "";
  const host = m[1].replace(/^mail\.|^email\.|^e\./, "");
  // collapse to the registrable-ish domain (last two labels)
  const parts = host.split(".");
  return parts.length >= 2 ? parts.slice(-2).join(".") : host;
};

/** Tokenize a product name/description for fuzzy matching. */
function tokens(s: string): Set<string> {
  return new Set(
    String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3),
  );
}
function tokenOverlap(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  const hit = Array.from(ta).filter((t) => tb.has(t)).length;
  return hit / Math.min(ta.size, tb.size);
}

/** Accept only a strict YYYY-MM-DD that round-trips (rejects "2026-02-30", "next week", etc.). */
export function safeDate(s: string | null | undefined): Date | undefined {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
  const d = new Date(`${s}T00:00:00Z`);
  if (isNaN(d.getTime())) return undefined;
  return d.toISOString().slice(0, 10) === s ? d : undefined;
}

/** Deterministic idempotency key for an email that carried no readable order number. */
function contentHash(supplierId: string, matched: MatchedLine[], total: number | null): string {
  const canon =
    supplierId + "|" +
    matched.map((m) => `${normPart(m.vendorPart) || m.sku}:${m.qty}:${m.unitCost}`).sort().join(",") +
    "|" + (total ?? "");
  return createHash("sha1").update(canon).digest("hex").slice(0, 16);
}

/**
 * Resolve which supplier an email is from: prefer the sender domain (allowlist),
 * else the parsed supplier name; match against our suppliers by contains-either-way.
 * Pure — caller supplies the supplier list.
 */
export function resolveSupplierFromEmail(parsedName: string | null, fromAddr: string | null, suppliers: SupplierLite[]): SupplierLite | null {
  const dom = domainOf(fromAddr);
  const target = (VENDOR_DOMAINS[dom] || parsedName || "").trim().toLowerCase();
  if (!target) return null;
  // exact-ish first
  let best: { s: SupplierLite; score: number } | null = null;
  for (const s of suppliers) {
    const n = s.name.trim().toLowerCase();
    if (!n) continue;
    let score = 0;
    if (n === target) score = 1;
    else if (n.includes(target) || target.includes(n)) score = 0.8;
    else score = tokenOverlap(n, target);
    if (score >= 0.6 && (!best || score > best.score)) best = { s, score };
  }
  return best?.s ?? null;
}

/**
 * Match parsed vendor lines to our items: first by vendor part number against this
 * supplier's supplier_items, then by name/description token overlap. Pure.
 */
export function matchVendorLines(
  parsedLines: ParsedVendorLine[],
  supplierItems: SupplierItemLite[],
  items: ItemLite[],
): { matched: MatchedLine[]; unmatched: UnmatchedLine[] } {
  const byPart = new Map<string, string>(); // normPart -> itemId
  const supplierItemIds = new Set<string>();
  for (const si of supplierItems) {
    supplierItemIds.add(si.itemId);
    const k = normPart(si.supplierSku);
    if (k && !byPart.has(k)) byPart.set(k, si.itemId);
  }
  const itemById = new Map(items.map((i) => [i.id, i]));
  // Fuzzy name matching is restricted to THIS supplier's items — a part we can't
  // part-match should never silently link to an unrelated item from another vendor.
  const supplierItemsList = items.filter((i) => supplierItemIds.has(i.id));
  const matched: MatchedLine[] = [];
  const unmatched: UnmatchedLine[] = [];

  for (const l of parsedLines) {
    const qty = Math.max(0, Math.round(Number(l.quantity) || 0));
    const unitCost = Math.max(0, Number(l.unitCost) || 0);
    if (qty <= 0) continue; // skip $0/no-charge or unparseable-qty lines (e.g. free pallet notes)

    // 1) vendor part number
    const partKey = normPart(l.partNumber);
    let itemId = partKey ? byPart.get(partKey) : undefined;
    let matchedBy: "part" | "name" = "part";

    // 2) fuzzy by description against THIS supplier's item names only
    if (!itemId) {
      let bestId: string | undefined;
      let bestScore = 0;
      for (const it of supplierItemsList) {
        const sc = tokenOverlap(l.description, it.name);
        if (sc > bestScore) { bestScore = sc; bestId = it.id; }
      }
      if (bestId && bestScore >= 0.6) { itemId = bestId; matchedBy = "name"; }
    }

    const it = itemId ? itemById.get(itemId) : undefined;
    if (it) {
      matched.push({ itemId: it.id, sku: it.sku, itemName: it.name, vendorPart: l.partNumber ?? null, qty, unitCost, matchedBy });
    } else {
      unmatched.push({ description: l.description, vendorPart: l.partNumber ?? null, qty, unitCost });
    }
  }
  return { matched, unmatched };
}

const SYSTEM_PROMPT = `You extract structured purchase data from a vendor order-confirmation email (Uline, McMaster-Carr, Home Depot, or similar). Return ONLY valid JSON, no markdown, no commentary. Schema:
{
  "supplierName": string | null,
  "orderNumber": string | null,        // the vendor's order/confirmation number
  "orderDate": "YYYY-MM-DD" | null,
  "expectedDate": "YYYY-MM-DD" | null, // ship/delivery date if present
  "lineItems": [ { "partNumber": string | null, "description": string, "quantity": number, "unitCost": number } ],
  "subtotal": number | null,
  "shipping": number | null,
  "tax": number | null,
  "total": number | null
}
Rules: partNumber is the vendor's item/part number (e.g. "S-13320", "91257A592", a Home Depot SKU). unitCost is per-unit price, not extended. Include no-charge lines only if they have a real part number, with unitCost 0. Numbers must be plain (no "$" or commas). If a field is unknown use null — NEVER invent, estimate, or infer a value that is not stated in the email. Every number you output (quantities, unit costs, totals, dates) must appear in the email text itself. Do not fill gaps with typical or plausible values.`;

function stripToJson(text: string): string {
  let t = text.trim();
  t = t.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  return start >= 0 && end > start ? t.slice(start, end + 1) : t;
}

/** Best-effort LLM parse of an email into a structured order. Returns null on failure. */
export async function parseVendorOrderEmail(input: { subject?: string; from?: string; text: string }): Promise<ParsedVendorOrder | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const client = new Anthropic();
  const userContent = [
    input.from ? `From: ${input.from}` : null,
    input.subject ? `Subject: ${input.subject}` : null,
    "",
    input.text,
  ].filter((x) => x !== null).join("\n").slice(0, 60_000);

  try {
    const resp = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    });
    const block = resp.content.find((b: any) => b.type === "text") as any;
    if (!block?.text) return null;
    const parsed = JSON.parse(stripToJson(block.text));
    const num = (v: any) => (v == null || v === "" ? null : Number(v));
    return {
      supplierName: parsed.supplierName ?? null,
      orderNumber: parsed.orderNumber != null ? String(parsed.orderNumber) : null,
      orderDate: parsed.orderDate ?? null,
      expectedDate: parsed.expectedDate ?? null,
      lineItems: Array.isArray(parsed.lineItems)
        ? parsed.lineItems.map((l: any) => ({
            partNumber: l.partNumber != null ? String(l.partNumber) : null,
            description: String(l.description ?? ""),
            quantity: Number(l.quantity) || 0,
            unitCost: Number(l.unitCost) || 0,
          }))
        : [],
      subtotal: num(parsed.subtotal),
      shipping: num(parsed.shipping),
      tax: num(parsed.tax),
      total: num(parsed.total),
    };
  } catch {
    return null;
  }
}

export interface VendorEmailPoResult {
  ok: boolean;
  reason?: string;          // when ok=false (empty_email | llm_not_configured | parse_failed | no_line_items | supplier_not_found | no_matched_lines)
  duplicate?: boolean;
  existingPoId?: string;
  poId?: string;
  poNumber?: string;
  poStatus?: string;        // "SENT" when auto-ordered (clean match), "DRAFT" when held for review
  autoOrdered?: boolean;    // true = known vendor + every line matched → logged as ordered, no review
  supplier?: SupplierLite;
  orderNumber?: string | null;
  matched: MatchedLine[];
  unmatched: UnmatchedLine[];
  totals?: { subtotal: number | null; shipping: number | null; tax: number | null; total: number | null };
}

/**
 * Orchestrator (impure): parse a vendor email → resolve supplier → de-dupe on
 * (supplier, orderNumber) → match lines → create a DRAFT PO with the matched lines.
 * Unmatched lines are reported, never invented (purchase_order_lines.item_id is
 * NOT NULL). Clean match (no unmatched lines) → status SENT/ordered; otherwise DRAFT.
 */
export async function createDraftPoFromVendorEmail(input: { subject?: string; from?: string; text: string }): Promise<VendorEmailPoResult> {
  const empty = { matched: [] as MatchedLine[], unmatched: [] as UnmatchedLine[] };
  if (!input.text || !input.text.trim()) return { ok: false, reason: "empty_email", ...empty };
  // Distinguish "LLM not configured" from a genuine parse failure so the operator
  // (and the n8n status-code branch) can tell a config gap from a transient outage.
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, reason: "llm_not_configured", ...empty };

  const parsed = await parseVendorOrderEmail(input);
  if (!parsed) return { ok: false, reason: "parse_failed", ...empty };
  if (!parsed.lineItems.length) return { ok: false, reason: "no_line_items", ...empty };

  const { db } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const rows = (r: any) => r.rows || r;
  const dupResult = (d: any): VendorEmailPoResult => ({
    ok: true, duplicate: true, existingPoId: d.id, poNumber: d.po_number, supplier, orderNumber: parsed!.orderNumber, matched: [], unmatched: [],
  });

  const suppliers = rows(await db.execute(sql`SELECT id, name FROM suppliers`)) as SupplierLite[];
  const supplier = resolveSupplierFromEmail(parsed.supplierName, input.from ?? null, suppliers);
  if (!supplier) return { ok: false, reason: "supplier_not_found", orderNumber: parsed.orderNumber, ...empty };

  const supplierItems = rows(await db.execute(sql`
    SELECT item_id AS "itemId", supplier_sku AS "supplierSku" FROM supplier_items WHERE supplier_id = ${supplier.id}`)) as SupplierItemLite[];
  const items = rows(await db.execute(sql`SELECT id, sku, name FROM items`)) as ItemLite[];

  const { matched, unmatched } = matchVendorLines(parsed.lineItems, supplierItems, items);
  const totals = { subtotal: parsed.subtotal, shipping: parsed.shipping, tax: parsed.tax, total: parsed.total };
  if (matched.length === 0) {
    // Nothing matched — don't create an empty PO; report so the parts can be mapped.
    return { ok: false, reason: "no_matched_lines", supplier, orderNumber: parsed.orderNumber, matched, unmatched, totals };
  }

  // Idempotency key: the vendor's order number when we have one, else a deterministic
  // content hash of the matched lines — so a re-delivered email with no readable order
  // number still de-dupes instead of spawning a second PO.
  const idemKey = parsed.orderNumber?.trim() || `auto-${contentHash(supplier.id, matched, totals.total)}`;
  const existing = rows(await db.execute(sql`
    SELECT id, po_number FROM purchase_orders
    WHERE supplier_id = ${supplier.id} AND vendor_order_number = ${idemKey} LIMIT 1`))[0];
  if (existing) return dupResult(existing);

  // Confidence gate: a known vendor with EVERY line matched to a SKU needs no
  // review — the order is already placed, so log it straight to "ordered" (lands
  // in the Incoming queue, ready to receive). Any unmatched line holds it as a
  // DRAFT so a human maps the parts first. Either way QuickBooks only bills on
  // receive, and "ordered" counts as on-order for the reorder engine.
  const clean = unmatched.length === 0;
  const { storage } = await import("../storage");
  const subtotal = Math.round(matched.reduce((s, l) => s + l.qty * l.unitCost, 0) * 100) / 100;
  const poNumber = await storage.getNextPONumber();
  const noteBits = [
    clean ? `Auto-logged from ${supplier.name} email` : `Imported from ${supplier.name} email`,
    parsed.orderNumber ? `order ${parsed.orderNumber}` : null,
    unmatched.length ? `${unmatched.length} line(s) unmatched — review` : null,
  ].filter(Boolean);

  let po: any;
  try {
    po = await storage.createPurchaseOrder({
      poNumber,
      supplierId: supplier.id,
      supplierName: supplier.name,
      currency: "USD",
      status: clean ? "SENT" : "DRAFT",
      poStatus: clean ? "ordered" : undefined,
      sentAt: clean ? new Date() : undefined,
      isAutoDraft: !clean,           // clean = a real ordered PO; messy = a draft to review (amber flag)
      source: "vendor_email",
      vendorOrderNumber: idemKey,
      subtotal,
      total: subtotal,
      totalItemsOrdered: matched.reduce((s, l) => s + l.qty, 0),
      orderDate: safeDate(parsed.orderDate),
      expectedDate: safeDate(parsed.expectedDate),
      notes: noteBits.join(" · "),
    } as any);
  } catch (e: any) {
    // Lost a race to a concurrent delivery (unique index on supplier+vendor_order_number).
    if (String(e?.code) === "23505" || /duplicate key|unique constraint/i.test(String(e?.message))) {
      const won = rows(await db.execute(sql`
        SELECT id, po_number FROM purchase_orders
        WHERE supplier_id = ${supplier.id} AND vendor_order_number = ${idemKey} LIMIT 1`))[0];
      if (won) return dupResult(won);
    }
    throw e;
  }

  for (const l of matched) {
    await storage.createPurchaseOrderLine({
      purchaseOrderId: po.id,
      itemId: l.itemId,
      sku: l.sku,
      itemName: l.itemName,
      supplierItemCode: l.vendorPart ?? null,
      qtyOrdered: l.qty,
      unitCost: l.unitCost,
      lineTotal: Math.round(l.qty * l.unitCost * 100) / 100,
    } as any);
  }

  return {
    ok: true, poId: po.id, poNumber: po.poNumber,
    poStatus: clean ? "SENT" : "DRAFT", autoOrdered: clean,
    supplier, orderNumber: parsed.orderNumber, matched, unmatched, totals,
  };
}
