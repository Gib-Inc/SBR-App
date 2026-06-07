/**
 * CIPH.R Finances — accountant document data (piece 4/4).
 *
 * Transcribed verbatim from two real documents Matt provided (June 2026):
 *  - EXECUTIVE_SUMMARY ← "Executive Financial Summary · Jan 2022 – May 2026"
 *    by Roger C Knudson (Inspired Tool Design LLC), accrual basis, through
 *    May 31 2026. The accountant's high-level narrative + ratios.
 *  - SHOPIFY_PERIOD ← "Shopify · Total Sales Breakdown · Jun 1-6, 2026" (USD).
 *
 * ANTI-HALLUCINATION: every number here is copied from the source document.
 * Nothing is computed, estimated, or projected in this file. Each object
 * carries its own source + period so the UI can cite it. These are distinct
 * narrative artifacts — they do NOT overwrite the live balance sheet (which is
 * a separate "as of Jun 6" QuickBooks cut with slightly different figures).
 */

export const EXECUTIVE_SUMMARY = {
  source: "Executive Financial Summary — Inspired Tool Design LLC",
  preparedBy: "Roger C Knudson, Accounting",
  presentedTo: "Stacy Stubbs, Manager",
  basis: "Accrual",
  asOf: "2026-05-31",
  datePrepared: "2026-06-01",
  periodLabel: "Jan 2022 – May 2026 (inception-to-date)",
  critical:
    "The company is technically insolvent — assets ($390,119) are exceeded by liabilities ($1,279,431), leaving owner's equity at ($889,312). At current 2026 pace, the full-year loss will exceed $539,000.",
  headline: {
    cashOnHand: 86652,
    ytdNetLoss: -224457, // 5 months
    ytdNetLossPctOfRevenue: -18.2,
    totalDebt: 1279431,
    totalDebtChangePctSinceDec2025: 33,
    ownersEquity: -889312,
    totalAssets: 390119,
    fullYearLossProjection: -539000,
    debtBreakdown: { shortTermLoans: 746000, creditCards: 197000, sba: 267000 },
  },
  ratios: [
    { metric: "Owner's equity", value: "($889K)", status: "Insolvent", tone: "crit" },
    { metric: "Current ratio", value: "0.28", status: "Critical", tone: "crit" },
    { metric: "Debt-to-assets", value: "3.28×", status: "Critical", tone: "crit" },
    { metric: "Net margin (2026 YTD)", value: "-18.2%", status: "Critical", tone: "crit" },
    { metric: "Ad spend % of revenue", value: "39.6%", status: "Unsustainable", tone: "crit" },
    { metric: "Gross margin (2026 YTD)", value: "50.1%", status: "Declining", tone: "warn" },
    { metric: "Payroll % of revenue", value: "21.8%", status: "Rising", tone: "warn" },
    { metric: "Cash position", value: "$86,652", status: "Adequate", tone: "ok" },
  ],
  adRoiByYear: [
    { year: "2022", value: 20.05 },
    { year: "2023", value: 15.45 },
    { year: "2024", value: 4.55 },
    { year: "2025", value: 3.44 },
    { year: "2026 YTD", value: 2.52 },
  ],
  findings: [
    { n: 1, title: "Insolvent", headline: "Equity: ($889,312)", tone: "crit",
      detail: "Assets ($390K) minus liabilities ($1.28M) = negative equity. Negative since 2023, worsening every year." },
    { n: 2, title: "Losses accelerating", headline: "Worst year on record", tone: "crit",
      detail: "5-month loss of $224K puts 2026 on pace for $539K+ annual loss — worst in company history." },
    { n: 3, title: "Ad ROI collapsing", headline: "$20 → $2.52 per $1 spent", tone: "crit",
      detail: "ROI fell 87% since 2022. Spending 40¢ of every revenue dollar on ads — the #1 loss driver." },
    { n: 4, title: "Debt spiral", headline: "10× growth in 3 years", tone: "crit",
      detail: "Total debt grew from $131K (2022) to $1.28M: $746K ST loans, $197K CC, $267K SBA." },
    { n: 5, title: "Can't pay bills", headline: "Current ratio: 0.28", tone: "crit",
      detail: "Only 28¢ for every $1 due within the year. Serious risk of default on vendors and loans." },
    { n: 6, title: "Revenue stalling", headline: "Growth reversed in 2026", tone: "warn",
      detail: "2026 annualizes to ~$2.9M — below 2025's $3.1M. More ad spend producing less revenue." },
    { n: 7, title: "Expenses > gross profit", headline: "Structurally unprofitable", tone: "crit",
      detail: "2026 YTD costs ($842K) exceed gross profit ($616K) by $226K. Cannot break even at current spend." },
    { n: 8, title: "Payroll rising", headline: "$235K → $593K in 3 years", tone: "warn",
      detail: "Combined payroll & labor (incl. all draws) more than doubled; on pace for $645K in 2026." },
    { n: 9, title: "Assets overstated", headline: "No depreciation since Dec 2023", tone: "warn",
      detail: "Soulence LLC posted zero depreciation in 2024–2026. Fixed assets overstated ~$30,410." },
    { n: 10, title: "Payroll mix has shifted", headline: "W-2 wages replaced by draws & contract", tone: "warn",
      detail: "W-2 wages grew only $28K over 4 years despite 4× revenue growth. Owner draws $15K→$178K and contract labor $10K→$176K; in 2026 contract labor already exceeds W-2 wages." },
  ],
} as const;

export const SHOPIFY_PERIOD = {
  source: "Shopify — Total Sales Breakdown",
  periodStart: "2026-06-01",
  periodEnd: "2026-06-06",
  periodLabel: "Jun 1-6, 2026",
  currency: "USD",
  refreshedAt: "2:35 PM",
  totals: {
    grossSales: 39078.31,
    discounts: -3718.38,
    returns: -347.97,
    netSales: 35011.96,
    shippingCharges: 629.22,
    returnFees: 0,
    taxes: 2243.09,
    totalSales: 37884.27,
  },
  daily: [
    { date: "2026-06-01", grossSales: 3849.35, discounts: -94.59, returns: 0, netSales: 3754.76, shippingCharges: 1.0, taxes: 219.03, totalSales: 3974.79 },
    { date: "2026-06-02", grossSales: 11295.36, discounts: -488.69, returns: -347.97, netSales: 10458.7, shippingCharges: 299.97, taxes: 588.23, totalSales: 11346.9 },
    { date: "2026-06-03", grossSales: 4817.41, discounts: -1274.46, returns: 0, netSales: 3542.95, shippingCharges: 0, taxes: 264.24, totalSales: 3807.19 },
    { date: "2026-06-04", grossSales: 6856.14, discounts: -870.15, returns: 0, netSales: 5985.99, shippingCharges: 99.99, taxes: 393.91, totalSales: 6479.89 },
    { date: "2026-06-05", grossSales: 10862.3, discounts: -820.9, returns: 0, netSales: 10041.4, shippingCharges: 199.98, taxes: 694.12, totalSales: 10935.5 },
    { date: "2026-06-06", grossSales: 1397.75, discounts: -169.59, returns: 0, netSales: 1228.16, shippingCharges: 28.28, taxes: 83.56, totalSales: 1340.0 },
  ],
} as const;
