# SBR Production Health Check - 2026-05-08

Run window: 2026-05-08 10:55-11:05 UTC  
Live URL: https://sbr-app-production-f1c4.up.railway.app  
Local repo: `/Users/gibson/Desktop/SBR-App`

## Verdict

Build gate passes and the deployed web bundle matches the local `origin/main` build. The public process health endpoint is up. I fixed a contained route-auth TypeScript/runtime compatibility issue found during the static check.

Runtime database verification is blocked from this machine tonight because the stored Railway OAuth/access token is invalid (`Not Authorized` / `invalid_grant`), and no Supabase MCP/psql credential is available in this Codex session. No production data was modified.

## Phase 1 - Static Checks

### Git refs

```text
origin/main: a9afdbc83f273b0706eec132732e637791e833bc
prod/main:   71f974c8c10e24e48109328735a1a0e8e7dfa4d0
local HEAD:  a9afdbc83f273b0706eec132732e637791e833bc
```

`git diff --stat origin/main prod/main` returned no output. The commits differ, but the trees are byte-identical before tonight's local fix.

### Dependencies

`node_modules` was missing, so I ran `npm install`.

Result: install succeeded. npm reported 24 audit findings (3 low, 10 moderate, 11 high). I did not run `npm audit fix` because that is dependency churn outside the 4-day stability surface.

### TypeScript

Command:

```bash
npm run check -- --pretty false
```

Result: failed with pre-existing broad type debt. Raw output was captured locally during the run in `docs/tscheck_2026-05-08-after-fix2.log`; I did not treat all 490 lines as fix-tonight work because most are unrelated to the recent scheduler/reorder/health changes.

Category A fixed tonight:

- `server/routes.ts` had two incompatible `requireRole` imports bound to the same identifier.
- Newer routes used array-style roles while `server/middleware/auth.ts` exposed variadic role arguments.
- `MemStorage` reorder-alert/vendor-communication constructors were missing defaults for newly required schema fields.

Category B/C left documented:

- Duplicate JSX attributes in `client/src/components/integration-settings.tsx`.
- Large pre-existing `client/src/pages/ai.tsx` response-shape drift.
- `server/routes.ts` legacy typing debt across Shopify/Amazon/GHL/returns areas.
- `server/storage.ts` MemStorage drift for older seed data and schema additions.
- Missing `./services/ai-agent-rules-service` type/module reference.

### Build

Command:

```bash
npm run build
```

Result: success.

Notable warnings:

- Duplicate `autoComplete` attributes in `client/src/components/integration-settings.tsx`.
- Large Vite chunk warning.
- Local drizzle step skipped because `DATABASE_URL` is not present locally.

Local bundle emitted:

```text
dist/public/assets/index-Bg55XeWq.js
dist/public/assets/index-CQr_vf_p.css
```

### Static code review notes

Reviewed:

- `server/services/system-health-service.ts`
- `server/services/scheduler-run-recorder.ts`
- `server/services/reorder-watcher.ts`
- `server/services/sendgrid-retry.ts`
- `server/services/extensiv-inventory-sync-service.ts`
- `server/scheduler-service.ts`
- `server/app.ts`
- `client/src/pages/health.tsx`
- `client/src/pages/reorder-alerts.tsx`
- `client/src/pages/production-priority.tsx`

Findings:

- Health monitor dedupes stale scheduler alerts per scheduler for 24h.
- Crash recording logs `SCHEDULER_CRASH`, increments `scheduler_consecutive_failures:*`, and alerts after 3 failures.
- Reorder watcher is paused by default and rate-limited by app settings.
- Roger and reorder email paths use the shared SendGrid retry helper.
- `/health` UI has banner, recent runs, last alert, and Test Alert button.
- Legacy in-process Extensiv scheduler still exists in `server/scheduler-service.ts`, but the health page uses `items.extensiv_last_sync_at` as source of truth and the production cron service is still the intended refresh path.
- `sendgrid-retry.ts` says "Three attempts at 1s / 5s / 15s"; the implementation performs 3 total attempts, so only the first two delays are slept. I left this unchanged because the wording is ambiguous and changing retry count can duplicate sends.

## Phase 2 - Runtime Verification

### Public process health

Command:

```bash
curl -sS -o /tmp/sbr_health.json -w '%{http_code} %{time_total}\n' https://sbr-app-production-f1c4.up.railway.app/api/health
```

Output:

```text
200 0.116241
{"status":"ok","timestamp":"2026-05-08T10:59:07.040Z"}
```

### Served bundle hash

Production HTML references:

```text
/assets/index-Bg55XeWq.js
/assets/index-CQr_vf_p.css
```

Local build emitted the same asset names. This strongly indicates the deployed app is serving the same tree as local `origin/main` before tonight's fix.

### Production DB diagnostics

Requested read-only SQL:

- Scheduler liveness from `integration_health`.
- Recent scheduler `audit_logs`.
- Recent `system_logs` warnings/errors.
- `reorder_alerts` status counts.
- `app_settings` pause/rate/ops settings.
- Extensiv freshness from `items.extensiv_last_sync_at`.
- `v_money_maker_health`.

Status: blocked. Railway CLI token refresh failed with `invalid_grant`; direct Railway GraphQL with the stored access token returned `Not Authorized`; no Supabase MCP or database credential is available in this session.

No SQL was run and no production rows were changed.

## Phase 3 - Triage

### A - Fixed Tonight

1. Unified route role middleware compatibility.
2. Removed duplicate `requireRole` import from `server/routes.ts`.
3. Added missing MemStorage defaults for reorder alerts and vendor communications.

### B - Document For Owner

1. Production DB runtime health could not be verified from this machine because Railway auth is stale.
2. `npm run check` remains red from older type debt outside the scheduler/reorder health surface.
3. Legacy in-process Extensiv scheduler should be reviewed against the Railway cron architecture.

### C - Ignore For 4-Day Window

1. Vite chunk-size warning.
2. Browserslist staleness warning.
3. npm audit findings, unless owner wants a dependency-hardening pass.

## Phase 4 - Deliverables

Created:

- `docs/HEALTH_CHECK_2026-05-08.md`
- `docs/OWNER_RETURN_TODO_2026-05-08.md`
- `docs/SBR_RUNTIME_STATE_2026-05-08.md`
- `docs/CHANGES_2026-05-08.md`

