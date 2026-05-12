# SBR Scheduler Runbook

## One-Look Health

Open `/health` in the SBR app. The page reads `/api/system-health` and shows each scheduler's status, last run, last success, next run, expected cadence, and source of truth.

Status rules:

- `Healthy`: last success is inside the expected interval.
- `Late`: last success is older than the expected interval.
- `Stale`: last success is older than 2x the expected interval.
- `Unknown`: no persisted success has been recorded yet.

## Alerting

The SBR-App process runs the system health monitor hourly. It checks the same `/api/system-health` data and sends alerts for `Stale` schedulers when an alert channel is configured.

Supported environment variables:

- Slack: `SYSTEM_HEALTH_SLACK_WEBHOOK_URL` or `SLACK_WEBHOOK_URL`
- Email: `SYSTEM_HEALTH_ALERT_EMAIL` or `ALERT_ADMIN_EMAIL`
- Email provider: `SENDGRID_API_KEY` and `SENDGRID_FROM_EMAIL`

Alerts are throttled to once per hour through the `integration_health` row named `scheduler-alerts`.

## Schedulers

| Scheduler | Owner | Cadence | Source of truth | Writes |
| --- | --- | --- | --- | --- |
| Extensiv inventory sync | SBR-App process | Hourly on the UTC wall-clock boundary | `scheduler:extensiv-sync` health row plus `items.extensiv_last_sync_at` on Extensiv-mapped items | `items.pivot_qty`, `items.extensiv_on_hand_snapshot`, `items.extensiv_last_sync_at`, audit logs, `integration_health.scheduler:extensiv-sync` |
| QuickBooks token refresh | SBR-App process | Every 45 minutes | `scheduler:quickbooks-token-refresh` health row and audit logs | QuickBooks auth token fields, audit logs |
| Daily briefing | SBR-App process | Daily at 7:00 AM MT | `scheduler:daily-briefing` health row and audit logs | `daily_briefings`, audit logs |
| AI inventory batch | SBR-App process | Daily at 10:00 AM and 3:00 PM MT | `scheduler:ai-batch` health row and audit logs | AI recommendation records, audit logs |
| Credential rotation reminders | SBR-App process | Daily at 6:00 AM MT | `scheduler:credential-rotation` health row and audit logs | GHL reminder opportunities, audit logs |
| Shopify reconciliation | SBR-App process | Tuesday and Thursday at 9:00 AM MT | `scheduler:shopify-reconciliation` health row and audit logs | `sales_orders`, `sales_order_lines`, GHL sync, system logs |
| Daily sales aggregation | SBR-App process | Daily at 11:59 PM MT | `daily_sales_snapshots` and `scheduler:daily-sales` health row | `daily_sales_snapshots`, audit logs |

## Extensiv Canonical Flow

The in-process scheduler in `server/scheduler-service.ts` is the canonical Extensiv inventory sync path. It runs hourly on the UTC wall-clock boundary, reads Extensiv inventory through `ExtensivInventorySyncService`, updates mapped item snapshots, and is monitored through `scheduler:extensiv-sync`.

Each mapped item receives a read-only `extensiv_on_hand_snapshot` and `extensiv_last_sync_at`. Pivot quantity changes go through `InventoryMovement.apply({ eventType: "EXTENSIV_SYNC" })`, and scheduler health is recorded as `scheduler:extensiv-sync` with a `SCHEDULER_RUN_COMPLETED` or `SCHEDULER_RUN_FAILED` audit log.

Do not let Extensiv overwrite component `current_stock`. Finished goods use `pivot_qty + hildale_qty`; components use `current_stock`.

## Manual Checks

Database freshness:

```sql
SELECT MAX(extensiv_last_sync_at) AS last_sync,
       NOW() - MAX(extensiv_last_sync_at) AS age,
       COUNT(*) FILTER (WHERE extensiv_last_sync_at > NOW() - INTERVAL '5 minutes') AS just_synced
FROM items
WHERE extensiv_sku IS NOT NULL;
```

Extensiv should normally be under 1 hour old. At 2 hours it is stale and should alert through `scheduler:extensiv-sync`.

## Deployment Guardrail

`npm run check` currently has repo-wide type debt. Do not turn it into a hard Railway pre-deploy blocker until the existing errors are cleaned up. Once clean, set the Railway build command to run the type check before the production build.
