# SBR FinOps Engine — Launch Readiness Report

**Date:** 2026-06-09 · **Test floor:** 264/264 green (baseline 252 at phase start, 191 at engine start) · **Branch:** main

The FinOps engine's four pillars are built, wired to production, and monitored.
This report covers the integration audit findings (with fixes), the final
schema changes, and the live status of the 26 drifting SKUs.

---

## 1. Fixed API & Data-Pipeline Gaps

### Ad-spend integration audit (verified against Windsor's raw API)

| Platform | Finding | Status |
|---|---|---|
| **Google Ads** | **No leak.** Windsor raw daily data sums to **$10,012 / last 30d**; the app ingested $9,613 for its window (date-offset only). Google genuinely spends ~$10K/mo today (~$400/day, ramping from ~$120/day in mid-May). The "$80–100K/mo" expectation is a stale planning figure, not a pipeline failure. | ✅ Verified correct |
| **Amazon Ads** | **Real leak found & fixed.** Amazon spend lives in 4 separate Windsor report tables. The sync pulled 3 and missed `sponsored_brands_campaign_video` — **$955 / 30d ≈ 24% of Amazon spend**. True Amazon ≈ $4,009/30d vs $3,154 ingested. | ✅ Fixed (4th table added) |
| **Meta** | **Not connected in Windsor at all.** Meta spend (~$37K of the ~$50K/30d total) only enters via manual CSV uploads. Action for Matt: connect Meta Ads in the Windsor dashboard (OAuth) and it auto-flows — no code change needed. | ⚠ Flagged (needs Windsor OAuth) |
| **Pinterest** | Connected in Windsor ($0 spend last 30d) but the sync ignored it. Added — spend auto-flows the day campaigns start. | ✅ Fixed |
| **Resolved premise** | "~$12K vs ~$100K reality": the unified aggregator already reads **$49.8K/30d** (windsor Google $9.6K + Amazon $3.2K→$4.0K + uploaded Meta). At $476K/30d revenue → **9.55x blended ROAS**, inside SBR's historical 8–10x band. The plausibility ceiling (>20x = data gap) guards against true under-reporting. | ✅ Closed |

### Earlier pipeline fixes in this phase (already deployed)
- `getUnifiedPerformance` epoch-window bug (defaulted to 1970; callers now pass the real clock).
- Overlapping rolling-window snapshots double-count (Morning Trap read $18.8K instead of $9.6K).
- Stale same-day trap-run row displayed on the Marketing page (tie-break on `created_at`).

### Pipeline map (current, all monitored on /health)
| Stream | Source → Store | Cadence |
|---|---|---|
| Ad spend | Windsor (google_ads, amazon_ads ×4 tables, pinterest) → `marketing_spend_snapshots` via reconciliation | Daily + startup |
| Shopify orders | Webhooks (live) + Tue/Thu reconciliation + nightly sales rollup → `sales_orders`, `daily_sales_snapshots` | Live / 11:59 PM MT |
| Extensiv 3PL | Sync service + cron → `items.pivot_qty`, snapshots | Hourly fallback |
| QuickBooks | Live OAuth → `qb_financial_snapshots` (cash, OpEx, margins) | Live + token refresh 45m |
| GHL | Sales/stock-risk/PO sync triggers | Event-driven |

## 2. Final Database Schema Updates

| Object | Purpose |
|---|---|
| `items.wac_unit_cost` (real) | Weighted-average cost per unit — maintained inside `InventoryMovement` |
| `forecast_predictions` (table) | One row per predicted day: predicted, raw_predicted, correction_factor_used, actual, actualized_at |
| `supplier_intel_snapshot` (table) | Daily 6 AM stockout/PO-needs snapshot |
| `marketing_recommendations` (rows) | Persisted daily blended directives (`finops-marketing-analytics-v1`) |
| `data_reconciliation_log` (rows) | Now also carries: `inventory_drift` (per-SKU resolver decisions), `inventory_valuation` (manual-count $ variances), `system_integrity` (sweep anomalies) |

All schema changes ship as **additive startup migrations** (`server/startup-migrations.ts`) — applied automatically on deploy, idempotent.

## 3. Pillar Wiring (this phase)

- **P2 — WAC & build orders:** costing lives inside the single sanctioned
  `InventoryMovement.apply()` gateway, so every existing call site participates
  with zero route changes. PO receipts blend component WAC from the PO line
  cost (atomic with the stock change — same single-row update); production
  completion computes per-unit build cost from the BOM (incl. wastage) and
  rolls it into the finished good's WAC; manual counts log the $ variance
  (SHRINKAGE/OVERAGE) to the ledger. `GET /api/finances/inventory-valuation`
  reports total asset value at WAC and lists stocked-but-uncosted items.
  A costing failure can never block a stock movement (isolated try/catch).
- **P4 — forecast self-tuning:** nightly at 12:15 AM MT the loop actualizes
  yesterday's prediction from `daily_sales_snapshots`, grades MAPE + bias over
  the trailing 30 pairs, stores the dampened/clamped correction factor, applies
  it to the runway's revenue inputs (`biasCorrectionFactor` in the response),
  and writes tomorrow's tuned prediction. Endpoints:
  `GET/POST /api/finances/forecast-accuracy[/run]`.
- **P3 — reporting layer:** guardrails (8x/5x/3x + September Rule) are surfaced
  on the ROAS Guardian tab via the new **Today's Directive** panel, with
  per-campaign Spend/Revenue/ROAS/CAC/Contribution-Margin and a call per
  campaign. When data quality blocks a confident Scale/Kill, the panel lists
  the EXACT missing fields (e.g. unit costs, unbooked P&L marketing days).
  `GET /api/marketing/campaign-performance`.
- **P1 — drift resolution:** see §4.

## 4. The 26 Drifting SKUs — Automated Resolution

Root cause: `availableForSaleQty` (afs) is decremented at **order create**;
Extensiv decrements `pivotQty` at **ship**. So afs ≈ pivot − openUnshipped at
all times, and raw afs-vs-pivot comparison over-flags.

The resolver (`POST /api/system-integrity/resolve-inventory`):
1. **RESYNCED** — stale items get a forced per-item Extensiv re-sync; a failed
   sync is logged with its exact point of failure (`SYNC_FAILED`).
2. **EXPLAINED** — drift fully covered by open unshipped orders (no write).
3. **CORRECTED** — residual ≤ 25 units: afs reset to (pivot − open) through
   `InventoryMovement MANUAL_COUNT` (audit-logged, atomic).
4. **PROPOSED** — larger residuals are flagged for human review, never silently
   applied.

**Active status log:** every decision lands in `data_reconciliation_log`
(`data_type = 'inventory_drift'`, one row per SKU per run) — queryable in-app
and the source for this section's live numbers. The integrity sweep (every 6h)
re-detects anything that drifts again.

## 5. Residual Risks / Operator Actions
1. **Meta in Windsor** — connect via Windsor dashboard OAuth (Matt). Until then Meta arrives via manual uploads only.
2. **WAC cold start** — costs populate as receipts/builds flow; until then valuation falls back to `default_purchase_cost`, and `inventory-valuation` lists uncosted stocked items explicitly.
3. **Forecast model maturity** — grading starts after the first nightly cycle; the correction factor is clamped ±30% and dampened 50% so early noise cannot whipsaw projections.
4. **Amazon API history** — Windsor's Amazon connector serves ~60d back; deep backfill unavailable.
