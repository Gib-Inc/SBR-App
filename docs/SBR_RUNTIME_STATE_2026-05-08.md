# SBR Runtime State - 2026-05-08

## Running Surface

- Production app: https://sbr-app-production-f1c4.up.railway.app
- Public health endpoint: `/api/health`
- Observability UI: `/health` via authenticated app route
- Reorder alert UI: `/reorder-alerts` via authenticated app route
- Database: shared Supabase project `txfhonbjxoetgvqqmoum`
- Origin repo: `git@github.com:Gib-Inc/SBR-App.git`
- Prod repo: `git@github.com:saasbooster-sys/SBR-App.git`

## Code State

```text
origin/main: a9afdbc83f273b0706eec132732e637791e833bc
prod/main:   71f974c8c10e24e48109328735a1a0e8e7dfa4d0
```

Before tonight's fix, origin/prod trees were byte-identical despite different SHAs.

Deployed bundle observed from production:

```text
/assets/index-Bg55XeWq.js
/assets/index-CQr_vf_p.css
```

Local build emitted the same files.

## Scheduler Inventory

Defined in `server/services/system-health-service.ts`:

| Scheduler | Cadence | Stale After | Source of Truth | Last Success |
|---|---:|---:|---|---|
| Extensiv inventory sync | Every 4h at :05 UTC | 8h | `items.extensiv_last_sync_at` | DB check blocked |
| QuickBooks token refresh | 45 min | 90 min | `integration_health` + `audit_logs` | DB check blocked |
| Daily briefing | Daily 7:00 AM MT | 48h | `integration_health` + `audit_logs` | DB check blocked |
| AI inventory batch | Daily 10:00 AM and 3:00 PM MT | 24h | `integration_health` + `audit_logs` | DB check blocked |
| Credential rotation reminders | Daily 6:00 AM MT | 48h | `integration_health` + `audit_logs` | DB check blocked |
| Shopify reconciliation | Tue/Thu 9:00 AM MT | 8 days | `integration_health` + `audit_logs` | DB check blocked |
| Daily sales aggregation | Daily 11:59 PM MT | 48h | `daily_sales_snapshots` + health row | DB check blocked |
| Auto reorder watcher | Hourly | 120 min | `integration_health` + `audit_logs` | DB check blocked |

## Pause Switches And Limits

Expected app settings:

- `reorder_alerts_auto_send_paused` - should remain `true`.
- `reorder_email_max_per_hour` - default 5.
- `reorder_email_max_per_supplier_per_day` - default 1.
- `ops_alert_last_fired_at`
- `ops_alert_last_fired:scheduler:*`
- `scheduler_consecutive_failures:*`

Production values could not be queried because Railway/Supabase auth is unavailable in this session.

## Environment Variables The Runtime Depends On

Names only; no values captured.

```text
ALERT_ADMIN_EMAIL
AMAZON_CLIENT_ID
AMAZON_CLIENT_SECRET
AMAZON_MARKETPLACE_ID
AMAZON_REFRESH_TOKEN
AMAZON_SELLER_ID
ANTHROPIC_API_KEY
APP_BASE_URL
AUTO_SCRAPE_SUPPLIER_PRICES_ENABLED
BACKORDER_AUTO_EMAIL
CRON_SECRET
DATABASE_URL
EXTENSIV_API_KEY
EXTENSIV_BASE_URL
EXTENSIV_CLIENT_ID
EXTENSIV_CLIENT_SECRET
EXTENSIV_CUSTOMER_ID
EXTENSIV_ORG_KEY
EXTENSIV_PUSH_ORDERS
EXTENSIV_TOKEN_URL
EXTENSIV_USER_LOGIN
EXTENSIV_WAREHOUSE_ID
EXTENSIV_WEBHOOK_SECRET
FORCE_EXTENSIV_SYNC
GHL_NEEDS_ATTENTION_PIPELINE_ID
GHL_NEEDS_ATTENTION_STAGE_ID
GHL_PURCHASE_PIPELINE_ID
GHL_PURCHASE_STAGE_DRAFT_ID
GHL_WEBHOOK_SECRET
GOOGLE_ADS_CLIENT_ID
GOOGLE_ADS_CLIENT_SECRET
GOOGLE_ADS_DEVELOPER_TOKEN
GOOGLE_ADS_REDIRECT_URI
HOST
META_APP_ID
META_APP_SECRET
META_REDIRECT_URI
N8N_WEBHOOK_URL
NODE_ENV
PHANTOMBUSTER_API_KEY
PORT
PRIMARY_ADMIN_EMAIL
QB_ENCRYPTION_KEY
QUICKBOOKS_CLIENT_ID
QUICKBOOKS_CLIENT_SECRET
QUICKBOOKS_REDIRECT_URI
QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN
RETURN_TO_ADDRESS
RETURN_TO_CITY
RETURN_TO_COUNTRY
RETURN_TO_NAME
RETURN_TO_PHONE
RETURN_TO_STATE
RETURN_TO_STREET1
RETURN_TO_STREET2
RETURN_TO_ZIP
SBR_OPS_ALERT_EMAIL
SENDGRID_API_KEY
SENDGRID_FROM_EMAIL
SENDGRID_FROM_NAME
SESSION_SECRET
SHIPPO_API_KEY
SHIPPO_DEFAULT_CARRIER
SHIPPO_DEFAULT_FROM_ADDRESS
SHIPPO_DEFAULT_FROM_ADDRESS_LINE1
SHIPPO_DEFAULT_FROM_ADDRESS_LINE2
SHIPPO_DEFAULT_FROM_CITY
SHIPPO_DEFAULT_FROM_COUNTRY
SHIPPO_DEFAULT_FROM_NAME
SHIPPO_DEFAULT_FROM_PHONE
SHIPPO_DEFAULT_FROM_STATE
SHIPPO_DEFAULT_FROM_ZIP
SHIPPO_DEFAULT_SERVICE
SHIPPO_WAREHOUSE_CITY
SHIPPO_WAREHOUSE_COUNTRY
SHIPPO_WAREHOUSE_NAME
SHIPPO_WAREHOUSE_PHONE
SHIPPO_WAREHOUSE_STATE
SHIPPO_WAREHOUSE_STREET1
SHIPPO_WAREHOUSE_STREET2
SHIPPO_WAREHOUSE_ZIP
SHOPIFY_ACCESS_TOKEN
SHOPIFY_ADMIN_API_KEY
SHOPIFY_API_SECRET
SHOPIFY_API_VERSION
SHOPIFY_CLIENT_ID
SHOPIFY_CLIENT_SECRET
SHOPIFY_HILDALE_LOCATION_ID
SHOPIFY_LOCATION_ID
SHOPIFY_PIVOT_LOCATION_ID
SHOPIFY_REDIRECT_URI
SHOPIFY_SHOP_DOMAIN
SHOPIFY_STORE_DOMAIN
SHOPIFY_WEBHOOK_URL
SINGLE_USER_MODE
SLACK_WEBHOOK_URL
SYSTEM_HEALTH_ALERT_EMAIL
SYSTEM_HEALTH_SLACK_WEBHOOK_URL
WAREHOUSE_CITY
WAREHOUSE_COUNTRY
WAREHOUSE_EMAIL
WAREHOUSE_NAME
WAREHOUSE_PHONE
WAREHOUSE_STATE
WAREHOUSE_STREET1
WAREHOUSE_STREET2
WAREHOUSE_ZIP
```

## Money Maker Critical Components

Could not query `v_money_maker_health` because production DB access is blocked. The owner should run:

```sql
SELECT * FROM v_money_maker_health;
```

Expected shape: 4 rows. Push 1.0 and Push 2.0 should still show ORDER NOW with binding components `Catch Basket Push 1.0` and `Sleeve Push 2.0`.

## 2 AM Debug Checklist

1. Open `/api/health`. If it is not 200, inspect Railway SBR-App deployment logs.
2. Open authenticated `/health`. If a scheduler is stale, check its `recentRuns` row and `lastAlertAt`.
3. Check `scheduler_consecutive_failures:*` app settings; any value over 0 means the scheduler recovered poorly or is currently struggling.
4. For Extensiv, check `MAX(items.extensiv_last_sync_at)`.
5. Keep `reorder_alerts_auto_send_paused=true` until Matt reviews pending alerts.

