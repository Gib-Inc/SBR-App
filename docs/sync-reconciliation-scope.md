# Scope: Sync Reconciliation (live integrations)

Extend the never-null-wipe / newer-wins discipline (already shipped for finance
uploads via `data_reconciliation_log` + `reconciliation-service.ts`) to the LIVE
syncs (Extensiv, Shopify, QuickBooks) so a partial / empty / stale / re-delivered
payload can't silently corrupt inventory or orders.

## Confirmed risks (ranked)

| # | Sev | Risk | Where | Scenario | Guard today |
|---|-----|------|-------|----------|-------------|
| 1 | 🔴 | **Extensiv cron zeroes stock** (verified) | `extensiv-sync.js` raw `UPDATE items SET pivot_qty=$1`, `available ?? 0`, imports InventoryMovement 0× | API timeout/partial → `pivot_qty=0` → false backorders | none |
| 2 | 🔴 | Shopify `orders/updated` stale overwrite | `server/shopify/webhook-handlers.ts` | re-delivered / out-of-order webhook overwrites status/total/deliveredAt with old values | weak (no ts compare) |
| 3 | 🔴 | Shopify inventory sync writes `availableForSaleQty` from a possibly-empty level | `shopify-inventory-sync-service.ts` / webhook | empty Shopify response → sellable qty corrupted | weak null check |
| 4 | 🟡 | Webhook replay duplicates | `salesOrderLines` / `refundRequests` have no unique constraint | re-delivered orders/create → dup line items → double decrement | none |
| 5 | 🟡 | cron ↔ webhook race | no row versioning | concurrent writes, last-writer-wins | none |

QuickBooks (PO→Bill) + GHL are low/none (idempotent / read-only).

## Design — a sync write-guard
- Reject **degenerate payloads** (large fraction of catalog → 0, or response count << last good run): skip + alert, don't write.
- **Never-null-wipe / newer-wins**: don't overwrite a real qty with null; skip if source ts older than stored.
- **Idempotent webhooks**: unique constraints + upsert so replays are no-ops.
- **Log every decision** to `data_reconciliation_log` (`dataType: "sync:extensiv"`, ...).

Reuse: `InventoryMovement.apply()` (route the cron through it), `data_reconciliation_log`,
`extensiv_last_sync_at` / `updatedAt` / `integrationConfigs.lastSyncAt`,
`stale-sync-alert-service.ts`, `shopify-reconciliation-scheduler.ts`, `audit-logger`.

## Phases
- **P1 — Extensiv guard (~0.5–1d):** degenerate-payload + null guard on cron AND service; route cron's pivot_qty write through InventoryMovement. Kills "all stock → 0".
- **P2 — Shopify integrity (~1d):** unique constraints on `salesOrderLines` + `refundRequests` (prod migration), upsert lines, newer-wins on order-update.
- **P3 — generalize (~1–2d):** shared guard across all sync writes; optional optimistic-concurrency `version` column; a "sync reconciliation" view.

## Open decisions
1. Degenerate-payload policy: skip-and-alert (recommended) vs apply-but-flag; threshold (e.g. skip if >30% of items → 0, or response count < 50% of last good run).
2. Cron fix depth: route `extensiv-sync.js` fully through the gateway (recommended) vs guard inline on the raw SQL.
3. One-time repair check: scan for items at 0 that recently had stock (detect if already bitten).

Recommendation: P1 first — small, self-contained, removes the only failure mode
that can silently zero sellable inventory.
