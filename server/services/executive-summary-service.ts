/**
 * CIPH.R Finances — LIVE Executive Summary.
 *
 * Replaces the hardcoded EXECUTIVE_SUMMARY constant (a frozen transcription of
 * Roger's June 2026 summary) with figures COMPUTED from the data the user's
 * uploads write to:
 *   - P&L (YTD net loss, margins, ad %, payroll %, ad-ROI-by-year, full-year
 *     projection) ← monthly_financials  (the /financial-upload/apply target)
 *   - Balance sheet (cash, debt, equity, current ratio, debt-to-assets) ← the
 *     latest uploaded balance-sheet snapshot (raw.balanceSheet), live cash
 *     overlaid from the QB capture, falling back to the accountant seed.
 *
 * Same source-selection the /api/finances/overview endpoint uses, so the summary
 * and the overview never contradict each other. The core (buildExecutiveSummary)
 * is PURE and unit-tested; the wrapper only gathers IO. Reports + flags — it never
 * writes to QuickBooks or posts entries. QuickBooks remains the book of record.
 */
import { EXECUTIVE_SUMMARY } from "../data/finance-docs";

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};
function parseMonth(m: string): { year: number; idx: number } | null {
  const mm = String(m || "").trim().match(/^([A-Za-z]{3})[A-Za-z]*\s+(\d{4})$/);
  if (!mm) return null;
  const idx = MONTHS[mm[1].toLowerCase()];
  if (idx == null) return null;
  return { year: Number(mm[2]), idx };
}
const n = (v: any): number => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const r0 = (x: number) => Math.round(x);
const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;
const pctOf = (part: number, whole: number): number | null => (whole !== 0 ? r1((part / whole) * 100) : null);
const pctStr = (p: number | null): string => (p == null ? "n/a" : `${p}%`);
const usd = (v: number) => (v < 0 ? "-" : "") + "$" + Math.abs(Math.round(v)).toLocaleString("en-US");

export interface ExecMonthlyRow {
  month: string;
  totalIncome?: any; grossProfit?: any; netIncome?: any; totalExpenses?: any;
  expenseCategories?: Record<string, any> | null;
}
export interface ExecBuildInput {
  monthly: ExecMonthlyRow[];
  balanceSheet: any;          // raw.balanceSheet (uploaded) or FINANCIAL_SEED.balanceSheet
  cashOnHand: number | null;  // freshest QB cash, overlaid onto BS cash
  bsAsOf?: string | null;
  computed?: boolean;         // false → caller signals it fell back to the seed BS
  asOf?: Date;                // "now" for the future-row guard (injectable for tests)
}

/**
 * Compute the executive summary from live P&L + balance-sheet data. Pure.
 * Returns the same shape the card consumes; if no P&L months exist, returns the
 * seed constant verbatim (nothing to compute from yet).
 */
export function buildExecutiveSummary(input: ExecBuildInput): any {
  const seed = EXECUTIVE_SUMMARY as any;
  const parsed = (input.monthly || [])
    .map((r) => ({ row: r, p: parseMonth(r.month) }))
    .filter((x): x is { row: ExecMonthlyRow; p: { year: number; idx: number } } => x.p != null);
  if (!parsed.length) return seed; // no uploads yet → keep the accountant baseline

  // Drop rows dated in the future relative to now — a stray 'Jan 2027' (sync drift
  // or a forecast row) must not hijack the YTD year. (asOf injectable for tests.)
  const now = input.asOf ?? new Date();
  const nowKey = now.getFullYear() * 12 + now.getMonth();
  const futureFiltered = parsed.filter((x) => x.p.year * 12 + x.p.idx <= nowKey);
  const usable = futureFiltered.length ? futureFiltered : parsed;
  const latestYear = Math.max(...usable.map((x) => x.p.year));
  const ytd = usable.filter((x) => x.p.year === latestYear).sort((a, b) => a.p.idx - b.p.idx);
  const allSorted = usable.slice().sort((a, b) => a.p.year - b.p.year || a.p.idx - b.p.idx);
  const firstLabel = allSorted[0].row.month;
  const lastRow = ytd[ytd.length - 1];
  const lastP = lastRow.p;
  const ytdMonths = ytd.length;

  const sum = (rows: typeof parsed, f: (r: ExecMonthlyRow) => number) => rows.reduce((s, x) => s + f(x.row), 0);
  const cat = (r: ExecMonthlyRow, key: string) => n((r.expenseCategories || {})[key]);

  const ytdRevenue = r2(sum(ytd, (r) => n(r.totalIncome)));
  const ytdNetIncome = r2(sum(ytd, (r) => n(r.netIncome)));
  const ytdGrossProfit = r2(sum(ytd, (r) => n(r.grossProfit)));
  const ytdExpenses = r2(sum(ytd, (r) => n(r.totalExpenses)));
  const ytdAdSpend = r2(sum(ytd, (r) => cat(r, "Advertising & Marketing")));
  const ytdPayroll = r2(sum(ytd, (r) => cat(r, "Payroll Expenses")));

  const ytdNetLossPct = pctOf(ytdNetIncome, ytdRevenue);
  const grossMargin = pctOf(ytdGrossProfit, ytdRevenue);
  const adSpendPct = pctOf(ytdAdSpend, ytdRevenue);
  const payrollPct = pctOf(ytdPayroll, ytdRevenue);
  const fullYearLossProjection = ytdMonths > 0 ? r0((ytdNetIncome / ytdMonths) * 12) : null;

  // Ad ROI per $1 spent, by year (revenue ÷ advertising). Latest year labeled "YTD".
  const years = Array.from(new Set(usable.map((x) => x.p.year))).sort((a, b) => a - b);
  const adRoiByYear = years.map((y) => {
    const rows = usable.filter((x) => x.p.year === y);
    const rev = sum(rows, (r) => n(r.totalIncome));
    const ad = sum(rows, (r) => cat(r, "Advertising & Marketing"));
    // null (not 0) when there was no ad spend — ROI is undefined, not catastrophic.
    return { year: y === latestYear ? `${y} YTD` : String(y), value: ad > 0 ? r2(rev / ad) : null };
  });
  const roiFirst = adRoiByYear[0]?.value ?? null;
  const roiLast = adRoiByYear[adRoiByYear.length - 1]?.value ?? null;
  const roiDropPct = (roiFirst != null && roiFirst > 0 && roiLast != null && adRoiByYear.length > 1)
    ? r0(((roiFirst - roiLast) / roiFirst) * 100) : null;

  // ── Balance sheet (uploaded BS or seed; live cash overlaid) ──
  const bs = input.balanceSheet || {};
  const cashOnHand = input.cashOnHand != null ? r2(input.cashOnHand) : (bs.cash != null ? n(bs.cash) : null);
  const totalAssets = bs.totalAssets != null ? n(bs.totalAssets) : null;
  const totalLiabilities = bs.totalLiabilities != null ? n(bs.totalLiabilities) : null;
  const ownersEquity = bs.totalEquity != null ? n(bs.totalEquity)
    : (totalAssets != null && totalLiabilities != null ? r2(totalAssets - totalLiabilities) : null);
  const currentAssets = bs.totalCurrentAssets != null ? n(bs.totalCurrentAssets) : null;
  const currentLiabilities = bs.totalCurrentLiabilities != null ? n(bs.totalCurrentLiabilities) : null;
  const currentRatio = currentAssets != null && currentLiabilities ? r2(currentAssets / currentLiabilities) : null;
  const debtToAssets = totalLiabilities != null && totalAssets ? r2(totalLiabilities / totalAssets) : null;
  const totalDebt = totalLiabilities;
  const debtBreakdown = {
    shortTermLoans: n(bs.shortTermNotes),
    creditCards: n(bs.creditCards),
    sba: n(bs.longTermLiabilities),
  };

  // ── Ratios (recomputed; tone by threshold) ──
  const ratios: Array<{ metric: string; value: string; status: string; tone: string }> = [];
  if (ownersEquity != null) ratios.push({ metric: "Owner's equity", value: `(${usd(Math.abs(ownersEquity))})`.replace("(-", "("), status: ownersEquity < 0 ? "Insolvent" : "Positive", tone: ownersEquity < 0 ? "crit" : "ok" });
  if (currentRatio != null) ratios.push({ metric: "Current ratio", value: currentRatio.toFixed(2), status: currentRatio < 1 ? "Critical" : currentRatio < 1.5 ? "Tight" : "Healthy", tone: currentRatio < 1 ? "crit" : currentRatio < 1.5 ? "warn" : "ok" });
  if (debtToAssets != null) ratios.push({ metric: "Debt-to-assets", value: `${debtToAssets.toFixed(2)}×`, status: debtToAssets > 1 ? "Critical" : debtToAssets > 0.6 ? "Elevated" : "Healthy", tone: debtToAssets > 1 ? "crit" : debtToAssets > 0.6 ? "warn" : "ok" });
  if (ytdNetLossPct != null) ratios.push({ metric: `Net margin (${latestYear} YTD)`, value: `${ytdNetLossPct}%`, status: ytdNetLossPct < 0 ? "Critical" : ytdNetLossPct < 5 ? "Thin" : "Healthy", tone: ytdNetLossPct < 0 ? "crit" : ytdNetLossPct < 5 ? "warn" : "ok" });
  if (adSpendPct != null) ratios.push({ metric: "Ad spend % of revenue", value: `${adSpendPct}%`, status: adSpendPct > 30 ? "Unsustainable" : adSpendPct > 20 ? "High" : "Healthy", tone: adSpendPct > 30 ? "crit" : adSpendPct > 20 ? "warn" : "ok" });
  if (grossMargin != null) ratios.push({ metric: `Gross margin (${latestYear} YTD)`, value: `${grossMargin}%`, status: grossMargin < 40 ? "Low" : grossMargin < 55 ? "Declining" : "Healthy", tone: grossMargin < 40 ? "crit" : grossMargin < 55 ? "warn" : "ok" });
  if (payrollPct != null) ratios.push({ metric: "Payroll % of revenue", value: `${payrollPct}%`, status: payrollPct > 25 ? "High" : payrollPct > 18 ? "Rising" : "Healthy", tone: payrollPct > 25 ? "crit" : payrollPct > 18 ? "warn" : "ok" });
  if (cashOnHand != null) ratios.push({ metric: "Cash position", value: usd(cashOnHand), status: cashOnHand >= 40000 ? "Adequate" : "Low", tone: cashOnHand >= 40000 ? "ok" : "warn" });

  // ── Findings (only emitted when the computed condition holds — true by construction) ──
  const findings: Array<{ n: number; title: string; headline: string; detail: string; tone: string }> = [];
  let fi = 0;
  if (ownersEquity != null && ownersEquity < 0) {
    findings.push({ n: ++fi, title: "Insolvent", headline: `Equity: (${usd(Math.abs(ownersEquity))})`, tone: "crit",
      detail: `Assets (${usd(totalAssets ?? 0)}) minus liabilities (${usd(totalLiabilities ?? 0)}) = negative equity.` });
  }
  if (ytdNetIncome < 0) {
    findings.push({ n: ++fi, title: "Operating at a loss", headline: `${latestYear} on pace for ${usd(fullYearLossProjection ?? 0)}`, tone: "crit",
      detail: `${ytdMonths}-month ${latestYear} loss of ${usd(Math.abs(ytdNetIncome))} (${pctStr(ytdNetLossPct)} of ${usd(ytdRevenue)} revenue).` });
  }
  if (roiLast != null && roiLast < 8) {
    findings.push({ n: ++fi, title: "Ad ROI below floor", headline: `$${(roiFirst ?? roiLast).toFixed(2)} → $${roiLast.toFixed(2)} per $1 spent`, tone: roiLast < 4 ? "crit" : "warn",
      detail: `Revenue per ad dollar ${roiDropPct != null ? `fell ${roiDropPct}% since ${years[0]}` : "is below the 8× ROAS floor"}. Ad spend is ${pctStr(adSpendPct)} of revenue.` });
  }
  if (currentRatio != null && currentRatio < 1) {
    findings.push({ n: ++fi, title: "Can't cover near-term bills", headline: `Current ratio: ${currentRatio.toFixed(2)}`, tone: "crit",
      detail: `Only ${Math.round(currentRatio * 100)}¢ of current assets for every $1 due within the year.` });
  }
  if (ytdExpenses > ytdGrossProfit) {
    findings.push({ n: ++fi, title: "Expenses exceed gross profit", headline: "Structurally unprofitable", tone: "crit",
      detail: `${latestYear} YTD operating expenses (${usd(ytdExpenses)}) exceed gross profit (${usd(ytdGrossProfit)}) by ${usd(ytdExpenses - ytdGrossProfit)}.` });
  }
  if (payrollPct != null && payrollPct > 18) {
    findings.push({ n: ++fi, title: "Payroll heavy", headline: `Payroll ${payrollPct}% of revenue`, tone: payrollPct > 25 ? "crit" : "warn",
      detail: `${usd(ytdPayroll)} of payroll on ${usd(ytdRevenue)} revenue (${latestYear} YTD).` });
  }

  const projWord = (fullYearLossProjection ?? 0) < 0 ? "loss" : "profit";
  const critical = (ownersEquity != null && ownersEquity < 0)
    ? `The company is technically insolvent — assets (${usd(totalAssets ?? 0)}) are exceeded by liabilities (${usd(totalLiabilities ?? 0)}), leaving owner's equity at (${usd(Math.abs(ownersEquity))}). At current ${latestYear} pace, the full-year ${projWord} will be about ${usd(Math.abs(fullYearLossProjection ?? 0))}.`
    : `${latestYear} YTD net ${ytdNetIncome < 0 ? "loss" : "income"} is ${usd(ytdNetIncome)} on ${usd(ytdRevenue)} of revenue (${pctStr(ytdNetLossPct)}).`;

  const asOf = `${lastP.year}-${String(lastP.idx + 1).padStart(2, "0")}-${String(new Date(Date.UTC(lastP.year, lastP.idx + 1, 0)).getUTCDate()).padStart(2, "0")}`;

  const usedSeedBs = input.computed === false;
  const cashSource = input.cashOnHand != null ? "Latest QB capture"
    : usedSeedBs ? "Accountant baseline" : "From uploaded balance sheet";
  return {
    source: "Live Financial Summary (computed from your uploads)",
    preparedBy: "SBR app · QuickBooks authoritative",
    basis: "Accrual",
    asOf,
    bsAsOf: input.bsAsOf ?? null,
    periodLabel: `${firstLabel} – ${lastRow.row.month} (inception-to-date)`,
    computed: true,
    balanceSheetSource: usedSeedBs ? "accountant_seed" : "accountant_upload", // match /api/finances/overview
    critical,
    headline: {
      cashOnHand: cashOnHand ?? 0,
      cashSource,
      ytdNetLoss: r0(ytdNetIncome),
      ytdNetLossPctOfRevenue: ytdNetLossPct ?? 0,
      totalDebt: totalDebt ?? 0,
      // Seed-only delta — valid only when debt itself is the seed. On the live path
      // there's no prior balance sheet to compare, so it's null (card hides the subtitle).
      totalDebtChangePctSinceDec2025: usedSeedBs ? seed.headline.totalDebtChangePctSinceDec2025 : null,
      ownersEquity: ownersEquity ?? 0,
      totalAssets: totalAssets ?? 0,
      fullYearLossProjection: fullYearLossProjection ?? 0,
      debtBreakdown,
      ytdYear: latestYear,
      ytdMonths,
    },
    ratios,
    adRoiByYear,
    roiDropPct,
    findings,
  };
}

/** Gather IO (same sources as /api/finances/overview) and compute. Falls back to
 *  the seed constant on any failure — the card must never break. */
export async function getExecutiveSummary(storage: any): Promise<any> {
  try {
    const [monthly, bsSnapshot, qbLive] = await Promise.all([
      storage.getMonthlyFinancials(),
      storage.getLatestQbBalanceSheetSnapshot(),
      storage.getLatestQbLiveSnapshot(),
    ]);
    const { FINANCIAL_SEED } = await import("../data/financial-seed");
    const uploadedBS: any = (bsSnapshot as any)?.raw?.balanceSheet ?? null;
    const useUploaded = uploadedBS && (uploadedBS.totalLiabilities != null || uploadedBS.cash != null);
    const balanceSheet = useUploaded ? uploadedBS : (FINANCIAL_SEED as any).balanceSheet;
    const cashOnHand = (qbLive as any)?.cashOnHand != null ? Number((qbLive as any).cashOnHand) : null;
    return buildExecutiveSummary({
      monthly: (monthly as any[]) || [],
      balanceSheet,
      cashOnHand,
      bsAsOf: useUploaded ? (uploadedBS.asOf ?? null) : ((FINANCIAL_SEED as any).balanceSheet?.asOf ?? null),
      computed: useUploaded,
    });
  } catch (e: any) {
    console.error("[CIPH.R] getExecutiveSummary failed, serving seed:", e?.message ?? e);
    return EXECUTIVE_SUMMARY;
  }
}
