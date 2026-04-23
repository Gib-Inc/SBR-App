#!/usr/bin/env node
// scripts/extensiv-cron.js
// Calls the SBR app's /api/integrations/extensiv/sync-cron endpoint.
// Runs hourly via Railway cron. Exits 0 on success, 1 on failure
// so Railway's deployment view shows red on broken runs.
//
// Env vars required (set on the Railway cron service):
//   APP_BASE_URL   Public URL of the SBR app (no trailing slash required)
//   CRON_SECRET    Same value as the SBR app's CRON_SECRET env var
//
// See docs/LEVI-EXTENSIV-CRON-SPEC.md for Railway service setup.

const APP_BASE_URL = process.env.APP_BASE_URL;
const CRON_SECRET = process.env.CRON_SECRET;

if (!APP_BASE_URL || !CRON_SECRET) {
  console.error('[ExtensivCron] Missing required env vars: APP_BASE_URL and/or CRON_SECRET');
  process.exit(1);
}

const url = `${APP_BASE_URL.replace(/\/$/, '')}/api/integrations/extensiv/sync-cron`;
const startedAt = new Date().toISOString();
console.log(`[ExtensivCron] ${startedAt} POST ${url}`);

(async () => {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Cron-Secret': CRON_SECRET,
      },
      body: '{}',
    });

    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { raw: text }; }

    console.log(`[ExtensivCron] HTTP ${res.status}`, JSON.stringify(body));

    if (!res.ok || body.ok !== true) {
      console.error('[ExtensivCron] FAILED');
      process.exit(1);
    }

    if (body.errors && body.errors.length > 0) {
      console.warn(`[ExtensivCron] PARTIAL — ${body.errors.length} item-level errors:`, body.errors.slice(0, 5));
      // Partial success still exits 0; we want Railway to retry next hour, not now
    }

    console.log(`[ExtensivCron] OK — compared ${body.comparedCount}, applied ${body.adjustmentsApplied}`);
    process.exit(0);
  } catch (err) {
    console.error('[ExtensivCron] Network/fetch error:', err.message);
    process.exit(1);
  }
})();
