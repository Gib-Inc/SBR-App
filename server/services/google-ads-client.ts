/**
 * Google Ads Client
 * 
 * Handles OAuth 2.0 authentication and fetching ad insights for inventory forecasting.
 * 
 * V1 Scope:
 * - OAuth flow via Google
 * - List accessible customer accounts
 * - GAQL queries for shopping performance (SKU-level data)
 * - Aggregate by SKU for ad_metrics_daily
 */

import { AuditLogger } from './audit-logger';
import { storage as defaultStorage } from "../storage";
import { hashMarketingSnapshot } from "./reconciliation-service";

export interface GoogleAdsCustomer {
  customerId: string;
  descriptiveName: string;
  currencyCode: string;
  timeZone: string;
}

export interface GoogleInsightsResult {
  sku: string;
  date: string; // YYYY-MM-DD
  impressions: number;
  clicks: number;
  spend: number; // In account currency (converted from micros)
  conversions: number;
  revenue: number;
  currency: string;
}

interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  developerToken?: string;
}

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

export class GoogleAdsClient {
  private config: GoogleOAuthConfig | null = null;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private developerToken: string | null = null;
  private customerId: string | null = null;
  private baseUrl = 'https://googleads.googleapis.com/v21';

  constructor() {
    this.loadConfig();
  }

  private loadConfig() {
    const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
    const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    const redirectUri = process.env.GOOGLE_ADS_REDIRECT_URI || 
      `${process.env.APP_BASE_URL || 'http://localhost:5000'}/api/ads/google/callback`;

    if (clientId && clientSecret) {
      this.config = { clientId, clientSecret, redirectUri, developerToken };
      this.developerToken = developerToken || null;
    }
  }

  isConfigured(): boolean {
    return this.config !== null;
  }

  setAccessToken(token: string) {
    this.accessToken = token;
  }

  setRefreshToken(token: string) {
    this.refreshToken = token;
  }

  setCustomerId(id: string) {
    this.customerId = id;
  }

  /**
   * Generate OAuth authorization URL
   */
  getAuthUrl(state: string): string {
    if (!this.config) {
      throw new Error('Google Ads not configured - missing GOOGLE_ADS_CLIENT_ID or GOOGLE_ADS_CLIENT_SECRET');
    }

    const scopes = ['https://www.googleapis.com/auth/adwords'];
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: scopes.join(' '),
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      state,
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCodeForToken(code: string): Promise<GoogleTokenResponse> {
    if (!this.config) {
      throw new Error('Google Ads not configured');
    }

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uri: this.config.redirectUri,
        code,
        grant_type: 'authorization_code',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to exchange code for token: ${error}`);
    }

    return response.json();
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(): Promise<GoogleTokenResponse> {
    if (!this.config || !this.refreshToken) {
      throw new Error('Google Ads not configured or refresh token not set');
    }

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: this.refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to refresh token: ${error}`);
    }

    const tokens: GoogleTokenResponse = await response.json();
    this.accessToken = tokens.access_token;
    return tokens;
  }

  /**
   * List accessible customer accounts
   */
  async listAccessibleCustomers(): Promise<GoogleAdsCustomer[]> {
    if (!this.accessToken) {
      throw new Error('Access token not set');
    }

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
    };
    
    if (this.developerToken) {
      headers['developer-token'] = this.developerToken;
    }

    const response = await fetch(`${this.baseUrl}/customers:listAccessibleCustomers`, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to list customers: ${error}`);
    }

    const data = await response.json();
    const resourceNames: string[] = data.resourceNames || [];
    
    // Get details for each customer
    const customers: GoogleAdsCustomer[] = [];
    for (const resourceName of resourceNames) {
      const customerId = resourceName.replace('customers/', '');
      try {
        const customer = await this.getCustomerDetails(customerId);
        if (customer) {
          customers.push(customer);
        }
      } catch (error) {
        console.error(`[GoogleAdsClient] Error fetching customer ${customerId}:`, error);
      }
    }

    return customers;
  }

  /**
   * Get details for a specific customer
   */
  private async getCustomerDetails(customerId: string): Promise<GoogleAdsCustomer | null> {
    if (!this.accessToken) return null;

    const query = `
      SELECT
        customer.id,
        customer.descriptive_name,
        customer.currency_code,
        customer.time_zone
      FROM customer
      LIMIT 1
    `;

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
    };
    
    if (this.developerToken) {
      headers['developer-token'] = this.developerToken;
    }

    const response = await fetch(`${this.baseUrl}/customers/${customerId}/googleAds:searchStream`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const result = data[0]?.results?.[0]?.customer;
    
    if (!result) return null;

    return {
      customerId: result.id,
      descriptiveName: result.descriptiveName || customerId,
      currencyCode: result.currencyCode || 'USD',
      timeZone: result.timeZone || 'UTC',
    };
  }

  /**
   * Fetch shopping performance by SKU (product_item_id)
   * This is the key query for SKU-level ad metrics
   */
  async fetchShoppingPerformance(
    customerId: string,
    startDate: Date,
    endDate: Date
  ): Promise<GoogleInsightsResult[]> {
    if (!this.accessToken) {
      throw new Error('Access token not set');
    }

    const startStr = startDate.toISOString().split('T')[0].replace(/-/g, '');
    const endStr = endDate.toISOString().split('T')[0].replace(/-/g, '');

    // GAQL query for shopping performance view (SKU-level data)
    const query = `
      SELECT
        segments.product_item_id,
        segments.date,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value
      FROM shopping_performance_view
      WHERE segments.date BETWEEN '${startStr}' AND '${endStr}'
    `;

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
    };
    
    if (this.developerToken) {
      headers['developer-token'] = this.developerToken;
    }

    const response = await fetch(`${this.baseUrl}/customers/${customerId}/googleAds:searchStream`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to fetch shopping performance: ${error}`);
    }

    const data = await response.json();
    const results: GoogleInsightsResult[] = [];

    for (const batch of data || []) {
      for (const row of batch.results || []) {
        const sku = row.segments?.productItemId;
        if (!sku) continue;

        // Convert date from YYYY-MM-DD format (already in correct format from Google)
        const dateStr = row.segments?.date;
        if (!dateStr) continue;
        
        // Format date properly (Google returns YYYYMMDD, we need YYYY-MM-DD)
        const formattedDate = `${dateStr.slice(0,4)}-${dateStr.slice(4,6)}-${dateStr.slice(6,8)}`;

        results.push({
          sku,
          date: formattedDate,
          impressions: parseInt(row.metrics?.impressions || '0', 10),
          clicks: parseInt(row.metrics?.clicks || '0', 10),
          spend: (parseInt(row.metrics?.costMicros || '0', 10) / 1000000), // Convert micros to dollars
          conversions: parseFloat(row.metrics?.conversions || '0'),
          revenue: parseFloat(row.metrics?.conversionsValue || '0'),
          currency: 'USD', // Will be set from account config
        });
      }
    }

    return results;
  }

  /**
   * Fetch campaign performance with manual SKU mapping
   * Used when shopping campaigns aren't available
   */
  async fetchCampaignPerformance(
    customerId: string,
    startDate: Date,
    endDate: Date,
    skuMappings: Map<string, string> // campaignId -> sku
  ): Promise<GoogleInsightsResult[]> {
    if (!this.accessToken) {
      throw new Error('Access token not set');
    }

    const startStr = startDate.toISOString().split('T')[0].replace(/-/g, '');
    const endStr = endDate.toISOString().split('T')[0].replace(/-/g, '');

    const query = `
      SELECT
        campaign.id,
        campaign.name,
        segments.date,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value
      FROM campaign
      WHERE segments.date BETWEEN '${startStr}' AND '${endStr}'
    `;

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
    };
    
    if (this.developerToken) {
      headers['developer-token'] = this.developerToken;
    }

    const response = await fetch(`${this.baseUrl}/customers/${customerId}/googleAds:searchStream`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to fetch campaign performance: ${error}`);
    }

    const data = await response.json();
    const results: GoogleInsightsResult[] = [];

    for (const batch of data || []) {
      for (const row of batch.results || []) {
        const campaignId = row.campaign?.id;
        if (!campaignId) continue;

        // Look up SKU from mapping
        const sku = skuMappings.get(campaignId);
        if (!sku) continue;

        const dateStr = row.segments?.date;
        if (!dateStr) continue;
        
        const formattedDate = `${dateStr.slice(0,4)}-${dateStr.slice(4,6)}-${dateStr.slice(6,8)}`;

        results.push({
          sku,
          date: formattedDate,
          impressions: parseInt(row.metrics?.impressions || '0', 10),
          clicks: parseInt(row.metrics?.clicks || '0', 10),
          spend: (parseInt(row.metrics?.costMicros || '0', 10) / 1000000),
          conversions: parseFloat(row.metrics?.conversions || '0'),
          revenue: parseFloat(row.metrics?.conversionsValue || '0'),
          currency: 'USD',
        });
      }
    }

    return results;
  }

  /**
   * Test connection by fetching accessible customers
   */
  async testConnection(): Promise<{ success: boolean; customersCount?: number; error?: string }> {
    if (!this.accessToken) {
      return { success: false, error: 'Access token not set' };
    }

    try {
      const customers = await this.listAccessibleCustomers();
      return { success: true, customersCount: customers.length };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  // -------------------------------------------------------------------------
  // Direct spend feed (Feed 2) — clone of the Meta direct-feed pattern in
  // meta-ads-client.ts. Env-gated dark launch: with any credential missing the
  // feed reports awaiting_credentials and writes nothing.
  // -------------------------------------------------------------------------

  isDirectFeedConfigured(): boolean {
    return googleDirectMissingEnv().length === 0;
  }

  private directCustomerId(): string {
    const raw = String(process.env.GOOGLE_ADS_CUSTOMER_ID || "").replace(/[^0-9]/g, "");
    if (!raw) throw new Error("GOOGLE_ADS_CUSTOMER_ID is not set");
    return raw;
  }

  private directLoginCustomerId(): string {
    const raw = String(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || "").replace(/[^0-9]/g, "");
    if (!raw) throw new Error("GOOGLE_ADS_LOGIN_CUSTOMER_ID is not set");
    return raw;
  }

  private async fetchDirectAccessToken(): Promise<string> {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: String(process.env.GOOGLE_ADS_CLIENT_ID || ""),
        client_secret: String(process.env.GOOGLE_ADS_CLIENT_SECRET || ""),
        refresh_token: String(process.env.GOOGLE_ADS_REFRESH_TOKEN || ""),
        grant_type: "refresh_token",
      }),
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Google direct feed token refresh failed (${response.status}): ${error.slice(0, 500)}`);
    }
    const data = await response.json() as { access_token?: string };
    if (!data.access_token) throw new Error("Google direct feed token refresh returned no access_token");
    return data.access_token;
  }

  /**
   * Daily campaign-level GAQL pull for the trailing 3-day window ending
   * yesterday. NOTE: the spec's `DURING LAST_3_DAYS` is not a valid GAQL
   * predefined date range (GAQL has LAST_7_DAYS but no LAST_3_DAYS), so the
   * identical window is expressed as `segments.date BETWEEN start AND end`
   * with the same trailing 3 days the Meta feed uses.
   */
  async fetchDirectDailyRows(start: string, end: string): Promise<GoogleDirectRow[]> {
    const accessToken = await this.fetchDirectAccessToken();
    const query = `SELECT segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date BETWEEN '${start}' AND '${end}'`;
    const headers: Record<string, string> = {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "developer-token": String(process.env.GOOGLE_ADS_DEVELOPER_TOKEN || ""),
      "login-customer-id": this.directLoginCustomerId(),
    };

    const rows: GoogleDirectRow[] = [];
    let pageToken: string | undefined;
    do {
      const response = await fetch(`${this.baseUrl}/customers/${this.directCustomerId()}/googleAds:search`, {
        method: "POST",
        headers,
        body: JSON.stringify(pageToken ? { query, pageToken } : { query }),
      });
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Google direct insights failed (${response.status}): ${error.slice(0, 500)}`);
      }
      const data = await response.json() as { results?: GoogleDirectRow[]; nextPageToken?: string };
      rows.push(...(data.results ?? []));
      pageToken = data.nextPageToken;
    } while (pageToken);
    return rows;
  }
}

export const googleAdsClient = new GoogleAdsClient();

// ---------------------------------------------------------------------------
// Direct spend feed types, aggregation, writer, and confidence — mirrors the
// Meta direct-feed section of meta-ads-client.ts (helpers copied, not shared,
// so this feed never touches Meta code).
// ---------------------------------------------------------------------------

/** One campaign-day row as returned by the Google Ads REST search endpoint. */
export interface GoogleDirectRow {
  campaign?: { id?: string; name?: string };
  segments?: { date?: string };
  metrics?: {
    costMicros?: string | number;
    impressions?: string | number;
    clicks?: string | number;
    conversions?: string | number;
    conversionsValue?: string | number;
  };
}

export interface GoogleDirectDailySnapshot {
  date: string;
  spend: number;
  impressions: number | null;
  clicks: number | null;
  conversions: number | null;
  revenue: number | null;
  status: "OK" | "DATA_GAPPED";
  dataGaps: string[];
  raw: {
    source: "google-direct-api";
    rowCount: number;
    revenueBasis: "conversions_value" | null;
  };
}

export interface GoogleDirectSyncResult {
  status: "success" | "skipped" | "failed";
  reason?: string;
  periodStart?: string;
  periodEnd?: string;
  created: number;
  superseded: number;
  gapped: number;
  days: GoogleDirectDailySnapshot[];
}

type GoogleDirectStorage = Pick<typeof defaultStorage,
  "getAppSetting" |
  "setAppSetting" |
  "getActiveMarketingSpendSnapshots" |
  "getMarketingSpendSnapshotsInRange" |
  "markMarketingSpendSnapshotsSuperseded" |
  "createMarketingSpendSnapshot" |
  "createDataReconciliationLog" |
  "createSystemLog"
>;

const GOOGLE_DIRECT_SOURCE = "google-direct-api";
const GOOGLE_DIRECT_FAILURES_KEY = "google_direct_consecutive_failures";
const GOOGLE_DIRECT_PAUSED_KEY = "google_direct_paused";
const GOOGLE_DIRECT_STATUS_KEY = "google_direct_latest_status";
const GOOGLE_DIRECT_FAILURE_THRESHOLD = 3;
const GOOGLE_DIRECT_ENV_VARS = [
  "GOOGLE_ADS_DEVELOPER_TOKEN",
  "GOOGLE_ADS_CLIENT_ID",
  "GOOGLE_ADS_CLIENT_SECRET",
  "GOOGLE_ADS_REFRESH_TOKEN",
  "GOOGLE_ADS_CUSTOMER_ID",
  "GOOGLE_ADS_LOGIN_CUSTOMER_ID",
] as const;

function googleDirectMissingEnv(): string[] {
  return GOOGLE_DIRECT_ENV_VARS.filter((name) => !String(process.env[name] || "").trim());
}

function isoDateUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDateUTC(d);
}

function trailingGoogleWindow(now = new Date()): { start: string; end: string } {
  const endDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  endDate.setUTCDate(endDate.getUTCDate() - 1);
  const end = isoDateUTC(endDate);
  return { start: addDays(end, -2), end };
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function aggregateGoogleDirectRows(
  rows: GoogleDirectRow[],
  start: string,
  end: string,
): GoogleDirectDailySnapshot[] {
  const byDate = new Map<string, GoogleDirectRow[]>();
  for (const row of rows) {
    const day = row.segments?.date;
    if (!day || day < start || day > end) continue;
    if (!byDate.has(day)) byDate.set(day, []);
    byDate.get(day)!.push(row);
  }

  const days: GoogleDirectDailySnapshot[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) {
    const dayRows = byDate.get(day) ?? [];
    const dataGaps: string[] = [];
    if (!dayRows.length) dataGaps.push("Google Ads API returned no campaign rows for this date; not treated as a real zero.");
    const costValues = dayRows.map((r) => num(r.metrics?.costMicros));
    const impressionValues = dayRows.map((r) => num(r.metrics?.impressions));
    if (dayRows.length && costValues.some((v) => v == null)) dataGaps.push("One or more Google Ads rows were missing cost_micros.");
    if (dayRows.length && impressionValues.some((v) => v == null)) dataGaps.push("One or more Google Ads rows were missing impressions.");

    const spend = round2(costValues.reduce<number>((s, v) => s + (v ?? 0), 0) / 1_000_000);
    const impressionsSeen = impressionValues.some((v) => v != null);
    const impressions = impressionsSeen ? Math.round(impressionValues.reduce<number>((s, v) => s + (v ?? 0), 0)) : null;
    const clickValues = dayRows.map((r) => num(r.metrics?.clicks)).filter((v): v is number => v != null);
    const conversionValues = dayRows.map((r) => num(r.metrics?.conversions)).filter((v): v is number => v != null);
    const revenueValues = dayRows.map((r) => num(r.metrics?.conversionsValue)).filter((v): v is number => v != null);

    days.push({
      date: day,
      spend,
      impressions,
      clicks: clickValues.length ? Math.round(clickValues.reduce((s, v) => s + v, 0)) : null,
      conversions: conversionValues.length ? round2(conversionValues.reduce((s, v) => s + v, 0)) : null,
      revenue: revenueValues.length ? round2(revenueValues.reduce((s, v) => s + v, 0)) : null,
      status: dataGaps.length ? "DATA_GAPPED" : "OK",
      dataGaps,
      raw: {
        source: GOOGLE_DIRECT_SOURCE,
        rowCount: dayRows.length,
        revenueBasis: revenueValues.length ? "conversions_value" : null,
      },
    });
  }
  return days;
}

export async function getGoogleDirectFeedConfidence(
  deps: { storage?: Pick<GoogleDirectStorage, "getActiveMarketingSpendSnapshots" | "getAppSetting">; now?: Date } = {},
): Promise<{
  feed: "google-direct";
  confidence: "actual" | "fallback" | "awaiting_credentials" | "paused" | "stale";
  latestPeriodEnd: string | null;
  daysOld: number | null;
  source: string | null;
  reason: string;
}> {
  const s = deps.storage ?? defaultStorage as any;
  const missing = googleDirectMissingEnv();
  if (missing.length) {
    return { feed: "google-direct", confidence: "awaiting_credentials", latestPeriodEnd: null, daysOld: null, source: null, reason: `Google Ads direct feed credentials not configured: ${missing.join(", ")}.` };
  }
  const paused = await s.getAppSetting(GOOGLE_DIRECT_PAUSED_KEY).catch(() => null);
  if (paused === "true") {
    return { feed: "google-direct", confidence: "paused", latestPeriodEnd: null, daysOld: null, source: GOOGLE_DIRECT_SOURCE, reason: "Google direct feed paused after consecutive API failures." };
  }
  const snaps = ((await s.getActiveMarketingSpendSnapshots().catch(() => [])) as any[])
    .filter((x) => String(x.platform || "").toUpperCase() === "GOOGLE" && String(x.source || "") === GOOGLE_DIRECT_SOURCE && x.periodEnd);
  // Freshness is judged on rows carrying real API data ONLY. DATA_GAPPED rows
  // are placeholders for days Google returned nothing — a recent gap row must
  // not make the feed look fresh.
  const okSnaps = snaps.filter((x) => String(x.status || "") !== "DATA_GAPPED");
  const gappedEnds = snaps
    .filter((x) => String(x.status || "") === "DATA_GAPPED")
    .map((x) => String(x.periodEnd))
    .sort();
  const latest = okSnaps.sort((a, b) => String(b.periodEnd).localeCompare(String(a.periodEnd)))[0];
  if (!latest) {
    if (gappedEnds.length) {
      return { feed: "google-direct", confidence: "stale", latestPeriodEnd: null, daysOld: null, source: GOOGLE_DIRECT_SOURCE, reason: `All recent Google direct rows are DATA_GAPPED (${gappedEnds.join(", ")}) — no usable API data; manual Google spend upload is the fallback until the API recovers.` };
    }
    return { feed: "google-direct", confidence: "fallback", latestPeriodEnd: null, daysOld: null, source: null, reason: "No active Google direct snapshot yet; manual Google spend uploads remain canonical if present." };
  }
  const today = isoDateUTC(deps.now ?? new Date());
  const daysOld = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${latest.periodEnd}T00:00:00Z`)) / 86400000);
  if (daysOld <= 2) {
    return { feed: "google-direct", confidence: "actual", latestPeriodEnd: latest.periodEnd, daysOld, source: GOOGLE_DIRECT_SOURCE, reason: "Google direct feed is fresh; overlapping manual Google snapshots are superseded." };
  }
  const gapSuffix = gappedEnds.length ? ` Gapped day(s) with no API data: ${gappedEnds.join(", ")}.` : "";
  return { feed: "google-direct", confidence: "stale", latestPeriodEnd: latest.periodEnd, daysOld, source: GOOGLE_DIRECT_SOURCE, reason: `Google direct feed is stale >2 days; manual Google spend upload is the fallback until the API recovers.${gapSuffix}` };
}

export async function isFreshGoogleDirectProtectedForPeriod(
  periodStart: string | null | undefined,
  periodEnd: string | null | undefined,
  deps: { storage?: Pick<GoogleDirectStorage, "getActiveMarketingSpendSnapshots">; now?: Date } = {},
): Promise<{ protected: boolean; overlappingDirectIds: string[]; latestPeriodEnd: string | null; reason: string }> {
  if (!periodStart || !periodEnd) {
    return { protected: false, overlappingDirectIds: [], latestPeriodEnd: null, reason: "No period supplied." };
  }
  const s = deps.storage ?? defaultStorage as any;
  const active = ((await s.getActiveMarketingSpendSnapshots().catch(() => [])) as any[])
    .filter((x) => String(x.platform || "").toUpperCase() === "GOOGLE" && String(x.source || "") === GOOGLE_DIRECT_SOURCE && x.periodStart && x.periodEnd);
  // Only rows with real API data can protect a period. DATA_GAPPED rows are
  // no-data placeholders — a gap row must neither look fresh nor block a
  // manual upload from filling the very day the API failed to cover.
  const okActive = active.filter((x) => String(x.status || "") !== "DATA_GAPPED");
  const gappedEnds = active
    .filter((x) => String(x.status || "") === "DATA_GAPPED")
    .map((x) => String(x.periodEnd))
    .sort();
  const latest = okActive.sort((a, b) => String(b.periodEnd).localeCompare(String(a.periodEnd)))[0];
  if (!latest) {
    if (gappedEnds.length) {
      return { protected: false, overlappingDirectIds: [], latestPeriodEnd: null, reason: `All active Google direct rows are DATA_GAPPED (${gappedEnds.join(", ")}) — no usable API data; manual upload may fill the gap.` };
    }
    return { protected: false, overlappingDirectIds: [], latestPeriodEnd: null, reason: "No active Google direct snapshots exist; manual may be canonical." };
  }
  const today = isoDateUTC(deps.now ?? new Date());
  const daysOld = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${latest.periodEnd}T00:00:00Z`)) / 86400000);
  const overlapping = okActive.filter((x) => x.periodStart <= periodEnd && x.periodEnd >= periodStart);
  if (!overlapping.length) {
    return { protected: false, overlappingDirectIds: [], latestPeriodEnd: latest.periodEnd, reason: "No direct Google row overlaps this manual period." };
  }
  if (daysOld <= 2) {
    return {
      protected: true,
      overlappingDirectIds: overlapping.map((x) => x.id),
      latestPeriodEnd: latest.periodEnd,
      reason: "Fresh Google direct API data overlaps this period, so manual upload is ignored to prevent double-counting.",
    };
  }
  return {
    protected: false,
    overlappingDirectIds: overlapping.map((x) => x.id),
    latestPeriodEnd: latest.periodEnd,
    reason: "Google direct API data is stale >2 days; manual upload may replace it as fallback.",
  };
}

export async function syncGoogleDirectSpend(
  deps: {
    storage?: GoogleDirectStorage;
    client?: Pick<GoogleAdsClient, "isDirectFeedConfigured" | "fetchDirectDailyRows">;
    now?: Date;
  } = {},
): Promise<GoogleDirectSyncResult> {
  const s = deps.storage ?? defaultStorage;
  const client = deps.client ?? googleAdsClient;
  const now = deps.now ?? new Date();
  const { start, end } = trailingGoogleWindow(now);

  if (!client.isDirectFeedConfigured()) {
    // Dark and quiet: no failure logged, no breaker state touched.
    const result: GoogleDirectSyncResult = { status: "skipped", reason: "awaiting_credentials", periodStart: start, periodEnd: end, created: 0, superseded: 0, gapped: 0, days: [] };
    await s.setAppSetting(GOOGLE_DIRECT_STATUS_KEY, JSON.stringify({ ...result, updatedAt: now.toISOString() })).catch(() => {});
    return result;
  }

  const paused = await s.getAppSetting(GOOGLE_DIRECT_PAUSED_KEY).catch(() => null);
  if (paused === "true") {
    const result: GoogleDirectSyncResult = { status: "skipped", reason: "paused_after_3_failures", periodStart: start, periodEnd: end, created: 0, superseded: 0, gapped: 0, days: [] };
    await s.setAppSetting(GOOGLE_DIRECT_STATUS_KEY, JSON.stringify({ ...result, updatedAt: now.toISOString() })).catch(() => {});
    return result;
  }

  try {
    const rows = await client.fetchDirectDailyRows(start, end);
    const days = aggregateGoogleDirectRows(rows, start, end);
    let created = 0;
    let superseded = 0;
    let gapped = 0;

    for (const day of days) {
      if (day.status === "DATA_GAPPED") gapped++;
      const active = await s.getMarketingSpendSnapshotsInRange(day.date, day.date);
      const overlapping = (active as any[]).filter((snap) => String(snap.platform || "").toUpperCase() === "GOOGLE");
      // A gapped day carries no real data — it must NEVER displace a non-direct
      // row (manual/Windsor) that already covers the day (same guard shape as
      // the Meta feed, 0f8d4ed).
      if (day.status === "DATA_GAPPED" && overlapping.some((snap: any) => String(snap.source || "") !== GOOGLE_DIRECT_SOURCE)) {
        continue;
      }
      if (overlapping.length) {
        await s.markMarketingSpendSnapshotsSuperseded(overlapping.map((snap: any) => snap.id), GOOGLE_DIRECT_SOURCE);
        superseded += overlapping.length;
      }

      const sourceHash = hashMarketingSnapshot({
        platform: "GOOGLE",
        periodStart: day.date,
        periodEnd: day.date,
        spend: day.spend,
        impressions: day.impressions,
        clicks: day.clicks,
      });

      await s.createMarketingSpendSnapshot({
        platform: "GOOGLE",
        periodStart: day.date,
        periodEnd: day.date,
        spend: day.spend,
        impressions: day.impressions,
        clicks: day.clicks,
        conversions: day.conversions,
        revenue: day.revenue,
        currency: "USD",
        source: GOOGLE_DIRECT_SOURCE,
        status: day.status,
        dataGaps: day.dataGaps as unknown,
        raw: day.raw as unknown,
        sourceHash,
      } as any);
      created++;
    }

    await s.createDataReconciliationLog([{
      dataType: "marketing_spend",
      entityKey: `GOOGLE ${start}..${end}`,
      action: superseded ? "SUPERSEDED" : "ADDED",
      field: "spend",
      oldValue: superseded ? `${superseded} active overlap(s)` : null,
      newValue: String(round2(days.reduce((sum, d) => sum + d.spend, 0))),
      reason: `Google Ads API direct feed wrote ${created} daily snapshot(s). Replaced ${superseded} overlapping active Google snapshot(s); manual uploads remain fallback only when this feed is stale.`,
      source: GOOGLE_DIRECT_SOURCE,
    }]).catch(() => {});

    await Promise.all([
      s.setAppSetting(GOOGLE_DIRECT_FAILURES_KEY, "0").catch(() => {}),
      s.setAppSetting(GOOGLE_DIRECT_STATUS_KEY, JSON.stringify({ status: "success", periodStart: start, periodEnd: end, created, superseded, gapped, updatedAt: now.toISOString() })).catch(() => {}),
    ]);
    return { status: "success", periodStart: start, periodEnd: end, created, superseded, gapped, days };
  } catch (error: any) {
    const previous = parseInt(String(await s.getAppSetting(GOOGLE_DIRECT_FAILURES_KEY).catch(() => "0") ?? "0"), 10) || 0;
    const failures = previous + 1;
    await s.setAppSetting(GOOGLE_DIRECT_FAILURES_KEY, String(failures)).catch(() => {});
    if (failures >= GOOGLE_DIRECT_FAILURE_THRESHOLD) {
      await s.setAppSetting(GOOGLE_DIRECT_PAUSED_KEY, "true").catch(() => {});
    }
    await s.setAppSetting(GOOGLE_DIRECT_STATUS_KEY, JSON.stringify({ status: "failed", periodStart: start, periodEnd: end, failures, error: error?.message ?? String(error), updatedAt: now.toISOString() })).catch(() => {});
    await s.createSystemLog({
      type: "INTEGRATION",
      entityType: "INTEGRATION",
      entityId: "google-direct-feed",
      severity: failures >= GOOGLE_DIRECT_FAILURE_THRESHOLD ? "ERROR" : "WARNING",
      code: failures >= GOOGLE_DIRECT_FAILURE_THRESHOLD ? "GOOGLE_DIRECT_FEED_PAUSED" : "GOOGLE_DIRECT_FEED_FAILED",
      message: failures >= GOOGLE_DIRECT_FAILURE_THRESHOLD
        ? `Google direct feed paused after ${failures} consecutive failure(s).`
        : `Google direct feed failed (${failures}/3).`,
      details: { periodStart: start, periodEnd: end, failures, error: error?.message ?? String(error) } as any,
    } as any).catch(() => {});
    return { status: "failed", reason: error?.message ?? String(error), periodStart: start, periodEnd: end, created: 0, superseded: 0, gapped: 0, days: [] };
  }
}
