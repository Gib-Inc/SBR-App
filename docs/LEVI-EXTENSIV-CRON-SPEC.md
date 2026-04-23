# Extensiv Hourly Sync — Railway Cron Service Handoff

**Owner:** Levi
**Why:** `pivot_qty` has been zero on every Extensiv-mapped item for 15+ days because nothing has been calling the sync. We're adding a Railway cron service that hits a new server endpoint hourly.

---

## Dependency: server-side endpoint must ship first

This cron is useless until the new endpoint exists. Do not deploy the cron service until all three of these are true:

1. `POST /api/integrations/extensiv/sync-cron` is live in the SBR app
2. `CRON_SECRET` env var is set on the SBR app service in Railway (use `openssl rand -hex 32`)
3. A manual `curl` to the endpoint with the right header returns `{ ok: true, ... }`:
   ```bash
   curl -X POST https://<sbr-app-url>/api/integrations/extensiv/sync-cron \
     -H "Content-Type: application/json" \
     -H "X-Cron-Secret: <the value>" \
     -d '{}'
   ```

If any of those three are missing, build them first. The rest of this doc assumes they're done.

---

## What to add

### 1. Cron script — `scripts/extensiv-cron.js`

Create this file in the SBR app repo. Plain Node, no dependencies (uses built-in `fetch` from Node 18+).

```javascript
#!/usr/bin/env node
// scripts/extensiv-cron.js
// Calls the SBR app's /api/integrations/extensiv/sync-cron endpoint.
// Runs hourly via Railway cron. Exits 0 on success, 1 on failure
// so Railway's deployment view shows red on broken runs.

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
```

Notes on the script:
- No external dependencies. Node 18+ has `fetch` built in. The Nixpacks builder Railway uses ships Node 20.
- Logs the full endpoint response body verbatim so you can see partial-failure detail in Railway's deployment logs.
- Exits 1 only on hard failure (network error, non-2xx, `ok: false`). Per-SKU errors inside the response do NOT trigger exit 1 — they get warned and we let the next hour clean them up.
- The script is single-shot. Railway invokes it once per cron tick.

### 2. Railway service config — `railway.json`

The current `railway.json` configures the web service. Cron services in Railway are separate services in the same project, each with their own config. Two ways to do this:

**Option A — separate config file (cleanest):** Create `railway.cron.json` at the repo root. Then in the Railway dashboard, when you add the new cron service from the same repo, point it at `railway.cron.json` via the service's settings → Config-as-Code field.

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS",
    "buildCommand": "npm ci"
  },
  "deploy": {
    "startCommand": "node scripts/extensiv-cron.js",
    "restartPolicyType": "NEVER",
    "cronSchedule": "5 * * * *"
  }
}
```

**Option B — dashboard-only (no extra file):** Add the cron service in the Railway dashboard and set its Build Command, Start Command, and Cron Schedule directly in the service settings. No `railway.cron.json` needed. Picks up the same Git repo, separate service, separate env scope.

Either works. Option A keeps the cron config in version control; Option B keeps the repo cleaner. Recommend Option A so the cron schedule is reviewable in PRs.

Cron expression: `5 * * * *` = every hour at minute 5. Off-the-hour to avoid clashing with Shopify reconciliation and any other top-of-hour jobs.

`restartPolicyType: "NEVER"` is critical — Railway runs the start command exactly once per cron tick. If it exits non-zero, Railway logs the failure and waits for the next tick. No restart loop.

### 3. Env vars on the cron service

Set these in the Railway dashboard on the **cron service** (not the web service — they have separate env scopes):

| Var | Value | Notes |
|---|---|---|
| `APP_BASE_URL` | The SBR app's Railway public URL (e.g. `https://sbr-app-production.up.railway.app`) | No trailing slash needed (script strips it) |
| `CRON_SECRET` | Same value as the web service's `CRON_SECRET` | MUST match exactly. If you rotate it, rotate both |

Both vars must exist on the cron service. If the web service has them but the cron doesn't, the script will exit 1 with `Missing required env vars`.

---

## Verification (after first deploy)

1. **First scheduled run.** Check the Railway "Deployments" tab on the cron service. The first run will appear within ~60 minutes of deploy. Click into it to read stdout.
2. **Look for the success line:** `[ExtensivCron] OK — compared 20, applied N`
3. **Cross-check in Supabase:**
   ```sql
   SELECT MAX(extensiv_last_sync_at) FROM items;
   ```
   Should be within the last 90 minutes.
4. **Cross-check pivot_qty is moving:**
   ```sql
   SELECT COUNT(*) FILTER (WHERE pivot_qty > 0) FROM items
   WHERE extensiv_sku IS NOT NULL;
   ```
   Should be > 0 (was 0 for 15+ days).

---

## Failure modes & response

| Symptom | Likely cause | Fix |
|---|---|---|
| Cron service shows red "Failed" deployments | Endpoint 500ing, network timeout, or 401 from secret mismatch | Read the script's stdout — endpoint's response body is logged verbatim |
| stdout shows `Missing required env vars` | Env vars not set on cron service | Add `APP_BASE_URL` and `CRON_SECRET` in cron service settings |
| stdout shows `HTTP 401` | `CRON_SECRET` on cron service ≠ `CRON_SECRET` on web service | Re-copy from web service to cron service |
| Runs successfully but `extensiv_last_sync_at` doesn't move | Endpoint returning `ok:true` without writing — server-side bug | Check SBR app's stdout in Railway; not a cron-side issue |
| `body.errors.length > 0` warnings | Per-SKU failures from Extensiv API (rate limit, missing item) | Inspect the errors array; usually self-heals next hour |
| Cron runs but no new deployments appear in Railway | `cronSchedule` not parsed correctly OR Railway cron feature not available on the project's plan | Check Railway plan; verify `railway.json` schema; check service's Settings → Cron tab |

---

## Rollback

Disable the cron service in the Railway dashboard (don't delete it). The endpoint stays callable manually. Re-enable resumes — endpoint is idempotent so no risk from the gap.

If the endpoint itself misbehaves, leave the cron disabled and trigger sync via the existing admin button until fixed. The button hits the per-user session-auth endpoint (`/api/integrations/extensiv/sync`), not the new cron endpoint, so the two paths are independent.

---

## Out of scope for this handoff

- The server-side endpoint itself (`POST /api/integrations/extensiv/sync-cron`). That's a separate work order — see backlog B-009 in the planning repo.
- Alerting on repeated failures. Railway's deployment view shows red, which is enough for v1. Slack alerts can come later.
- Running multiple Extensiv warehouses. The current script and endpoint sync the single auto-detected warehouse.
- Replacing the existing in-house admin button or the standalone `extensiv-sync.js` CLI. Both stay; this just adds a third path that's the only one running on a schedule.
