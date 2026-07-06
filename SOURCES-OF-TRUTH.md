# SOURCES OF TRUTH — read this before touching a finance number

Every decision-critical number has ONE canonical module. New surfaces consume the
canonical module — they do not re-derive from raw tables. This registry exists because
re-derivation debt is how the app ended up with two blended-ROAS numbers for the same
window, a 149-day HEALTHY runway during a debt spiral, and a Governor judging scale
against half the real marketing cost. `server/services/source-of-truth-lint.test.ts`
enforces it: reading a guarded raw pattern from a NON-allowlisted file fails the suite.

| Number | Canonical module | Never do this instead |
|---|---|---|
| **Ad spend (any channel, any window)** | `canonical-spend-service.ts` (monthly) / `corrected-ad-spend.ts` (range/window, correction factors) | `SUM(spend)` over `ad_metrics_daily` — it stores the SAME spend at 3 overlapping grains (~2-3.65x overcount) and Meta's rows are DEAD (canonical Meta = compliant tracker snapshots) |
| **Blended MER denominator** | `merDenominator()` in `canonical-spend-service.ts` (booked ILIKE advertising + credit-line Meta + `MARKETING_LABOR_VENDORS`) | `account_name ILIKE '%advertising%'` alone — misses credit-line Meta + off-account marketing labor (~$28K/mo combined) |
| **Contribution margin** | `contribution-margin-service.ts` (`getBlendedContributionMargin`; measured ~57.5%) | `revenue × 0.6` or any hardcoded margin; COGS fallback is `COGS_PLUG_RATE` (35%, QB-validated) never 40% |
| **Runway margin rate** | `runwayMarginRate` from the contribution engine ((rev − COGS − Amazon referral)/rev) | gross margin, net margin, or the fee-inclusive contribution rate (Shopify fees already live in QB overhead — fee PLACEMENT differs by channel) |
| **Revenue (closed months)** | `historical_monthly_sales` (QB-recognized) | summing `sales_orders` for pre-April-2026 months (the historical backfill reads ~1.9x QB) |
| **Revenue (windows)** | `storage.getSalesOrdersByDateRange` (orderDate-windowed) / `daily_sales_snapshots.net_revenue` | windowing on `createdAt` (backfills leak into current windows); filtering `is_historical` (it's a LIFECYCLE flag — completed orders move to History — NOT a backfill marker) |
| **Cash on hand** | `getBankConfirmedOverride()` in `cash-flow-service.ts` (bank-confirmed, staleness-flagged) | `qb_financial_snapshots.cash_on_hand` directly (the QB ledger lags the bank by days) |
| **Debt service** | `computeCreditLines().totals.monthlyDebtService` / `dailyAchOut` (cadence-normalized operator terms) | assuming $0 when terms are missing (use `missingPayment*` / `debtServiceBlind` flags); cash_obligations debt rows are SEEDED from these terms |
| **Cost of capital** | `credit_lines.rate_type` + `apr`/`factor_rate` | trusting `apr` alone — it's a scraped LIE on factor/revenue-share facilities (`isRateUnreliable`) |
| **DSCR** | `dscr-service.ts` (3-closed-month avg income, both interest accounts, principal-unknown cap) | latest QB snapshot net income (MTD artifact) or single-account interest |
| **Per-order COGS** | `sales_order_lines.product_id` → `items` WAC (95.8% coverage; `order-line-resolution-service` self-heals nightly) | per-SKU string re-matching or the 60%-margin guess |
| **LTV / CAC** | `queryLtvCac` (identified-email cohorts, contribution basis) | gross `total_amount` LTV or COALESCE identity keys that mint a customer per anonymous order |
| **Scale/pause decisions** | Governor (`computeGovernor`, blended-MER gate) + directive engine (measured margin) | per-channel last-click pixel ROAS — it credits harvest channels for demand Meta creates (a real Meta cut collapsed total sales ~$10K→$2K/day) |

## Known data facts (do not "fix" these blindly)

- **`is_historical` is a lifecycle flag.** Filtering it from revenue drops most completed
  orders (June: $27K live-only vs $240K real). Backfill discrimination needs orderDate
  windowing or the QB spine — never this flag.
- **2,161 `sales_orders` rows (~$887K) have NO identity** (null external_order_id AND null
  order_name — the pre-April Amazon backfill). A uniqueness guard is impossible without
  fabricating identities. The backstop is the `monthly_revenue` drift check in
  `financial-reconciliation-service` — a re-backfill that doubles a month self-reports.
- **Feed continuity is guarded** (`google_spend_feed` / `meta_spend_feed` checks): a dead
  sync or re-emerged grain-fanout trips reconciliation drift, not silence.

## Amending this registry

Add the new file to the allowlist in `source-of-truth-lint.test.ts` ONLY if it is a new
canonical module, an ingestion writer, or a deliberately-reviewed consumer that cannot use
the canonical path. Say why in a comment. "It was easier" is not a reason — that's how the
drift got here.
