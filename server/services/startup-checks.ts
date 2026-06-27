// Startup checks — runs once during boot to verify the schema migrations and
// data migrations the rest of the app assumes are in place.
//
// Three purposes:
//
//   1. Force-create production_logs / shop_issues / daily_briefings via
//      CREATE TABLE IF NOT EXISTS. Railway's build script calls
//      drizzle-kit push automatically but production was caught with two
//      of those tables missing, so this is the belt-and-suspenders
//      safety net. Followed by an existence check that fails LOUD if a
//      table is still missing afterwards.
//
//   2. Idempotent data migration for the FX Industries / Pednar lead times
//      from migration_set_supplier_lead_times.sql. UPDATE is gated on
//      lead_time_days IS NULL — never overrides a manually set value.
//
//   3. One-time cleanup of legacy production_logs rows where
//      action_type = 'rolls_made' (that action was removed; the rows are
//      stale test data).
//
// Boot continues even if a step fails — we want the server up so other
// routes work, but failures are logged loudly so they're caught fast.

import pg from "pg";
import { getTableColumns, getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import * as schema from "@shared/schema";
import { HISTORICAL_PL_DATA } from "../routes/historical-pl-data";
import { ZO_KPI_DATA } from "../routes/zo-kpi-data";

const REQUIRED_TABLES = [
  "production_logs",
  "shop_issues",
  "daily_briefings",
  "inventory_lots",
  "lot_consumption_events",
  "backorder_notices",
  "historical_monthly_sales",
  "marketing_recommendations",
  "ad_metrics_daily",
] as const;

const FX_INDUSTRIES_LEAD_TIME = 21;
const PEDNAR_LEAD_TIME = 14;

type CheckResult = {
  table: string;
  exists: boolean;
};

// CREATE TABLE IF NOT EXISTS statements that mirror the Drizzle schema. Kept
// inline (rather than read from a .sql file) so the safety net is bundled
// with the running server. Drizzle remains the source of truth — these are
// only fallbacks that fire when drizzle-kit push didn't apply.
const CREATE_TABLE_STATEMENTS: Record<typeof REQUIRED_TABLES[number], string> = {
  production_logs: `
    CREATE TABLE IF NOT EXISTS production_logs (
      id            VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      item_id       VARCHAR NOT NULL REFERENCES items(id),
      action_type   TEXT NOT NULL,
      quantity      INTEGER NOT NULL,
      production_date TEXT NOT NULL,
      notes         TEXT,
      created_by    TEXT,
      created_at    TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS production_logs_item_id_idx ON production_logs(item_id);
    CREATE INDEX IF NOT EXISTS production_logs_production_date_idx ON production_logs(production_date);
  `,
  shop_issues: `
    CREATE TABLE IF NOT EXISTS shop_issues (
      id          VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      item_id     VARCHAR NOT NULL REFERENCES items(id),
      issue_type  TEXT NOT NULL,
      notes       TEXT NOT NULL,
      reported_by TEXT,
      created_at  TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS shop_issues_item_id_idx ON shop_issues(item_id);
    CREATE INDEX IF NOT EXISTS shop_issues_created_at_idx ON shop_issues(created_at);
  `,
  daily_briefings: `
    CREATE TABLE IF NOT EXISTS daily_briefings (
      id           VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      date         TEXT NOT NULL UNIQUE,
      content_json JSONB NOT NULL,
      created_at   TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS daily_briefings_date_idx ON daily_briefings(date);
  `,
  inventory_lots: `
    CREATE TABLE IF NOT EXISTS inventory_lots (
      id                    VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      item_id               VARCHAR NOT NULL REFERENCES items(id),
      lot_number            TEXT NOT NULL,
      original_qty          INTEGER NOT NULL,
      remaining_qty         INTEGER NOT NULL,
      received_at           TIMESTAMP NOT NULL DEFAULT NOW(),
      source_transaction_id VARCHAR REFERENCES inventory_transactions(id),
      supplier_id           VARCHAR REFERENCES suppliers(id),
      notes                 TEXT
    );
    CREATE INDEX IF NOT EXISTS inventory_lots_item_id_idx ON inventory_lots(item_id);
    CREATE INDEX IF NOT EXISTS inventory_lots_received_at_idx ON inventory_lots(received_at);
  `,
  lot_consumption_events: `
    CREATE TABLE IF NOT EXISTS lot_consumption_events (
      id                 VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      lot_id             VARCHAR NOT NULL REFERENCES inventory_lots(id),
      production_log_id  VARCHAR REFERENCES production_logs(id),
      qty_drawn          INTEGER NOT NULL,
      consumed_at        TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS lot_consumption_events_lot_id_idx ON lot_consumption_events(lot_id);
    CREATE INDEX IF NOT EXISTS lot_consumption_events_production_log_id_idx ON lot_consumption_events(production_log_id);
  `,
  backorder_notices: `
    CREATE TABLE IF NOT EXISTS backorder_notices (
      id              VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      sales_order_id  VARCHAR NOT NULL,
      item_id         VARCHAR NOT NULL REFERENCES items(id),
      po_id           VARCHAR,
      channel         TEXT NOT NULL,
      payload_json    JSONB,
      sent_at         TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS backorder_notices_sales_order_id_idx ON backorder_notices(sales_order_id);
    CREATE UNIQUE INDEX IF NOT EXISTS backorder_notices_order_item_unique_idx ON backorder_notices(sales_order_id, item_id);
  `,
  // Marketing Analytics CMO history. The unique (year, month) index backs the
  // ON CONFLICT upsert in seedHistoricalSales — without it the QuickBooks P&L
  // import throws "no unique constraint matching ON CONFLICT" and every row is
  // skipped. drizzle-kit push is skipped at build time (no DATABASE_URL), so
  // this is the only path that creates the table on Railway.
  historical_monthly_sales: `
    CREATE TABLE IF NOT EXISTS historical_monthly_sales (
      id               VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      year             INTEGER NOT NULL,
      month            INTEGER NOT NULL,
      revenue          REAL NOT NULL DEFAULT 0,
      returns          REAL DEFAULT 0,
      total_income     REAL DEFAULT 0,
      cogs             REAL DEFAULT 0,
      gross_profit     REAL DEFAULT 0,
      ad_spend         REAL DEFAULT 0,
      total_expenses   REAL DEFAULT 0,
      net_income       REAL DEFAULT 0,
      gross_margin_pct REAL DEFAULT 0,
      source           TEXT NOT NULL DEFAULT 'spreadsheet',
      created_at       TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS historical_monthly_sales_year_month_idx ON historical_monthly_sales(year, month);
  `,
  marketing_recommendations: `
    CREATE TABLE IF NOT EXISTS marketing_recommendations (
      id              VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      generated_at    TIMESTAMP NOT NULL DEFAULT NOW(),
      recommendations JSONB,
      input_snapshot  JSONB,
      model           TEXT,
      created_by      TEXT
    );
    CREATE INDEX IF NOT EXISTS marketing_recommendations_generated_at_idx ON marketing_recommendations(generated_at);
  `,
  // Normalized ad-spend fact table. Windsor ingestion + the native Google/Meta
  // syncs all upsert here, and the whole Marketing Analytics query layer reads
  // it. The unique (platform, sku, date) index backs those upserts.
  ad_metrics_daily: `
    CREATE TABLE IF NOT EXISTS ad_metrics_daily (
      id          VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      platform    TEXT NOT NULL,
      sku         TEXT NOT NULL,
      date        DATE NOT NULL,
      campaign    TEXT NOT NULL DEFAULT '_all',
      device      TEXT NOT NULL DEFAULT '_all',
      country     TEXT NOT NULL DEFAULT '_all',
      impressions INTEGER NOT NULL DEFAULT 0,
      clicks      INTEGER NOT NULL DEFAULT 0,
      spend       REAL NOT NULL DEFAULT 0,
      conversions INTEGER DEFAULT 0,
      revenue     REAL DEFAULT 0,
      currency    TEXT DEFAULT 'USD',
      created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS ad_metrics_date_idx ON ad_metrics_daily(date);
    CREATE INDEX IF NOT EXISTS ad_metrics_sku_idx ON ad_metrics_daily(sku);
  `,
};

async function ensureTablesExist(client: pg.PoolClient): Promise<void> {
  for (const table of REQUIRED_TABLES) {
    try {
      await client.query(CREATE_TABLE_STATEMENTS[table]);
    } catch (err: any) {
      console.error(`[Startup Checks] CREATE TABLE IF NOT EXISTS ${table} failed:`, err?.message ?? err);
    }
  }
}

// Insurance: production_logs may have legacy NOT NULL constraints from older
// schema revisions on production DBs. The current Drizzle schema does not
// require these to be NOT NULL, but a fresh deploy that inherits an old DB
// could still have them. DO blocks swallow the error if the column is
// already nullable (or doesn't exist), so this is safe to run on every boot.
async function ensureProductionLogsShape(client: pg.PoolClient): Promise<void> {
  const stmts = [
    `DO $$ BEGIN ALTER TABLE production_logs ALTER COLUMN quantity_built DROP NOT NULL; EXCEPTION WHEN others THEN null; END $$;`,
    `DO $$ BEGIN ALTER TABLE production_logs ALTER COLUMN finished_good_sku DROP NOT NULL; EXCEPTION WHEN others THEN null; END $$;`,
    `DO $$ BEGIN ALTER TABLE production_logs ALTER COLUMN built_by DROP NOT NULL; EXCEPTION WHEN others THEN null; END $$;`,
    `DO $$ BEGIN ALTER TABLE production_logs ALTER COLUMN built_at DROP NOT NULL; EXCEPTION WHEN others THEN null; END $$;`,
  ];
  for (const stmt of stmts) {
    try {
      await client.query(stmt);
    } catch (err: any) {
      console.error(`[Startup Checks] ensureProductionLogsShape stmt failed:`, err?.message ?? err);
    }
  }
}

// Additive column adds for tables that already exist. Postgres 9.6+ supports
// ADD COLUMN IF NOT EXISTS so this is safe to run on every boot.
async function ensureColumnsExist(client: pg.PoolClient): Promise<void> {
  const ADDS = [
    `ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS created_by_name TEXT`,
    `ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS supplier_id VARCHAR REFERENCES suppliers(id)`,
    `ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS reason TEXT`,
    `ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS lot_number TEXT`,
    // PO build-progress + FX confirmation fields. Belt-and-suspenders for
    // when drizzle-kit push hasn't run yet on a fresh deploy.
    `ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS po_status TEXT NOT NULL DEFAULT 'ordered'`,
    // Vendor confirmation-email -> draft PO: idempotency key + provenance.
    `ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS vendor_order_number TEXT`,
    `ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS source TEXT`,
    `ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS confirmed_qty INTEGER`,
    `ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS expected_completion_date TIMESTAMP`,
    // Supplier forecast-tier columns.
    `ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'transactional'`,
    `ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS forecast_brief_schedule TEXT NOT NULL DEFAULT 'never'`,
    `ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS auto_send_briefs BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS last_forecast_brief_sent_at TIMESTAMP`,
    // Deep-link template for online vendors (reorder list links each line to its product page).
    `ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS product_url_template TEXT`,
    // Build shops (FX/Acu-Form/Pednar) — their open POs show on the Builds page.
    `ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS is_build_shop BOOLEAN NOT NULL DEFAULT FALSE`,
    // Per-item seasonal demand multiplier.
    `ALTER TABLE items ADD COLUMN IF NOT EXISTS seasonal_multiplier REAL NOT NULL DEFAULT 1.0`,
    // Products page priority grouping ('core_build' | 'combo' |
    // 'refurbished' | 'replacement' | 'accessory'; default accessory).
    `ALTER TABLE items ADD COLUMN IF NOT EXISTS reorder_priority TEXT NOT NULL DEFAULT 'accessory'`,
    // Order-logging + receive-accuracy fields on purchase_orders.
    `ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS expected_qty INTEGER`,
    `ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS actual_qty INTEGER`,
    `ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS expected_delivery DATE`,
    `ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS actual_delivery DATE`,
    `ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS accuracy_score REAL`,
    `ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS delivery_variance_days INTEGER`,
    `ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS entry_source TEXT NOT NULL DEFAULT 'manual'`,
    `ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS invoice_image_url TEXT`,
    `ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS invoice_total REAL`,
    // Idempotency for vendor-email imports: one PO per (supplier, vendor order number).
    `CREATE UNIQUE INDEX IF NOT EXISTS purchase_orders_supplier_vendor_order_unique_idx ON purchase_orders (supplier_id, vendor_order_number) WHERE vendor_order_number IS NOT NULL`,
    // Per-category budget targets (% of net sales) for budget-vs-actual on QB line items.
    `CREATE TABLE IF NOT EXISTS budget_targets (account_name text PRIMARY KEY, target_pct real NOT NULL, sort_order integer NOT NULL DEFAULT 100, updated_at timestamptz NOT NULL DEFAULT now())`,
    `ALTER TABLE budget_targets ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open'`,
    `ALTER TABLE budget_targets ADD COLUMN IF NOT EXISTS note text`,
    // Forward 12-month budget projection: per-category driver (variable %/fixed $) + revenue settings.
    `CREATE TABLE IF NOT EXISTS projection_assumptions (account_name text PRIMARY KEY, driver text NOT NULL DEFAULT 'fixed', rate_pct numeric, fixed_amount numeric, updated_at timestamptz NOT NULL DEFAULT now())`,
    `CREATE TABLE IF NOT EXISTS projection_settings (id integer PRIMARY KEY DEFAULT 1, base_method text NOT NULL DEFAULT 'trailing3', growth_pct numeric NOT NULL DEFAULT 0, overrides jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now())`,
    // Cash Flow Command — what-to-pay-when obligations (tiers + audit trail + cash position).
    `CREATE TABLE IF NOT EXISTS cash_obligations (id varchar PRIMARY KEY DEFAULT gen_random_uuid(), label text NOT NULL, payee text, category text NOT NULL DEFAULT 'vendor_bill', amount numeric(14,2) NOT NULL DEFAULT 0, amount_estimated boolean NOT NULL DEFAULT false, due_date date, cadence text NOT NULL DEFAULT 'one_time', criticality text NOT NULL DEFAULT 'important', pay_from text, status text NOT NULL DEFAULT 'pending', source text NOT NULL DEFAULT 'manual', external_key text, rationale text, source_ref text, approved_by text, approved_at timestamptz, paid_at timestamptz, is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`,
    `ALTER TABLE cash_obligations ADD COLUMN IF NOT EXISTS tier text`,
    `ALTER TABLE cash_obligations ADD COLUMN IF NOT EXISTS method text DEFAULT 'ach'`,
    `ALTER TABLE cash_obligations ADD COLUMN IF NOT EXISTS anomaly_flag boolean NOT NULL DEFAULT false`,
    `ALTER TABLE cash_obligations ADD COLUMN IF NOT EXISTS anomaly_reason text`,
    `ALTER TABLE cash_obligations ADD COLUMN IF NOT EXISTS vendor_id varchar`,
    `CREATE UNIQUE INDEX IF NOT EXISTS cash_obligations_external_key_idx ON cash_obligations(external_key) WHERE external_key IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS cash_obligations_due_idx ON cash_obligations(due_date) WHERE is_active`,
    `CREATE TABLE IF NOT EXISTS cash_vendors (id varchar PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE NOT NULL, default_tier text, default_method text, is_1099 boolean, notes text, created_at timestamptz NOT NULL DEFAULT now())`,
    `CREATE TABLE IF NOT EXISTS vendor_payment_plans (id varchar PRIMARY KEY DEFAULT gen_random_uuid(), vendor_match text NOT NULL, display_name text, amount numeric(14,2) NOT NULL, cadence text NOT NULL DEFAULT 'weekly', tier text NOT NULL DEFAULT 'tier2', note text, is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now())`,
    `ALTER TABLE qb_financial_snapshots ADD COLUMN IF NOT EXISTS qb_inventory numeric(14,2)`,
    `CREATE OR REPLACE FUNCTION payment_actions_append_only() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'payment_actions is append-only (segregation-of-duties audit trail)'; END; $$ LANGUAGE plpgsql`,
    `DROP TRIGGER IF EXISTS payment_actions_no_mutate ON payment_actions`,
    `CREATE TRIGGER payment_actions_no_mutate BEFORE UPDATE OR DELETE ON payment_actions FOR EACH ROW EXECUTE FUNCTION payment_actions_append_only()`,
    `ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS subtotal_amount real`,
    `ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS tax_amount real`,
    `ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS discount_amount real`,
    `CREATE TABLE IF NOT EXISTS payment_actions (id varchar PRIMARY KEY DEFAULT gen_random_uuid(), obligation_id varchar, action text NOT NULL, acted_by text, acted_by_name text, amount numeric(14,2), note text, acted_at timestamptz NOT NULL DEFAULT now())`,
    `CREATE INDEX IF NOT EXISTS payment_actions_obl_idx ON payment_actions(obligation_id)`,
    `CREATE TABLE IF NOT EXISTS cash_position (id varchar PRIMARY KEY DEFAULT gen_random_uuid(), as_of date NOT NULL DEFAULT current_date, cash_on_hand numeric(14,2) NOT NULL DEFAULT 0, expected_inflows numeric(14,2) NOT NULL DEFAULT 0, source text DEFAULT 'qbo', updated_at timestamptz NOT NULL DEFAULT now())`,
    `CREATE OR REPLACE VIEW v_pay_order AS select o.*, case coalesce(o.tier, case when o.category in ('tax','payroll') then 'tier1' when o.criticality = 'must' then 'tier2' when o.criticality = 'important' then 'tier3' else 'tier4' end) when 'mca' then 0 when 'tier1' then 1 when 'tier2' then 2 when 'tier3' then 3 when 'tier4' then 4 when 'hold' then 9 else 3 end as tier_rank from cash_obligations o where o.is_active and o.status <> 'paid' order by tier_rank, due_date nulls last, amount desc`,
    // Per-campaign monthly ad performance (month-over-month trend by campaign).
    `CREATE TABLE IF NOT EXISTS ad_campaign_performance (id varchar PRIMARY KEY DEFAULT gen_random_uuid(), platform text NOT NULL, campaign_name text NOT NULL, month text NOT NULL, period_start date, period_end date, spend real NOT NULL DEFAULT 0, revenue real, purchases integer, impressions integer, source text, superseded boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now())`,
    `CREATE UNIQUE INDEX IF NOT EXISTS ad_campaign_perf_platform_campaign_month_idx ON ad_campaign_performance (platform, lower(campaign_name), month) WHERE superseded = false`,
    `CREATE INDEX IF NOT EXISTS ad_campaign_perf_month_idx ON ad_campaign_performance (month)`,
    // SKU mappings — created here too in case drizzle-kit push hasn't run.
    `CREATE TABLE IF NOT EXISTS sku_mappings (
       id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
       external_sku TEXT NOT NULL,
       canonical_sku TEXT NOT NULL,
       source TEXT NOT NULL,
       notes TEXT,
       created_at TIMESTAMP NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMP NOT NULL DEFAULT NOW()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS sku_mappings_external_source_idx ON sku_mappings(external_sku, source)`,
    `CREATE INDEX IF NOT EXISTS sku_mappings_canonical_sku_idx ON sku_mappings(canonical_sku)`,
    // ad_metrics_daily dimension columns + widened unique index. The old
    // (platform, sku, date) unique index must be dropped first since the new
    // one covers more columns. DO blocks swallow errors if columns/indexes
    // already exist or don't exist.
    `ALTER TABLE ad_metrics_daily ADD COLUMN IF NOT EXISTS campaign TEXT NOT NULL DEFAULT '_all'`,
    `ALTER TABLE ad_metrics_daily ADD COLUMN IF NOT EXISTS device TEXT NOT NULL DEFAULT '_all'`,
    `ALTER TABLE ad_metrics_daily ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT '_all'`,
    `DO $$ BEGIN DROP INDEX IF EXISTS ad_metrics_platform_sku_date_idx; EXCEPTION WHEN others THEN NULL; END $$`,
    `CREATE UNIQUE INDEX IF NOT EXISTS ad_metrics_platform_sku_date_idx ON ad_metrics_daily(platform, sku, date, campaign, device, country)`,
  ];
  for (const stmt of ADDS) {
    try {
      await client.query(stmt);
    } catch (err: any) {
      console.error(`[Startup Checks] ${stmt.split("\n")[0].slice(0, 80)}… failed:`, err?.message ?? err);
    }
  }
}

async function checkTablesExist(client: pg.PoolClient): Promise<CheckResult[]> {
  const result = await client.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY($1)`,
    [REQUIRED_TABLES as unknown as string[]],
  );
  const present = new Set(result.rows.map((r) => r.table_name));
  return REQUIRED_TABLES.map((t) => ({ table: t, exists: present.has(t) }));
}

async function applyLeadTimeMigration(client: pg.PoolClient): Promise<{
  fxUpdated: number;
  pednarUpdated: number;
}> {
  // User-spec WHERE clause: only fill in null values. Existing non-null
  // entries (someone manually set a different lead time) are preserved.
  const fx = await client.query(
    `UPDATE supplier_items
     SET lead_time_days = $1
     WHERE supplier_id = (SELECT id FROM suppliers WHERE name = 'FX Industries')
       AND lead_time_days IS NULL`,
    [FX_INDUSTRIES_LEAD_TIME],
  );
  const pednar = await client.query(
    `UPDATE supplier_items
     SET lead_time_days = $1
     WHERE supplier_id = (SELECT id FROM suppliers WHERE name = 'Pednar')
       AND lead_time_days IS NULL`,
    [PEDNAR_LEAD_TIME],
  );
  return {
    fxUpdated: fx.rowCount ?? 0,
    pednarUpdated: pednar.rowCount ?? 0,
  };
}

// Push 1.0 / Push 2.0 packaging box swap. Mirrors
// migration_swap_push_packaging_boxes.sql so a Railway deploy auto-applies
// the change without a manual psql step. Idempotent — the JOIN against
// items.sku means once the swap has happened, the old component_id is no
// longer in any bill_of_materials row and re-runs match nothing.
async function swapPushPackagingBoxes(client: pg.PoolClient): Promise<{
  push10Updated: number;
  push20Updated: number;
}> {
  const push10 = await client.query(
    `UPDATE bill_of_materials
     SET component_id = new_box.id
     FROM items AS old_box, items AS new_box
     WHERE bill_of_materials.component_id = old_box.id
       AND old_box.sku = 'SBR-PKG-BOXP10'
       AND new_box.sku = 'SBR-PKG-BOXP10-NEW'`,
  );
  const push20 = await client.query(
    `UPDATE bill_of_materials
     SET component_id = new_box.id
     FROM items AS old_box, items AS new_box
     WHERE bill_of_materials.component_id = old_box.id
       AND old_box.sku = 'SBR-PKG-BOXP20'
       AND new_box.sku = 'SBR-PKG-BOXP20-NEW'`,
  );
  return {
    push10Updated: push10.rowCount ?? 0,
    push20Updated: push20.rowCount ?? 0,
  };
}

// Seed the tier on known suppliers. Idempotent — runs an UPDATE for the
// strategic set and a separate UPDATE for the transactional set, gated on
// `tier = 'transactional'` (the default) so we never clobber a value an
// operator has set deliberately. Match by ILIKE so casing variants in the
// DB ("FX Industries", "FX INDUSTRIES", "Fx Industries") all resolve.
const STRATEGIC_NAMES = [
  "FX Industries",
  "Silver Fox",
  "Acu-Form",
  "Pednar",
  "Liston Metalworks",
  "Austi Enterprises",
];
// Default brief cadence for strategic suppliers — operators can override
// per-row from the supplier detail page.
const STRATEGIC_DEFAULT_BRIEF_CADENCE = "monthly";

async function seedSupplierTiers(client: pg.PoolClient): Promise<{
  strategicUpdated: number;
  cadenceUpdated: number;
}> {
  let strategicUpdated = 0;
  for (const name of STRATEGIC_NAMES) {
    const r = await client.query(
      `UPDATE suppliers
       SET tier = 'strategic'
       WHERE LOWER(name) LIKE LOWER($1) AND tier = 'transactional'`,
      [`${name}%`],
    );
    strategicUpdated += r.rowCount ?? 0;
  }
  // Set the default brief cadence on any strategic supplier that doesn't
  // have one yet. Separate from tier seeding so an operator promoting a
  // row to strategic later still gets a sensible default.
  const cadence = await client.query(
    `UPDATE suppliers
     SET forecast_brief_schedule = $1
     WHERE tier = 'strategic' AND forecast_brief_schedule = 'never'`,
    [STRATEGIC_DEFAULT_BRIEF_CADENCE],
  );
  return { strategicUpdated, cadenceUpdated: cadence.rowCount ?? 0 };
}

// Seed initial Shopify SKU aliases. ON CONFLICT DO NOTHING means re-runs
// don't trample operator-edited rows. The "SBR-PB-Industrial" mapping is
// flagged as needs-verify in notes since the spec wasn't sure which
// canonical SKU it actually maps to.
async function seedSkuMappings(client: pg.PoolClient): Promise<number> {
  const SEED_ROWS: { external: string; canonical: string; source: string; notes?: string }[] = [
    { external: "SBR-Classic1.0", canonical: "SBR-PUSH-1.0", source: "shopify" },
    {
      external: "SBR-PB-Industrial",
      canonical: "SBR-PB-BIGFOOT",
      source: "shopify",
      notes: "VERIFY: imported from spec; confirm Shopify variant maps to Bigfoot vs Original",
    },
  ];
  let inserted = 0;
  for (const row of SEED_ROWS) {
    const r = await client.query(
      `INSERT INTO sku_mappings (external_sku, canonical_sku, source, notes)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (external_sku, source) DO NOTHING`,
      [row.external, row.canonical, row.source, row.notes ?? null],
    );
    inserted += r.rowCount ?? 0;
  }
  return inserted;
}

// Seed reorder_priority for known finished-product SKUs. Idempotent — only
// touches rows still on the 'accessory' default so an operator who manually
// re-grouped an item via the items table isn't clobbered.
async function seedReorderPriority(client: pg.PoolClient): Promise<{
  coreUpdated: number;
  comboUpdated: number;
  refurbishedUpdated: number;
  replacementUpdated: number;
}> {
  const setGroup = async (skus: string[], group: string) => {
    if (skus.length === 0) return 0;
    const r = await client.query(
      `UPDATE items SET reorder_priority = $1
       WHERE reorder_priority = 'accessory' AND sku = ANY($2::text[])`,
      [group, skus],
    );
    return r.rowCount ?? 0;
  };

  const coreUpdated = await setGroup(
    ["SBR-PUSH-1.0", "SBR-Extrawide2.0", "SBR-PB-ORIG", "SBR-PB-BIGFOOT"],
    "core_build",
  );
  const comboUpdated = await setGroup(
    ["#701-CMB-1", "#702-CMB-2", "#703-CMB-3", "#704-CMB-4"],
    "combo",
  );
  const refurbishedUpdated = await setGroup(
    ["#RF-141-PSH-M1", "#RF-241-PSH-M2", "#RF-1041-PB-M1", "#RF-1241-PB-M2"],
    "refurbished",
  );
  // Replacement SKUs follow a "#<digits>-REP-..." pattern (e.g. #301-REP-M1).
  const repResult = await client.query(
    `UPDATE items SET reorder_priority = 'replacement'
     WHERE reorder_priority = 'accessory' AND sku ~ '^#[0-9]+-REP-'`,
  );

  return {
    coreUpdated,
    comboUpdated,
    refurbishedUpdated,
    replacementUpdated: repResult.rowCount ?? 0,
  };
}

/**
 * Soft check for Extensiv credentials at boot. The 4-hour sync scheduler
 * iterates users and skips per-user when credentials are missing; this
 * just surfaces the gate at boot so an operator scanning the deploy log
 * sees the issue without having to wait for the first scheduled tick.
 *
 * Looks in two places:
 *   1. Per-user integration_settings (apiKey + warehouseId)
 *   2. Env-var fallbacks (EXTENSIV_CLIENT_ID + EXTENSIV_CLIENT_SECRET,
 *      or EXTENSIV_API_KEY for the legacy single-key flow)
 *
 * Doesn't block boot — fail-soft pattern, just logs.
 */
async function checkExtensivCredentials(client: pg.PoolClient): Promise<void> {
  const envOk =
    !!(process.env.EXTENSIV_CLIENT_ID && process.env.EXTENSIV_CLIENT_SECRET) ||
    !!process.env.EXTENSIV_API_KEY;

  // integration_settings is keyed (user_id, integration_name); we just
  // want to know if ANY user has Extensiv set up.
  let dbHasCreds = false;
  try {
    const result = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM integration_settings
        WHERE LOWER(integration_name) = 'extensiv'
          AND api_key IS NOT NULL
          AND api_key <> ''`,
    );
    dbHasCreds = (result.rows[0]?.count ?? "0") !== "0";
  } catch (err: any) {
    // Table missing on a fresh DB is not a problem worth raising here —
    // the scheduler will fail-soft on the actual sync attempt.
    console.warn(
      "[Startup Checks] Could not read integration_settings while checking Extensiv creds:",
      err?.message ?? err,
    );
  }

  if (envOk || dbHasCreds) {
    console.log(
      `[Extensiv] Credentials available (env=${envOk}, db=${dbHasCreds}) — sync scheduler can run.`,
    );
  } else {
    console.warn(
      "[Extensiv] Credentials not configured — sync scheduler will run but skip with warning.",
    );
  }
}

async function cleanupRollsMadeRows(client: pg.PoolClient): Promise<number> {
  // The "rolls_made" action was removed when we discovered SBR buys
  // foam rollers from Pednar rather than producing them. Existing rows
  // from before the removal are stale test data. Idempotent — first run
  // deletes them, subsequent runs find none.
  const result = await client.query(
    `DELETE FROM production_logs WHERE action_type = 'rolls_made'`,
  );
  return result.rowCount ?? 0;
}

// Auto-seed historical P&L data from the QuickBooks snapshot if the table is
// empty. Uses ON CONFLICT (year, month) DO NOTHING for safety so re-runs or
// partial seeds never create duplicates. Non-fatal — boot continues on error.
async function seedHistoricalPLIfEmpty(client: pg.PoolClient): Promise<void> {
  const countResult = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM historical_monthly_sales`,
  );
  const existingCount = parseInt(countResult.rows[0]?.count ?? "0", 10);

  if (existingCount > 0) {
    console.log(`[Startup Checks] Historical P&L already populated (${existingCount} rows)`);
    return;
  }

  let inserted = 0;
  for (const row of HISTORICAL_PL_DATA) {
    const grossMarginPct =
      row.totalIncome > 0
        ? (row.grossProfit / row.totalIncome) * 100
        : 0;
    const r = await client.query(
      `INSERT INTO historical_monthly_sales
         (year, month, revenue, returns, total_income, cogs, gross_profit,
          ad_spend, total_expenses, net_income, gross_margin_pct, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'quickbooks')
       ON CONFLICT (year, month) DO NOTHING`,
      [
        row.year,
        row.month,
        row.grossSales,
        row.returns,
        row.totalIncome,
        row.cogs,
        row.grossProfit,
        row.adSpend,
        row.totalExpenses,
        row.netIncome,
        grossMarginPct,
      ],
    );
    inserted += r.rowCount ?? 0;
  }
  console.log(`[Startup Checks] Seeded ${inserted} months of historical P&L data`);
}

async function seedZoKpiIfEmpty(client: pg.PoolClient): Promise<void> {
  const countResult = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM ad_metrics_daily WHERE platform = 'GOOGLE' AND campaign <> '_all'`,
  );
  const existingCount = parseInt(countResult.rows[0]?.count ?? "0", 10);

  if (existingCount > 100) {
    console.log(`[Startup Checks] Zo KPI campaign data already populated (${existingCount} rows)`);
    return;
  }

  let inserted = 0;
  for (const row of ZO_KPI_DATA) {
    if (row.spend <= 0 && row.revenue <= 0) continue;
    const r = await client.query(
      `INSERT INTO ad_metrics_daily
         (platform, sku, date, campaign, device, country, impressions, clicks, spend, conversions, revenue, currency)
       VALUES ('GOOGLE', 'ACCOUNT', $1, $2, '_all', '_all', 0, 0, $3, $4, $5, 'USD')
       ON CONFLICT (platform, sku, date, campaign, device, country) DO NOTHING`,
      [row.date, row.campaign, row.spend, Math.round(row.conversions), row.revenue],
    );
    inserted += r.rowCount ?? 0;
  }
  console.log(`[Startup Checks] Seeded ${inserted} Zo KPI campaign rows into ad_metrics_daily`);
}

/**
 * Comprehensive schema-vs-DB drift radar. Introspects EVERY Drizzle table in
 * shared/schema.ts at runtime and compares its expected columns against the
 * live database. Unlike ensureTablesExist/ensureColumnsExist (which only know
 * a hardcoded list of tables that previously broke), this catches ANY drift —
 * the recurring failure mode where a table/column added in code never reaches
 * the DB because drizzle-kit push is skipped at build time (no DATABASE_URL).
 *
 * Reports only (non-destructive): logs to the console AND system_logs so the
 * /health page surfaces it. The startup-migrations runner remains where
 * additive drift is actually FIXED; this is the early-warning radar so the
 * next gap is caught automatically instead of by luck.
 */
async function reportSchemaDrift(client: pg.PoolClient): Promise<void> {
  const expected: { table: string; columns: string[] }[] = [];
  for (const val of Object.values(schema)) {
    if (is(val, PgTable)) {
      const columns = Object.values(getTableColumns(val)).map((c: any) => c.name);
      expected.push({ table: getTableName(val), columns });
    }
  }

  const colRes = await client.query(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`,
  );
  const actual = new Map<string, Set<string>>();
  for (const row of colRes.rows) {
    if (!actual.has(row.table_name)) actual.set(row.table_name, new Set());
    actual.get(row.table_name)!.add(row.column_name);
  }

  const drift: string[] = [];
  for (const { table, columns } of expected) {
    if (!actual.has(table)) {
      drift.push(`MISSING TABLE: ${table}`);
      continue;
    }
    const have = actual.get(table)!;
    const missing = columns.filter((c) => !have.has(c));
    if (missing.length) drift.push(`${table} missing column(s): ${missing.join(", ")}`);
  }

  if (drift.length === 0) {
    console.log(`[Startup Checks] Schema drift: none (${expected.length} tables verified against DB)`);
    return;
  }

  console.error(
    `[Startup Checks] SCHEMA DRIFT DETECTED — ${drift.length} issue(s): ${drift.join(" | ")}. ` +
      `Add the matching additive migration to server/startup-migrations.ts.`,
  );
  try {
    await client.query(
      `INSERT INTO system_logs (type, severity, code, message, details) VALUES ($1, $2, $3, $4, $5)`,
      [
        "SCHEMA_DRIFT",
        "WARNING",
        "SCHEMA_DRIFT",
        `Schema drift detected at startup: ${drift.length} issue(s)`,
        JSON.stringify({ issues: drift }),
      ],
    );
  } catch (e: any) {
    console.error(`[Startup Checks] Could not record schema drift to system_logs: ${e?.message ?? e}`);
  }
}

export async function runStartupChecks(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.warn("[Startup Checks] DATABASE_URL not set — skipping checks");
    return;
  }

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  pool.on("error", (err: any) => console.error("[Pool:startup-checks] idle client error (handled):", err?.message ?? err));
  let client: pg.PoolClient | null = null;
  try {
    client = await pool.connect();

    // ── Force-create then verify ───────────────────────────────────────
    // Belt-and-suspenders: drizzle-kit push is the canonical migration
    // path, but production was caught with two of these tables missing
    // anyway. Running CREATE TABLE IF NOT EXISTS first means the
    // existence check below should always pass on a healthy database.
    try {
      await ensureTablesExist(client);
    } catch (err: any) {
      console.error("[Startup Checks] ensureTablesExist failed:", err?.message ?? err);
    }
    try {
      await ensureColumnsExist(client);
    } catch (err: any) {
      console.error("[Startup Checks] ensureColumnsExist failed:", err?.message ?? err);
    }
    try {
      await ensureProductionLogsShape(client);
    } catch (err: any) {
      console.error("[Startup Checks] ensureProductionLogsShape failed:", err?.message ?? err);
    }

    // ── Auto-seed historical P&L from QuickBooks snapshot ──────────────
    // Tables must exist before we can seed — this runs after
    // ensureTablesExist which creates historical_monthly_sales.
    try {
      await seedHistoricalPLIfEmpty(client);
    } catch (err: any) {
      console.error("[Startup Checks] Historical P&L seed failed:", err?.message ?? err);
    }

    try {
      await seedZoKpiIfEmpty(client);
    } catch (err: any) {
      console.error("[Startup Checks] Zo KPI seed failed:", err?.message ?? err);
    }

    let allOk = true;
    try {
      const tableResults = await checkTablesExist(client);
      for (const r of tableResults) {
        if (r.exists) {
          console.log(`[Startup Checks] OK: table ${r.table} exists`);
        } else {
          allOk = false;
          console.error(
            `[Startup Checks] MISSING TABLE: ${r.table}. ` +
            `CREATE TABLE IF NOT EXISTS attempted but the table is still ` +
            `missing — investigate the previous error log line.`,
          );
        }
      }
      if (!allOk) {
        console.error(
          "[Startup Checks] One or more required tables are missing. " +
          "Affected features will return 500 until the schema is applied.",
        );
      }
    } catch (err: any) {
      console.error("[Startup Checks] Table existence check failed:", err?.message ?? err);
    }

    // ── Comprehensive schema drift radar ────────────────────────────────
    // Beyond the hardcoded table/column checks above: introspect every
    // Drizzle table and flag ANY missing table/column so future drift is
    // caught automatically instead of breaking a feature in prod first.
    try {
      await reportSchemaDrift(client);
    } catch (err: any) {
      console.error("[Startup Checks] Schema drift radar failed:", err?.message ?? err);
    }

    // ── Lead-time data migration ────────────────────────────────────────
    // Idempotent — only fills in NULL values; existing non-null entries
    // are preserved so manual edits aren't clobbered.
    try {
      const { fxUpdated, pednarUpdated } = await applyLeadTimeMigration(client);
      if (fxUpdated > 0 || pednarUpdated > 0) {
        console.log(
          `[Startup Checks] Applied lead-time migration: ` +
          `FX Industries=${FX_INDUSTRIES_LEAD_TIME}d (${fxUpdated} row${fxUpdated === 1 ? "" : "s"}), ` +
          `Pednar=${PEDNAR_LEAD_TIME}d (${pednarUpdated} row${pednarUpdated === 1 ? "" : "s"})`,
        );
      } else {
        console.log("[Startup Checks] Lead-time migration already applied (no NULL rows remaining)");
      }
    } catch (err: any) {
      // Most likely cause: supplier_items table doesn't exist yet (fresh DB).
      // Don't crash — just log so an operator can investigate.
      console.error("[Startup Checks] Lead-time migration failed:", err?.message ?? err);
    }

    // ── Push 1.0 / Push 2.0 packaging box swap ─────────────────────────
    // Idempotent BOM data migration. Once the old component_id has been
    // replaced, subsequent runs match zero rows and stay silent.
    try {
      const { push10Updated, push20Updated } = await swapPushPackagingBoxes(client);
      if (push10Updated > 0 || push20Updated > 0) {
        console.log(
          `[Startup Checks] Swapped Push packaging boxes in BOM: ` +
          `Push 1.0=${push10Updated} row${push10Updated === 1 ? "" : "s"}, ` +
          `Push 2.0=${push20Updated} row${push20Updated === 1 ? "" : "s"}`,
        );
      }
    } catch (err: any) {
      console.error("[Startup Checks] Push packaging box swap failed:", err?.message ?? err);
    }

    // ── Strategic-supplier tier seed ────────────────────────────────────
    // Marks the six strategic suppliers as such (idempotent — only updates
    // rows still on the 'transactional' default) and sets a monthly brief
    // cadence on any strategic supplier still on 'never'.
    try {
      const { strategicUpdated, cadenceUpdated } = await seedSupplierTiers(client);
      if (strategicUpdated > 0 || cadenceUpdated > 0) {
        console.log(
          `[Startup Checks] Supplier tier seed: ` +
          `${strategicUpdated} promoted to strategic, ` +
          `${cadenceUpdated} set to monthly cadence`,
        );
      }
    } catch (err: any) {
      console.error("[Startup Checks] Supplier tier seed failed:", err?.message ?? err);
    }

    // ── Products page priority seed ─────────────────────────────────────
    try {
      const r = await seedReorderPriority(client);
      const total = r.coreUpdated + r.comboUpdated + r.refurbishedUpdated + r.replacementUpdated;
      if (total > 0) {
        console.log(
          `[Startup Checks] Reorder priority seed: ` +
          `core=${r.coreUpdated}, combo=${r.comboUpdated}, ` +
          `refurbished=${r.refurbishedUpdated}, replacement=${r.replacementUpdated}`,
        );
      }
    } catch (err: any) {
      console.error("[Startup Checks] Reorder priority seed failed:", err?.message ?? err);
    }

    // ── SKU mapping seed ────────────────────────────────────────────────
    try {
      const seeded = await seedSkuMappings(client);
      if (seeded > 0) {
        console.log(`[Startup Checks] Seeded ${seeded} SKU mapping${seeded === 1 ? "" : "s"}`);
      }
    } catch (err: any) {
      console.error("[Startup Checks] SKU mapping seed failed:", err?.message ?? err);
    }

    // ── Cleanup legacy rolls_made rows ──────────────────────────────────
    try {
      const deleted = await cleanupRollsMadeRows(client);
      if (deleted > 0) {
        console.log(`[Startup Checks] Removed ${deleted} legacy rolls_made row${deleted === 1 ? "" : "s"} from production_logs`);
      }
    } catch (err: any) {
      console.error("[Startup Checks] rolls_made cleanup failed:", err?.message ?? err);
    }

    // ── Extensiv credential availability ────────────────────────────────
    try {
      await checkExtensivCredentials(client);
    } catch (err: any) {
      console.error("[Startup Checks] Extensiv credential check failed:", err?.message ?? err);
    }
  } catch (err: any) {
    console.error("[Startup Checks] Could not connect to database:", err?.message ?? err);
  } finally {
    if (client) client.release();
    await pool.end().catch(() => {});
  }
}
