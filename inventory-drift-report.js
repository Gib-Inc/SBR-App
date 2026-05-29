#!/usr/bin/env node

/**
 * Inventory Drift Report — Standalone Reconciliation Script
 *
 * Surfaces the expected divergence between the local sellable number
 * (available_for_sale_qty) and the Extensiv-mirrored physical-available number
 * (pivot_qty) for every finished product. After the C1 fix, EXTENSIV_SYNC no
 * longer auto-corrects available_for_sale_qty off the Extensiv delta — drift is
 * intentional and is meant to be *reported*, not silently reconciled. This is
 * that report.
 *
 * What "drift" means here:
 *   pivot_qty                 = Extensiv "Available" (OnHand − Allocated − OnHold),
 *                               the 3PL system-of-record sellable count.
 *   available_for_sale_qty    = local working number, driven by order create /
 *                               cancel / return / transfer / manual count events.
 *   drift = available_for_sale_qty − pivot_qty
 *
 * A small, slow-moving drift is normal (orders decrement afs locally before the
 * next Extensiv pull catches up). A large or persistent drift means the two
 * numbers have desynced and a manual count / investigation is warranted.
 *
 * It also flags STALE items: those whose extensiv_last_sync_at is older than the
 * freshness window (or never synced), because their pivot_qty can't be trusted
 * as a current baseline.
 *
 * Required environment variables:
 *   DATABASE_URL   - Railway PostgreSQL connection string (auto-set by Railway)
 *
 * Optional environment variables:
 *   DRIFT_THRESHOLD     - abs(drift) at/above which an item is flagged (default 5)
 *   STALE_HOURS         - hours since last Extensiv sync before "stale" (default 6)
 *   DRIFT_FAIL_ON_FLAG  - "true" → exit code 1 if any item is flagged (for CI/cron alerts)
 *
 * Usage:
 *   node inventory-drift-report.js          (run manually or via cron)
 *   npm run report:drift
 *
 * Recommended cron: 15 * * * *  (every hour at minute 15, just after the sync)
 *
 * This script is READ-ONLY. It never writes to the database.
 */

import pg from 'pg';
const { Client } = pg;

// ─── Configuration ───

const CONFIG = {
  databaseUrl: process.env.DATABASE_URL,
  driftThreshold: Number(process.env.DRIFT_THRESHOLD ?? 5),
  staleHours: Number(process.env.STALE_HOURS ?? 6),
  failOnFlag: String(process.env.DRIFT_FAIL_ON_FLAG ?? '').toLowerCase() === 'true',
};

function validateConfig() {
  if (!CONFIG.databaseUrl) {
    console.error('❌ Missing required environment variable: DATABASE_URL');
    console.error('Set this in Railway → your service → Variables tab');
    process.exit(1);
  }
  if (!Number.isFinite(CONFIG.driftThreshold) || CONFIG.driftThreshold < 0) {
    console.error(`❌ DRIFT_THRESHOLD must be a non-negative number (got "${process.env.DRIFT_THRESHOLD}")`);
    process.exit(1);
  }
  if (!Number.isFinite(CONFIG.staleHours) || CONFIG.staleHours < 0) {
    console.error(`❌ STALE_HOURS must be a non-negative number (got "${process.env.STALE_HOURS}")`);
    process.exit(1);
  }
}

// ─── Formatting helpers ───

function pad(value, width, align = 'left') {
  const s = String(value);
  if (s.length >= width) return s;
  const fill = ' '.repeat(width - s.length);
  return align === 'right' ? fill + s : s + fill;
}

function signed(n) {
  return n > 0 ? `+${n}` : String(n);
}

function hoursSince(date) {
  if (!date) return null;
  const ms = Date.now() - new Date(date).getTime();
  return ms / (1000 * 60 * 60);
}

function formatAge(hours) {
  if (hours === null) return 'never';
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${Math.floor(hours / 24)}d`;
}

// ─── Main ───

async function main() {
  validateConfig();

  const db = new Client({ connectionString: CONFIG.databaseUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();

  try {
    // Only finished products have the afs ↔ pivot relationship. Components track
    // current_stock and have no pivot mirror, so they're excluded by design.
    const { rows } = await db.query(
      `SELECT id, sku, name, extensiv_sku,
              available_for_sale_qty, pivot_qty, hildale_qty,
              extensiv_on_hand_snapshot, extensiv_last_sync_at
       FROM items
       WHERE type = 'finished_product'
       ORDER BY ABS(COALESCE(available_for_sale_qty, 0) - COALESCE(pivot_qty, 0)) DESC, sku ASC`
    );

    const analyzed = rows.map((r) => {
      const afs = r.available_for_sale_qty ?? 0;
      const pivot = r.pivot_qty ?? 0;
      const drift = afs - pivot;
      const ageHours = hoursSince(r.extensiv_last_sync_at);
      const stale = ageHours === null || ageHours > CONFIG.staleHours;
      const overThreshold = Math.abs(drift) >= CONFIG.driftThreshold;
      return { ...r, afs, pivot, drift, ageHours, stale, overThreshold, flagged: overThreshold || stale };
    });

    const flagged = analyzed.filter((r) => r.flagged);
    const drifters = analyzed.filter((r) => r.overThreshold);
    const stalers = analyzed.filter((r) => r.stale);

    console.log('');
    console.log('═══════════════════════════════════════════════════════════════════════');
    console.log('  INVENTORY DRIFT REPORT  (available_for_sale_qty vs pivot_qty)');
    console.log(`  Generated: ${new Date().toISOString()}`);
    console.log(`  Drift threshold: ±${CONFIG.driftThreshold}   Stale after: ${CONFIG.staleHours}h`);
    console.log('═══════════════════════════════════════════════════════════════════════');
    console.log('');
    console.log(`  Finished products analyzed : ${analyzed.length}`);
    console.log(`  Over drift threshold       : ${drifters.length}`);
    console.log(`  Stale / never synced       : ${stalers.length}`);
    console.log(`  Total flagged              : ${flagged.length}`);
    console.log('');

    if (flagged.length === 0) {
      console.log('  ✅ No items flagged. All finished products within tolerance and freshly synced.');
      console.log('');
    } else {
      const header =
        '  ' +
        pad('SKU', 18) +
        pad('AFS', 7, 'right') +
        pad('PIVOT', 8, 'right') +
        pad('DRIFT', 8, 'right') +
        pad('ONHAND', 8, 'right') +
        pad('SYNCED', 9, 'right') +
        '  FLAGS';
      console.log(header);
      console.log('  ' + '─'.repeat(header.length));

      for (const r of flagged) {
        const flags = [];
        if (r.overThreshold) flags.push('DRIFT');
        if (r.stale) flags.push('STALE');
        console.log(
          '  ' +
            pad(r.sku ?? '(no sku)', 18) +
            pad(r.afs, 7, 'right') +
            pad(r.pivot, 8, 'right') +
            pad(signed(r.drift), 8, 'right') +
            pad(r.extensiv_on_hand_snapshot ?? 0, 8, 'right') +
            pad(formatAge(r.ageHours), 9, 'right') +
            '  ' +
            flags.join('+')
        );
      }
      console.log('');
      console.log('  DRIFT = afs − pivot.  Positive: local thinks we have more sellable than Extensiv reports.');
      console.log('  Negative: local thinks we have less (e.g. orders booked locally not yet reflected upstream).');
      console.log('');
    }

    console.log('═══════════════════════════════════════════════════════════════════════');
    console.log('');

    if (CONFIG.failOnFlag && flagged.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error('❌ Drift report failed:', err.message);
  process.exit(1);
});
