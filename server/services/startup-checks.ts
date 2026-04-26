// Startup checks — runs once during boot to verify the schema migrations and
// data migrations the rest of the app assumes are in place.
//
// Two purposes:
//
//   1. Fail-loud table existence check for the tables we added in recent
//      commits (production_logs, shop_issues, daily_briefings). Railway's
//      build script calls drizzle-kit push automatically, but if that step
//      ever fails silently the server still boots — without these checks
//      the first user to hit the affected route gets an unfriendly 500.
//
//   2. Idempotent data migration for the FX Industries / Pednar lead times
//      from migration_set_supplier_lead_times.sql. The UPDATE is gated on
//      "where current value != expected" so re-runs are no-ops.
//
// Boot continues even if a check fails — we want the server up so other
// routes work, but the failure is logged loudly so it's caught fast.

import pg from "pg";

const REQUIRED_TABLES = [
  "production_logs",
  "shop_issues",
  "daily_briefings",
] as const;

const FX_INDUSTRIES_LEAD_TIME = 21;
const PEDNAR_LEAD_TIME = 14;

type CheckResult = {
  table: string;
  exists: boolean;
};

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
  const fx = await client.query(
    `UPDATE supplier_items
     SET lead_time_days = $1
     WHERE supplier_id IN (SELECT id FROM suppliers WHERE LOWER(name) LIKE 'fx industries%')
       AND (lead_time_days IS NULL OR lead_time_days <> $1)`,
    [FX_INDUSTRIES_LEAD_TIME],
  );
  const pednar = await client.query(
    `UPDATE supplier_items
     SET lead_time_days = $1
     WHERE supplier_id IN (SELECT id FROM suppliers WHERE LOWER(name) LIKE 'pednar%')
       AND (lead_time_days IS NULL OR lead_time_days <> $1)`,
    [PEDNAR_LEAD_TIME],
  );
  return {
    fxUpdated: fx.rowCount ?? 0,
    pednarUpdated: pednar.rowCount ?? 0,
  };
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

    // ── Table existence ─────────────────────────────────────────────────
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
            `Run "npm run db:push" against the database to create it ` +
            `(it's defined in shared/schema.ts but the schema push didn't apply).`,
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
    // Idempotent — only writes when the stored value differs from spec.
    try {
      const { fxUpdated, pednarUpdated } = await applyLeadTimeMigration(client);
      if (fxUpdated > 0 || pednarUpdated > 0) {
        console.log(
          `[Startup Checks] Applied lead-time migration: ` +
          `FX Industries=${FX_INDUSTRIES_LEAD_TIME}d (${fxUpdated} row${fxUpdated === 1 ? "" : "s"}), ` +
          `Pednar=${PEDNAR_LEAD_TIME}d (${pednarUpdated} row${pednarUpdated === 1 ? "" : "s"})`,
        );
      } else {
        console.log("[Startup Checks] Lead-time migration already applied (no rows needed updating)");
      }
    } catch (err: any) {
      // Most likely cause: supplier_items table doesn't exist yet (fresh DB).
      // Don't crash — just log so an operator can investigate.
      console.error("[Startup Checks] Lead-time migration failed:", err?.message ?? err);
    }
  } catch (err: any) {
    console.error("[Startup Checks] Could not connect to database:", err?.message ?? err);
  } finally {
    if (client) client.release();
    await pool.end().catch(() => {});
  }
}
