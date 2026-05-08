# Owner Return TODO - 2026-05-08

## High Risk

### Re-run production DB health diagnostics with valid Railway/Supabase auth

What's broken: I could not query production Supabase from this machine. Railway CLI token refresh fails with `invalid_grant`, and direct Railway GraphQL returns `Not Authorized`.

Why I did not fix it tonight: Re-authenticating Railway requires owner/browser intervention. I did not have a Supabase MCP or a database URL in this session.

Suggested approach:

1. Run `railway login`.
2. Link `upbeat-blessing` / `production` / `SBR-App`.
3. Run the read-only SQL in `docs/HEALTH_CHECK_2026-05-08.md`.
4. Confirm each scheduler's `last_success_at` is inside its expected interval and every `scheduler_consecutive_failures:*` app setting is `0`.

Risk if left for 4 days: The app process is up and bundle is current, but silent scheduler drift cannot be ruled out from this session.

Estimated effort: 20-30 minutes once authenticated.

## Medium Risk

### TypeScript check is still red from broad existing debt

What's broken: `npm run check -- --pretty false` still fails after the contained route/reorder fixes. Remaining errors are spread across integration settings, AI page response types, legacy route handlers, storage schema drift, and a missing `ai-agent-rules-service` reference.

Why I did not fix it tonight: This is not one contained scheduler bug; it is a repo-wide type cleanup. Touching it quickly would create more risk than benefit for the 4-day unattended window.

Suggested approach: Make a dedicated TypeScript stabilization branch. Start with the build-visible warnings (`integration-settings.tsx` duplicate attributes), then split server route/storage type cleanup by feature area.

Risk if left for 4 days: Railway build still succeeds, but `npm run check` cannot currently serve as a deploy gate.

Estimated effort: 1-2 days.

## Medium Risk

### Legacy in-process Extensiv scheduler still exists

What's broken: `server/scheduler-service.ts` still schedules an in-process Extensiv sync every 4 hours in addition to the intended Railway cron path. It is guarded by production env and uses older user/settings credential flow.

Why I did not fix it tonight: Removing or changing it could alter live inventory behavior without DB/log confirmation.

Suggested approach: After confirming Railway cron and `items.extensiv_last_sync_at` are fresh, decide whether the in-process scheduler should be deleted, disabled, or made health-recorded.

Risk if left for 4 days: Possible duplicate or confusing Extensiv sync attempts, though health source of truth remains item timestamps.

Estimated effort: 1-2 hours after DB/log review.

## Low Risk

### SendGrid retry helper wording mismatch

What's broken: Comment says "Three attempts at 1s / 5s / 15s"; implementation performs three total attempts, which means two waits are used.

Why I did not fix it tonight: Changing to four total attempts may duplicate downstream email behavior. Current code still retries transient failures.

Suggested approach: Decide desired semantic: "3 total attempts" or "initial try plus 3 retries"; then update code/comment together.

Risk if left for 4 days: Low. Transient SendGrid failures still get multiple attempts.

Estimated effort: 15 minutes.

