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
