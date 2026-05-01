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

const REQUIRED_TABLES = [
  "production_logs",
  "shop_issues",
  "daily_briefings",
  "inventory_lots",
  "lot_consumption_events",
  "backorder_notices",
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
    `ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS confirmed_qty INTEGER`,
    `ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS expected_completion_date TIMESTAMP`,
    // Supplier forecast-tier columns.
    `ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'transactional'`,
    `ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS forecast_brief_schedule TEXT NOT NULL DEFAULT 'never'`,
    `ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS auto_send_briefs BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS last_forecast_brief_sent_at TIMESTAMP`,
    // Per-item seasonal demand multiplier.
    `ALTER TABLE items ADD COLUMN IF NOT EXISTS seasonal_multiplier REAL NOT NULL DEFAULT 1.0`,
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

export async function runStartupChecks(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.warn("[Startup Checks] DATABASE_URL not set — skipping checks");
    return;
  }

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
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
  } catch (err: any) {
    console.error("[Startup Checks] Could not connect to database:", err?.message ?? err);
  } finally {
    if (client) client.release();
    await pool.end().catch(() => {});
  }
}
