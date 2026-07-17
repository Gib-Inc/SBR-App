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

  // Weighted-average cost per unit — Pillar 2 of the FinOps engine. Maintained
  // by InventoryMovement on component PO receipts and finished-goods builds.
  {
    name: "items.wac_unit_cost",
    sql: `ALTER TABLE items ADD COLUMN IF NOT EXISTS wac_unit_cost real`,
  },

  // "Order on their site" suppliers default the Create-PO sheet to record-only
  // (file the PO, never send it). Set true for Uline/Amazon/Home Depot/etc.
  {
    name: "suppliers.record_only_default",
    sql: `ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS record_only_default boolean NOT NULL DEFAULT false`,
  },

  // Duplicate-order guard. 2026-06 incidents: (1) a re-running sync cloned each
  // order ~10x; (2) the SAME Shopify order was stored under two channels
  // (SHOPIFY + a relabeled AMAZON twin), $27k double-counted. external_order_id
  // (the Shopify order id, also used for Codisto Amazon-bridge orders) is the
  // canonical PHYSICAL identity, so the unique index is on external_order_id
  // ALONE (channel-agnostic) — a channel-scoped index let the twins through.
  // createSalesOrder's recovery looks up by external id alone and updates the
  // existing row on 23505. Manual/legacy orders (null external id) are
  // unaffected by the partial predicate. Idempotent; prod was de-duped before
  // this landed.
  {
    name: "sales_orders.ux_extid",
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS ux_sales_orders_extid
            ON sales_orders (external_order_id)
            WHERE external_order_id IS NOT NULL`,
  },
  // NOTE: the prior (channel, external_order_id) index is deliberately NOT
  // dropped here. The migration runner isolates each entry's failure, so a DROP
  // in a separate entry would run even if the CREATE above failed (e.g. residual
  // dupes on some DB), leaving NO unique guard. The new external-id-alone index
  // is strictly stronger and subsumes the old one, so leaving the old one in
  // place is harmless redundancy. Prod's old index was dropped manually after a
  // verified clean de-dup; a fresh DB simply keeps both.

  // Forecast self-tuning loop (FinOps Pillar 4): one row per predicted day.
  // Nightly job grades predicted-vs-actual and stores the bias-correction
  // factor that tunes the next prediction + the runway revenue inputs.
  {
    name: "forecast_predictions.table",
    sql: `CREATE TABLE IF NOT EXISTS forecast_predictions (
            target_date date PRIMARY KEY,
            metric text NOT NULL DEFAULT 'daily_net_revenue',
            predicted real NOT NULL,
            raw_predicted real,
            correction_factor_used real,
            actual real,
            actualized_at timestamptz,
            created_at timestamptz NOT NULL DEFAULT now()
          )`,
  },

  // Supplier Intel snapshot — single latest row (id=1). Stores the computed
  // stockout/PO-needs payload so the page renders live data refreshed daily
  // at 6 AM MT (and on demand) instead of the old hardcoded constants.
  {
    name: "supplier_intel_snapshot.table",
    sql: `CREATE TABLE IF NOT EXISTS supplier_intel_snapshot (
            id integer PRIMARY KEY,
            computed_at timestamptz NOT NULL,
            trigger text,
            payload jsonb NOT NULL
          )`,
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
  // Idempotency ledger for inbound Shopify webhooks — one row per delivered webhook id,
  // so a retry/duplicate delivery can't double-process (e.g. double-decrement stock).
  {
    name: "shopify_webhook_events.table",
    sql: `CREATE TABLE IF NOT EXISTS shopify_webhook_events (
            webhook_id text PRIMARY KEY,
            topic text,
            processed_at timestamptz NOT NULL DEFAULT now()
          )`,
  },
  // CIPH.R Phase 2 — cash runway / burn-rate forecasts.
  {
    name: "financial_runway_forecasts.table",
    sql: `CREATE TABLE IF NOT EXISTS financial_runway_forecasts (
            id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
            snapshot_id varchar REFERENCES qb_financial_snapshots(id),
            timestamp timestamp NOT NULL DEFAULT now(),
            conservative_days integer,
            realistic_days integer,
            aggressive_days integer,
            calculated_burn_rate numeric(14,2),
            net_margin_average numeric(6,4),
            runway_status text NOT NULL DEFAULT 'HEALTHY',
            runway_data_gaps jsonb,
            created_at timestamp NOT NULL DEFAULT now()
          )`,
  },
  {
    name: "financial_runway_forecasts.timestamp_idx",
    sql: `CREATE INDEX IF NOT EXISTS financial_runway_forecasts_timestamp_idx ON financial_runway_forecasts (timestamp)`,
  },
  // CIPH.R Finances tab — monthly P&L (seeded from accountant export).
  {
    name: "monthly_financials.table",
    sql: `CREATE TABLE IF NOT EXISTS monthly_financials (
            id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
            month text NOT NULL,
            total_income numeric(14,2),
            total_cogs numeric(14,2),
            gross_profit numeric(14,2),
            total_expenses numeric(14,2),
            net_operating_income numeric(14,2),
            net_income numeric(14,2),
            expense_categories jsonb,
            source text NOT NULL DEFAULT 'accountant_seed',
            created_at timestamp NOT NULL DEFAULT now()
          )`,
  },
  {
    name: "monthly_financials.month_idx",
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS monthly_financials_month_idx ON monthly_financials (month)`,
  },
  // CIPH.R — accountant-reported discrepancies from the upload page.
  {
    name: "financial_discrepancies.table",
    sql: `CREATE TABLE IF NOT EXISTS financial_discrepancies (
            id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
            reported_by text,
            document_name text,
            message text NOT NULL,
            status text NOT NULL DEFAULT 'OPEN',
            created_at timestamp NOT NULL DEFAULT now()
          )`,
  },
  {
    name: "marketing_spend_snapshots.table",
    sql: `CREATE TABLE IF NOT EXISTS marketing_spend_snapshots (
            id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
            platform text NOT NULL,
            period_start date,
            period_end date,
            spend real NOT NULL DEFAULT 0,
            impressions integer,
            clicks integer,
            conversions integer,
            revenue real,
            currency text DEFAULT 'USD',
            source text,
            status text NOT NULL DEFAULT 'OK',
            data_gaps jsonb,
            raw jsonb,
            captured_at timestamp NOT NULL DEFAULT now(),
            created_at timestamp NOT NULL DEFAULT now()
          )`,
  },
  {
    name: "marketing_spend_snapshots.platform_idx",
    sql: `CREATE INDEX IF NOT EXISTS marketing_spend_snapshots_platform_idx ON marketing_spend_snapshots (platform)`,
  },
  {
    name: "marketing_spend_snapshots.period_idx",
    sql: `CREATE INDEX IF NOT EXISTS marketing_spend_snapshots_period_idx ON marketing_spend_snapshots (period_start, period_end)`,
  },
  {
    name: "marketing_spend_snapshots.reconciliation_columns",
    sql: `ALTER TABLE marketing_spend_snapshots
            ADD COLUMN IF NOT EXISTS source_hash text,
            ADD COLUMN IF NOT EXISTS superseded boolean NOT NULL DEFAULT false,
            ADD COLUMN IF NOT EXISTS superseded_at timestamp,
            ADD COLUMN IF NOT EXISTS superseded_by varchar`,
  },
  {
    name: "data_reconciliation_log.table",
    sql: `CREATE TABLE IF NOT EXISTS data_reconciliation_log (
            id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
            data_type text NOT NULL,
            entity_key text NOT NULL,
            action text NOT NULL,
            field text,
            old_value text,
            new_value text,
            reason text NOT NULL,
            source text,
            created_at timestamp NOT NULL DEFAULT now()
          )`,
  },
  {
    name: "data_reconciliation_log.created_at_idx",
    sql: `CREATE INDEX IF NOT EXISTS data_reconciliation_log_created_at_idx ON data_reconciliation_log (created_at)`,
  },
  {
    name: "data_reconciliation_log.data_type_idx",
    sql: `CREATE INDEX IF NOT EXISTS data_reconciliation_log_data_type_idx ON data_reconciliation_log (data_type)`,
  },
  {
    name: "credit_lines.table",
    sql: `CREATE TABLE IF NOT EXISTS credit_lines (
            id text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
            name text NOT NULL,
            type text NOT NULL DEFAULT 'card',
            qb_account_id text,
            qb_account_name text,
            balance numeric DEFAULT 0,
            credit_limit numeric,
            apr numeric,
            statement_day int,
            due_day int,
            notes text,
            is_active boolean NOT NULL DEFAULT true,
            balance_synced_at timestamptz,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
          )`,
  },
  {
    name: "credit_lines.qb_account_uidx",
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS ux_credit_lines_qb_account ON credit_lines (qb_account_id) WHERE qb_account_id IS NOT NULL`,
  },
  {
    // D3 debt keystone: per-facility payment terms. Without these columns the entire
    // ~$1.18M stack reads $0 in every runway, forecast, and pay order (obligations
    // seeded amount=0) and no daily MCA ACH total can exist anywhere. qb_missing_since
    // flags "ghost" facilities that vanished from QuickBooks but kept a balance here.
    name: "credit_lines.payment_terms",
    sql: `ALTER TABLE credit_lines
            ADD COLUMN IF NOT EXISTS payment_amount numeric,
            ADD COLUMN IF NOT EXISTS payment_frequency text,
            ADD COLUMN IF NOT EXISTS next_debit_date date,
            ADD COLUMN IF NOT EXISTS qb_missing_since timestamptz`,
  },
  {
    // G #14: the apr column conflates MCA factor rates with true APRs (Fresh Funding
    // scraped 9.72% from the QB name while its real factor cost is far higher; Shopify
    // Capital's 17% revenue-share reads NULL). rate_type makes the pricing model
    // EXPLICIT ('apr' | 'factor' | 'revenue_share') so cost-of-capital math and the
    // avalanche ranker stop trusting a number that lies for a third of the stack.
    name: "credit_lines.rate_structure",
    sql: `ALTER TABLE credit_lines
            ADD COLUMN IF NOT EXISTS rate_type text,
            ADD COLUMN IF NOT EXISTS factor_rate numeric,
            ADD COLUMN IF NOT EXISTS original_principal numeric,
            ADD COLUMN IF NOT EXISTS term_months integer,
            ADD COLUMN IF NOT EXISTS holdback_pct numeric`,
  },
  {
    // G #15: covenant tracking. The Fresh Funding anti-stacking breach (~$175K
    // accelerable) was the single largest near-term solvency event and completely
    // unmonitored — a breach converts a short runway into insolvency instantly.
    // Operator-maintained rows; the daily report alarms on status='breached'.
    name: "debt_covenants.table",
    sql: `CREATE TABLE IF NOT EXISTS debt_covenants (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            facility_name text NOT NULL,
            covenant_type text NOT NULL,
            description text,
            status text NOT NULL DEFAULT 'active',
            amount_at_risk numeric,
            source text,
            noted_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
          )`,
  },

  // BOOK.E bookkeeping agent — Claude-proposed recategorizations of QBO
  // transactions parked in Uncategorized Expense / Ask My Accountant. Rows are
  // written by the scan; QuickBooks is only written when a human approves
  // (status pending → applied). Natural key = one proposal per QBO txn line.
  {
    name: "qb_categorization_proposals.table",
    sql: `CREATE TABLE IF NOT EXISTS qb_categorization_proposals (
            id serial PRIMARY KEY,
            realm_id text NOT NULL,
            txn_type text NOT NULL,
            qb_txn_id text NOT NULL,
            qb_line_id text NOT NULL,
            txn_date date,
            doc_number text,
            vendor_name text,
            description text,
            amount numeric NOT NULL DEFAULT 0,
            current_account_id text NOT NULL,
            current_account_name text NOT NULL,
            proposed_account_id text NOT NULL,
            proposed_account_name text NOT NULL,
            confidence real NOT NULL,
            reasoning text,
            vendor_history jsonb,
            status text NOT NULL DEFAULT 'pending',
            decided_by text,
            decided_at timestamptz,
            apply_error text,
            created_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (realm_id, txn_type, qb_txn_id, qb_line_id)
          )`,
  },
  {
    name: "qb_categorization_proposals.status_idx",
    sql: `CREATE INDEX IF NOT EXISTS qb_cat_proposals_status_idx ON qb_categorization_proposals (status, confidence DESC)`,
  },

  // quickbooks_bills.raw_payload — full QBO Bill API response stored at sync
  // time (PO→QBO Bill create, and updates that receive a fresh QBO response).
  // Evidence source so the accounting-spine classifier can later prove
  // line-level explanations instead of inferring them.
  {
    name: "quickbooks_bills.raw_payload",
    sql: `ALTER TABLE quickbooks_bills ADD COLUMN IF NOT EXISTS raw_payload jsonb`,
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
