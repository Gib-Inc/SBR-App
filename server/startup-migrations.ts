import pg from "pg";
const { Client } = pg;

/**
 * Additive schema migrations applied at APP STARTUP — where DATABASE_URL is
 * available, unlike the Railway build, where `drizzle-kit push` is skipped (no
 * DB at build time) so schema changes never reach the live database and break
 * the app on deploy.
 *
 * RULES for entries:
 *  - Idempotent (IF NOT EXISTS). They run on every boot.
 *  - ADDITIVE ONLY — add a column or index. Never drop/rewrite data here.
 *  - Data-dependent or destructive migrations (e.g. de-dupe then add a UNIQUE
 *    constraint) stay manual and explicitly authorized. This runner is only for
 *    safe additive DDL, so it can run unattended on every deploy.
 *
 * When you add a column to shared/schema.ts, add the matching
 * `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...` here.
 */
const STARTUP_MIGRATIONS: { name: string; sql: string }[] = [
  {
    name: "purchase_order_lines.supplier_item_code",
    sql: `ALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS supplier_item_code text`,
  },
  {
    name: "purchase_order_lines.internal_barcode",
    sql: `ALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS internal_barcode text`,
  },

  // --- Drift back-fill (2026-06-05 full schema-vs-DB audit) ---------------
  // These objects exist in shared/schema.ts but never reached the live DB
  // because drizzle-kit push is skipped at build time (no DATABASE_URL). Found
  // by diffing every pgTable's expected columns against information_schema.
  //
  // inventory_transactions was REDESIGNED in code (item_id/type/location) but
  // the live table was frozen in its old shape (sku/transaction_type). Every
  // one of the ~20 createInventoryTransaction() call sites — PO receive,
  // production, adjustments — emits an INSERT against columns that did not
  // exist, so the moment any of those flows runs it throws. Safe to back-fill
  // additively: the table has 0 rows and the only NOT NULL column (quantity)
  // is always supplied by the code. Old vestigial columns stay, harmless.
  {
    name: "inventory_transactions.redesign_columns",
    sql: `ALTER TABLE inventory_transactions
            ADD COLUMN IF NOT EXISTS item_id varchar,
            ADD COLUMN IF NOT EXISTS item_type text,
            ADD COLUMN IF NOT EXISTS type text,
            ADD COLUMN IF NOT EXISTS location text,
            ADD COLUMN IF NOT EXISTS created_by text,
            ADD COLUMN IF NOT EXISTS notes text`,
  },
  {
    name: "inventory_transactions.item_id_idx",
    sql: `CREATE INDEX IF NOT EXISTS inventory_transactions_item_id_idx ON inventory_transactions (item_id)`,
  },
  {
    name: "inventory_transactions.created_at_idx",
    sql: `CREATE INDEX IF NOT EXISTS inventory_transactions_created_at_idx ON inventory_transactions (created_at)`,
  },
  // morning_trap_runs.shopify_gross_sales — written by MorningTrapService;
  // missing column means the gross-sales figure silently never persisted.
  {
    name: "morning_trap_runs.shopify_gross_sales",
    sql: `ALTER TABLE morning_trap_runs ADD COLUMN IF NOT EXISTS shopify_gross_sales numeric(12,2) DEFAULT '0'`,
  },
  // copy_performance.spend/revenue — ROAS math reads these; absent columns
  // would null out spend/revenue for every copy-performance row.
  {
    name: "copy_performance.spend",
    sql: `ALTER TABLE copy_performance ADD COLUMN IF NOT EXISTS spend numeric(12,2) DEFAULT '0'`,
  },
  {
    name: "copy_performance.revenue",
    sql: `ALTER TABLE copy_performance ADD COLUMN IF NOT EXISTS revenue numeric(12,2) DEFAULT '0'`,
  },
  // password_resets — table absent entirely, so the password-reset flow 500s
  // on first use. CREATE TABLE IF NOT EXISTS is purely additive.
  {
    name: "password_resets.table",
    sql: `CREATE TABLE IF NOT EXISTS password_resets (
            id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token text NOT NULL UNIQUE,
            expires_at timestamp NOT NULL,
            used_at timestamp,
            created_at timestamp NOT NULL DEFAULT now()
          )`,
  },
  // CIPH.R Phase 1 — financial-position snapshots from QuickBooks.
  {
    name: "qb_financial_snapshots.table",
    sql: `CREATE TABLE IF NOT EXISTS qb_financial_snapshots (
            id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
            captured_at timestamp NOT NULL DEFAULT now(),
            cash_on_hand numeric(14,2),
            accounts_receivable numeric(14,2),
            accounts_payable numeric(14,2),
            ar_aging jsonb,
            ap_aging jsonb,
            operating_expenses numeric(14,2),
            gross_profit numeric(14,2),
            net_income numeric(14,2),
            total_income numeric(14,2),
            pl_period_start date,
            pl_period_end date,
            realm_id text,
            data_gaps jsonb,
            confidence integer,
            raw jsonb,
            created_at timestamp NOT NULL DEFAULT now()
          )`,
  },
  {
    name: "qb_financial_snapshots.captured_at_idx",
    sql: `CREATE INDEX IF NOT EXISTS qb_financial_snapshots_captured_at_idx ON qb_financial_snapshots (captured_at)`,
  },
];

export async function runStartupMigrations(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("[Startup Migrations] No DATABASE_URL — skipping (dev/MemStorage).");
    return;
  }

  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  let ok = 0;
  try {
    await client.connect();
    for (const m of STARTUP_MIGRATIONS) {
      try {
        await client.query(m.sql);
        ok++;
      } catch (e: any) {
        console.error(`[Startup Migrations] "${m.name}" failed: ${e?.message ?? e}`);
      }
    }
    console.log(`[Startup Migrations] Ensured ${ok}/${STARTUP_MIGRATIONS.length} additive migration(s).`);
  } catch (e: any) {
    console.error(`[Startup Migrations] DB connection failed (continuing boot): ${e?.message ?? e}`);
  } finally {
    try {
      await client.end();
    } catch {
      /* ignore */
    }
  }
}
