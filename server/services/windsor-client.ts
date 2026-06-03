/**
 * Windsor.ai client — unified ad-spend connector.
 *
 * Windsor.ai authorizes Google Ads, Meta (Facebook + Instagram), Amazon Ads,
 * TikTok, and Pinterest INSIDE Windsor, then exposes one normalized REST feed
 * at connectors.windsor.ai/all. This lets us populate ad_metrics_daily for
 * every platform from a single API key — before any native per-platform OAuth
 * is wired in our own app.
 *
 * Docs: https://windsor.ai/api-fields/  (the /all connector returns one row
 * per source/date/campaign with the fields requested in `fields=`).
 */

const WINDSOR_BASE = "https://connectors.windsor.ai/all";

// Fields we ask Windsor for. Defensive: not every source populates every
// field, so the ingestion layer reads multiple aliases and coerces to numbers.
const WINDSOR_FIELDS = [
  "source",
  "date",
  "campaign",
  "device",
  "country",
  "clicks",
  "impressions",
  "spend",
  "conversions",
  "total_conversion_value",
  "product_item_id",
  "currency",
].join(",");

export interface WindsorRow {
  source?: string;
  date?: string;
  campaign?: string;
  device?: string;
  country?: string;
  clicks?: number | string;
  impressions?: number | string;
  spend?: number | string;
  conversions?: number | string;
  total_conversion_value?: number | string;
  conversion_value?: number | string;
  revenue?: number | string;
  product_item_id?: string;
  currency?: string;
  [k: string]: unknown;
}

export interface WindsorFetchOptions {
  apiKey: string;
  dateFrom: string; // YYYY-MM-DD
  dateTo: string; // YYYY-MM-DD
}

/**
 * Pull raw rows from Windsor for the given date window. Returns the flat
 * `data` array exactly as Windsor sends it; mapping/normalization happens in
 * the ingestion service so this stays a thin transport layer.
 */
export async function fetchWindsorRows(opts: WindsorFetchOptions): Promise<WindsorRow[]> {
  const params = new URLSearchParams({
    api_key: opts.apiKey,
    date_from: opts.dateFrom,
    date_to: opts.dateTo,
    fields: WINDSOR_FIELDS,
    _renderer: "json",
  });

  const url = `${WINDSOR_BASE}?${params.toString()}`;
  const res = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Windsor API ${res.status}: ${body.slice(0, 300)}`);
  }

  const json = (await res.json()) as { data?: WindsorRow[]; error?: string };
  if (json.error) throw new Error(`Windsor API error: ${json.error}`);
  return Array.isArray(json.data) ? json.data : [];
}

/**
 * Normalize Windsor's `source` string to our ad_metrics_daily.platform codes.
 * Windsor uses values like "facebook", "google_ads", "amazon_ads", "tiktok".
 */
export function normalizePlatform(source: string | undefined): string | null {
  if (!source) return null;
  const s = source.toLowerCase().trim();

  // Skip non-ad / organic / junk traffic sources
  if (s === "(direct)" || s === "(not set)" || s === "(none)" || s === "direct" ||
      s === "(data not available)" || s.startsWith("{{") ||
      s === "duckduckgo" || s === "chatgpt.com" || s === "shopify_email" ||
      s.includes("clickup.com") || s.includes(".com") && !KNOWN_DOMAINS.has(s)) return null;

  // Meta family (Facebook + Instagram)
  if (s === "fb" || s === "ig" || s.includes("facebook") || s.includes("meta") || s.includes("instagram")) return "META";
  // Google family (Search + Shopping + YouTube)
  if (s === "google" || s.includes("google") || s === "youtube.com" || s.includes("youtube")) return "GOOGLE";
  // Microsoft / Bing
  if (s === "bing" || s.includes("bing") || s.includes("microsoft")) return "MICROSOFT";
  // Amazon
  if (s.includes("amazon")) return "AMAZON";
  // TikTok
  if (s.includes("tiktok")) return "TIKTOK";
  // Pinterest
  if (s.includes("pinterest")) return "PINTEREST";
  // Reddit
  if (s === "reddit.com" || s.includes("reddit")) return "REDDIT";
  // Yahoo / Gemini
  if (s === "yahoo" || s.includes("yahoo")) return "YAHOO";
  // Anything else not recognized — skip rather than pollute
  return null;
}

const KNOWN_DOMAINS = new Set([
  "youtube.com", "reddit.com", "amazon.com", "pinterest.com", "tiktok.com",
]);
