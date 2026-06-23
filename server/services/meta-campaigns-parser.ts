/**
 * Parse a Meta Ads Manager "Campaigns" export (multi-campaign, period rollup) into
 * per-campaign rows for the month-over-month campaign trend. Distinct from
 * meta-tracker-parser (a single-campaign daily tracker). Tolerant: reuses the
 * universal tabular reader so quoted campaign names with commas survive.
 *
 * Each spending campaign row becomes a CampaignRow; the blank-name account-total
 * row and zero-spend rows are skipped. Revenue = spend × Purchase ROAS when present.
 */
import { normalizeTabular } from "./universal-doc-parser";
import { toISODate } from "./ad-spend-parser";
import type { CampaignRow } from "./marketing-trend-service";

const norm = (s: any) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const num = (v: any): number | null => {
  if (v == null || v === "") return null;
  const s = String(v).replace(/[$,%()]/g, "").replace(/[a-z]/gi, "").trim();
  if (s === "" || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface MetaCampaignsParse {
  ok: boolean;
  error?: string;
  platform: "META";
  periodStart: string | null;
  periodEnd: string | null;
  month: string | null;         // YYYY-MM, bucketed by period end
  campaigns: CampaignRow[];
  totalSpend: number;
}

export function parseMetaCampaignsCsv(buffer: Buffer, fileName = "", mime = ""): MetaCampaignsParse {
  let columns: string[] = [];
  let rows: Record<string, any>[] = [];
  try {
    const out = normalizeTabular(buffer, fileName, mime);
    columns = out.columns;
    rows = out.rows;
  } catch (e: any) {
    return { ok: false, error: e?.message || "Could not read the file", platform: "META", periodStart: null, periodEnd: null, month: null, campaigns: [], totalSpend: 0 };
  }

  const col = (cands: string[]): string | null => {
    for (const c of cands) {
      const cn = norm(c);
      const hit = columns.find((k) => norm(k) === cn) || columns.find((k) => norm(k).includes(cn));
      if (hit) return hit;
    }
    return null;
  };
  const nameCol = col(["Campaign name", "Campaign"]);
  const spendCol = col(["Amount spent (USD)", "Amount spent", "Spend"]);
  // Purchase ROAS only — a bare "ROAS" match could pick up a website/other ROAS column.
  const roasCol = col(["Purchase ROAS (return on ad spend)", "Purchase ROAS"]);
  const purCol = col(["Purchases", "Results"]);
  const impCol = col(["Impressions"]);
  const startCol = col(["Reporting starts", "Reporting start"]);
  const endCol = col(["Reporting ends", "Reporting end"]);

  if (!nameCol || !spendCol) {
    return { ok: false, error: "Not a Meta campaigns export (missing Campaign name / Amount spent).", platform: "META", periodStart: null, periodEnd: null, month: null, campaigns: [], totalSpend: 0 };
  }

  let periodStart: string | null = null;
  let periodEnd: string | null = null;
  const campaigns: CampaignRow[] = [];
  for (const r of rows) {
    if (!periodStart && startCol) periodStart = toISODate(r[startCol]);
    if (!periodEnd && endCol) periodEnd = toISODate(r[endCol]);
    const name = String(r[nameCol] ?? "").trim();
    const spend = num(r[spendCol]);
    if (!name || spend == null || spend <= 0) continue; // skip account total + non-spending rows
    const roas = roasCol ? num(r[roasCol]) : null;
    const purchases = purCol ? num(r[purCol]) : null;
    campaigns.push({
      campaign: name,
      spend: r2(spend),
      revenue: roas != null && roas > 0 ? r2(spend * roas) : null,
      purchases: purchases != null ? Math.round(purchases) : null,
      impressions: impCol ? (num(r[impCol]) != null ? Math.round(num(r[impCol])!) : null) : null,
    });
  }

  const month = (periodEnd || periodStart || "").slice(0, 7) || null;
  const totalSpend = r2(campaigns.reduce((s, c) => s + c.spend, 0));
  return {
    ok: campaigns.length > 0,
    error: campaigns.length === 0 ? "No spending campaigns found in the file." : undefined,
    platform: "META", periodStart, periodEnd, month, campaigns, totalSpend,
  };
}
