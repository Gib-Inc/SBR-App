/**
 * Meta (Facebook) Ads Client
 * 
 * Handles OAuth 2.0 authentication and fetching ad insights for inventory forecasting.
 * 
 * V1 Scope:
 * - OAuth flow via Facebook Login
 * - List ad accounts
 * - Fetch campaign/adset insights with purchase metrics
 * - Aggregate by SKU for ad_metrics_daily
 */

import { storage as defaultStorage } from "../storage";
import { hashMarketingSnapshot } from "./reconciliation-service";

export interface MetaAdAccount {
  id: string;
  name: string;
  accountId: string; // Without 'act_' prefix
  currency: string;
  timezone: string;
}

export interface MetaInsightsResult {
  sku: string;
  date: string; // YYYY-MM-DD
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  revenue: number;
  currency: string;
}

interface MetaOAuthConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
}

interface MetaTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
}

interface MetaInsightsResponse {
  data: Array<{
    campaign_id?: string;
    campaign_name?: string;
    adset_id?: string;
    adset_name?: string;
    date_start: string;
    date_stop: string;
    impressions: string;
    clicks: string;
    spend: string;
    actions?: Array<{
      action_type: string;
      value: string;
    }>;
    action_values?: Array<{
      action_type: string;
      value: string;
    }>;
  }>;
  paging?: {
    cursors?: {
      after?: string;
    };
    next?: string;
  };
}

export interface MetaDirectInsightRow {
  ad_id?: string;
  ad_name?: string;
  date_start: string;
  date_stop: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  frequency?: string;
  cpm?: string;
  actions?: Array<{ action_type: string; value: string }>;
  cost_per_action_type?: Array<{ action_type: string; value: string }>;
  purchase_roas?: Array<{ action_type?: string; value: string }>;
}

export interface MetaDirectDailySnapshot {
  date: string;
  spend: number;
  impressions: number | null;
  conversions: number | null;
  revenue: number | null;
  status: "OK" | "DATA_GAPPED";
  dataGaps: string[];
  raw: {
    source: "meta-direct-api";
    rowCount: number;
    revenueBasis: "derived_from_purchase_roas" | null;
    reach: number | null;
    cpm: number | null;
    frequency: number | null;
    purchaseRoas: number | null;
    actions: Record<string, number>;
    costPerActionType: Record<string, number>;
  };
}

export interface MetaDirectSyncResult {
  status: "success" | "skipped" | "failed";
  reason?: string;
  periodStart?: string;
  periodEnd?: string;
  created: number;
  superseded: number;
  gapped: number;
  days: MetaDirectDailySnapshot[];
}

type MetaDirectStorage = Pick<typeof defaultStorage,
  "getAppSetting" |
  "setAppSetting" |
  "getActiveMarketingSpendSnapshots" |
  "getMarketingSpendSnapshotsInRange" |
  "markMarketingSpendSnapshotsSuperseded" |
  "createMarketingSpendSnapshot" |
  "createDataReconciliationLog" |
  "createSystemLog"
>;

const META_DIRECT_SOURCE = "meta-direct-api";
const META_DIRECT_FAILURES_KEY = "meta_direct_consecutive_failures";
const META_DIRECT_PAUSED_KEY = "meta_direct_paused";
const META_DIRECT_STATUS_KEY = "meta_direct_latest_status";
const META_DIRECT_FAILURE_THRESHOLD = 3;
const DIRECT_FIELDS = [
  "ad_id",
  "ad_name",
  "spend",
  "impressions",
  "reach",
  "frequency",
  "cpm",
  "actions",
  "cost_per_action_type",
  "purchase_roas",
].join(",");

const PURCHASE_ACTIONS = new Set([
  "purchase",
  "omni_purchase",
  "offsite_conversion.fb_pixel_purchase",
]);

function isoDateUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDateUTC(d);
}

function trailingMetaWindow(now = new Date()): { start: string; end: string } {
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

function sumActionValues(rows: MetaDirectInsightRow[], field: "actions" | "cost_per_action_type"): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    for (const a of row[field] ?? []) {
      const value = num(a.value);
      if (value == null) continue;
      out[a.action_type] = round2((out[a.action_type] ?? 0) + value);
    }
  }
  return out;
}

function purchaseCount(rows: MetaDirectInsightRow[]): number | null {
  let total = 0;
  let seen = false;
  for (const row of rows) {
    for (const a of row.actions ?? []) {
      if (!PURCHASE_ACTIONS.has(a.action_type)) continue;
      const value = num(a.value);
      if (value == null) continue;
      total += value;
      seen = true;
    }
  }
  return seen ? round2(total) : null;
}

function purchaseRoas(rows: MetaDirectInsightRow[]): number | null {
  const values: number[] = [];
  for (const row of rows) {
    const v = (row.purchase_roas ?? []).map((r) => num(r.value)).find((x) => x != null);
    if (v != null) values.push(v);
  }
  if (!values.length) return null;
  return round2(values.reduce((s, v) => s + v, 0) / values.length);
}

export function aggregateMetaDirectRows(
  rows: MetaDirectInsightRow[],
  start: string,
  end: string,
): MetaDirectDailySnapshot[] {
  const byDate = new Map<string, MetaDirectInsightRow[]>();
  for (const row of rows) {
    const day = row.date_start;
    if (!day || day < start || day > end) continue;
    if (!byDate.has(day)) byDate.set(day, []);
    byDate.get(day)!.push(row);
  }

  const days: MetaDirectDailySnapshot[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) {
    const dayRows = byDate.get(day) ?? [];
    const dataGaps: string[] = [];
    if (!dayRows.length) dataGaps.push("Meta API returned no ad rows for this date; not treated as a real zero.");
    const spendValues = dayRows.map((r) => num(r.spend));
    const impressionValues = dayRows.map((r) => num(r.impressions));
    if (dayRows.length && spendValues.some((v) => v == null)) dataGaps.push("One or more Meta rows were missing spend.");
    if (dayRows.length && impressionValues.some((v) => v == null)) dataGaps.push("One or more Meta rows were missing impressions.");

    const spend = round2(spendValues.reduce<number>((s, v) => s + (v ?? 0), 0));
    const impressionsSeen = impressionValues.some((v) => v != null);
    const impressions = impressionsSeen ? Math.round(impressionValues.reduce<number>((s, v) => s + (v ?? 0), 0)) : null;
    const reachValues = dayRows.map((r) => num(r.reach)).filter((v): v is number => v != null);
    const cpmValues = dayRows.map((r) => num(r.cpm)).filter((v): v is number => v != null);
    const freqValues = dayRows.map((r) => num(r.frequency)).filter((v): v is number => v != null);
    const roas = purchaseRoas(dayRows);
    const conversions = purchaseCount(dayRows);

    days.push({
      date: day,
      spend,
      impressions,
      conversions,
      revenue: roas != null ? round2(spend * roas) : null,
      status: dataGaps.length ? "DATA_GAPPED" : "OK",
      dataGaps,
      raw: {
        source: META_DIRECT_SOURCE,
        rowCount: dayRows.length,
        revenueBasis: roas != null ? "derived_from_purchase_roas" : null,
        reach: reachValues.length ? Math.round(reachValues.reduce((s, v) => s + v, 0)) : null,
        cpm: cpmValues.length ? round2(cpmValues.reduce((s, v) => s + v, 0) / cpmValues.length) : null,
        frequency: freqValues.length ? round2(freqValues.reduce((s, v) => s + v, 0) / freqValues.length) : null,
        purchaseRoas: roas,
        actions: sumActionValues(dayRows, "actions"),
        costPerActionType: sumActionValues(dayRows, "cost_per_action_type"),
      },
    });
  }
  return days;
}

export class MetaAdsClient {
  private config: MetaOAuthConfig | null = null;
  private accessToken: string | null = null;
  private baseUrl = 'https://graph.facebook.com/v18.0';

  constructor() {
    this.loadConfig();
  }

  private loadConfig() {
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    const redirectUri = process.env.META_REDIRECT_URI || `${process.env.APP_BASE_URL || 'http://localhost:5000'}/api/ads/meta/callback`;

    if (appId && appSecret) {
      this.config = { appId, appSecret, redirectUri };
    }
  }

  isConfigured(): boolean {
    return this.config !== null;
  }

  setAccessToken(token: string) {
    this.accessToken = token;
  }

  /**
   * Generate OAuth authorization URL
   */
  getAuthUrl(state: string): string {
    if (!this.config) {
      throw new Error('Meta Ads not configured - missing META_APP_ID or META_APP_SECRET');
    }

    const scopes = ['ads_read', 'business_management'];
    const params = new URLSearchParams({
      client_id: this.config.appId,
      redirect_uri: this.config.redirectUri,
      scope: scopes.join(','),
      response_type: 'code',
      state,
    });

    return `https://www.facebook.com/v18.0/dialog/oauth?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCodeForToken(code: string): Promise<MetaTokenResponse> {
    if (!this.config) {
      throw new Error('Meta Ads not configured');
    }

    const params = new URLSearchParams({
      client_id: this.config.appId,
      client_secret: this.config.appSecret,
      redirect_uri: this.config.redirectUri,
      code,
    });

    const response = await fetch(`${this.baseUrl}/oauth/access_token?${params.toString()}`);
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to exchange code for token: ${error}`);
    }

    return response.json();
  }

  /**
   * Get long-lived access token (60 days validity)
   */
  async getLongLivedToken(shortLivedToken: string): Promise<MetaTokenResponse> {
    if (!this.config) {
      throw new Error('Meta Ads not configured');
    }

    const params = new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: this.config.appId,
      client_secret: this.config.appSecret,
      fb_exchange_token: shortLivedToken,
    });

    const response = await fetch(`${this.baseUrl}/oauth/access_token?${params.toString()}`);
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get long-lived token: ${error}`);
    }

    return response.json();
  }

  /**
   * List all ad accounts accessible to the user
   */
  async listAdAccounts(): Promise<MetaAdAccount[]> {
    if (!this.accessToken) {
      throw new Error('Access token not set');
    }

    const response = await fetch(
      `${this.baseUrl}/me/adaccounts?fields=id,name,account_id,currency,timezone_name&access_token=${this.accessToken}`
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to list ad accounts: ${error}`);
    }

    const data = await response.json();
    
    return (data.data || []).map((account: any) => ({
      id: account.id,
      name: account.name,
      accountId: account.account_id,
      currency: account.currency,
      timezone: account.timezone_name,
    }));
  }

  /**
   * Fetch insights for an ad account
   * Returns daily metrics aggregated by campaign
   */
  async fetchAccountInsights(
    adAccountId: string,
    startDate: Date,
    endDate: Date,
    skuMappings: Map<string, string> // adEntityId -> sku
  ): Promise<MetaInsightsResult[]> {
    if (!this.accessToken) {
      throw new Error('Access token not set');
    }

    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];

    const fields = [
      'campaign_id',
      'campaign_name',
      'impressions',
      'clicks',
      'spend',
      'actions',
      'action_values',
    ].join(',');

    const params = new URLSearchParams({
      access_token: this.accessToken,
      fields,
      time_range: JSON.stringify({ since: startStr, until: endStr }),
      time_increment: '1', // Daily breakdown
      level: 'campaign',
    });

    const results: MetaInsightsResult[] = [];
    let url = `${this.baseUrl}/${adAccountId}/insights?${params.toString()}`;
    
    while (url) {
      const response = await fetch(url);
      
      if (!response.ok) {
        const error = await response.text();
        console.error(`[MetaAdsClient] Insights fetch error: ${error}`);
        break;
      }

      const data: MetaInsightsResponse = await response.json();
      
      for (const row of data.data || []) {
        const campaignId = row.campaign_id;
        if (!campaignId) continue;

        // Look up SKU mapping
        const sku = skuMappings.get(campaignId);
        if (!sku) continue; // Skip campaigns without SKU mapping

        // Extract purchase conversions and revenue
        let conversions = 0;
        let revenue = 0;
        
        if (row.actions) {
          const purchaseAction = row.actions.find(a => a.action_type === 'purchase');
          if (purchaseAction) {
            conversions = parseInt(purchaseAction.value, 10) || 0;
          }
        }
        
        if (row.action_values) {
          const purchaseValue = row.action_values.find(a => a.action_type === 'purchase');
          if (purchaseValue) {
            revenue = parseFloat(purchaseValue.value) || 0;
          }
        }

        results.push({
          sku,
          date: row.date_start,
          impressions: parseInt(row.impressions, 10) || 0,
          clicks: parseInt(row.clicks, 10) || 0,
          spend: parseFloat(row.spend) || 0,
          conversions,
          revenue,
          currency: 'USD', // Will be set from account config
        });
      }

      // Handle pagination
      url = data.paging?.next || '';
    }

    return results;
  }

  /**
   * Test connection by fetching user info
   */
  async testConnection(): Promise<{ success: boolean; userId?: string; name?: string; error?: string }> {
    if (!this.accessToken) {
      return { success: false, error: 'Access token not set' };
    }

    try {
      const response = await fetch(
        `${this.baseUrl}/me?fields=id,name&access_token=${this.accessToken}`
      );

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error };
      }

      const data = await response.json();
      return { success: true, userId: data.id, name: data.name };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  isDirectFeedConfigured(): boolean {
    return Boolean(process.env.META_ACCESS_TOKEN && process.env.META_AD_ACCOUNT_ID);
  }

  private directAccountId(): string {
    const raw = String(process.env.META_AD_ACCOUNT_ID || "").trim();
    if (!raw) throw new Error("META_AD_ACCOUNT_ID is not set");
    return raw.startsWith("act_") ? raw : `act_${raw}`;
  }

  private directToken(): string {
    const token = String(process.env.META_ACCESS_TOKEN || "").trim();
    if (!token) throw new Error("META_ACCESS_TOKEN is not set");
    return token;
  }

  async fetchDirectDailyInsights(start: string, end: string): Promise<MetaDirectInsightRow[]> {
    const params = new URLSearchParams({
      access_token: this.directToken(),
      level: "ad",
      time_increment: "1",
      fields: DIRECT_FIELDS,
      time_range: JSON.stringify({ since: start, until: end }),
      limit: "500",
    });

    const rows: MetaDirectInsightRow[] = [];
    let url = `${this.baseUrl}/${this.directAccountId()}/insights?${params.toString()}`;
    while (url) {
      const response = await fetch(url);
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Meta direct insights failed (${response.status}): ${error.slice(0, 500)}`);
      }
      const data = await response.json() as { data?: MetaDirectInsightRow[]; paging?: { next?: string } };
      rows.push(...(data.data ?? []));
      url = data.paging?.next ?? "";
    }
    return rows;
  }
}

export const metaAdsClient = new MetaAdsClient();

export async function getMetaDirectFeedConfidence(
  deps: { storage?: Pick<MetaDirectStorage, "getActiveMarketingSpendSnapshots" | "getAppSetting">; now?: Date } = {},
): Promise<{
  feed: "meta-direct";
  confidence: "actual" | "fallback" | "awaiting_credentials" | "paused" | "stale";
  latestPeriodEnd: string | null;
  daysOld: number | null;
  source: string | null;
  reason: string;
}> {
  const s = deps.storage ?? defaultStorage as any;
  if (!process.env.META_ACCESS_TOKEN || !process.env.META_AD_ACCOUNT_ID) {
    return { feed: "meta-direct", confidence: "awaiting_credentials", latestPeriodEnd: null, daysOld: null, source: null, reason: "META_ACCESS_TOKEN or META_AD_ACCOUNT_ID is not configured." };
  }
  const paused = await s.getAppSetting(META_DIRECT_PAUSED_KEY).catch(() => null);
  if (paused === "true") {
    return { feed: "meta-direct", confidence: "paused", latestPeriodEnd: null, daysOld: null, source: META_DIRECT_SOURCE, reason: "Meta direct feed paused after consecutive API failures." };
  }
  const snaps = ((await s.getActiveMarketingSpendSnapshots().catch(() => [])) as any[])
    .filter((x) => String(x.platform || "").toUpperCase() === "META" && String(x.source || "") === META_DIRECT_SOURCE && x.periodEnd);
  const latest = snaps.sort((a, b) => String(b.periodEnd).localeCompare(String(a.periodEnd)))[0];
  if (!latest) {
    return { feed: "meta-direct", confidence: "fallback", latestPeriodEnd: null, daysOld: null, source: null, reason: "No active Meta direct snapshot yet; manual Meta tracker remains canonical if present." };
  }
  const today = isoDateUTC(deps.now ?? new Date());
  const daysOld = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${latest.periodEnd}T00:00:00Z`)) / 86400000);
  if (daysOld <= 2) {
    return { feed: "meta-direct", confidence: "actual", latestPeriodEnd: latest.periodEnd, daysOld, source: META_DIRECT_SOURCE, reason: "Meta direct feed is fresh; overlapping manual Meta snapshots are superseded." };
  }
  return { feed: "meta-direct", confidence: "stale", latestPeriodEnd: latest.periodEnd, daysOld, source: META_DIRECT_SOURCE, reason: "Meta direct feed is stale >2 days; manual Meta tracker is the fallback until the API recovers." };
}

export async function isFreshMetaDirectProtectedForPeriod(
  periodStart: string | null | undefined,
  periodEnd: string | null | undefined,
  deps: { storage?: Pick<MetaDirectStorage, "getActiveMarketingSpendSnapshots">; now?: Date } = {},
): Promise<{ protected: boolean; overlappingDirectIds: string[]; latestPeriodEnd: string | null; reason: string }> {
  if (!periodStart || !periodEnd) {
    return { protected: false, overlappingDirectIds: [], latestPeriodEnd: null, reason: "No period supplied." };
  }
  const s = deps.storage ?? defaultStorage as any;
  const active = ((await s.getActiveMarketingSpendSnapshots().catch(() => [])) as any[])
    .filter((x) => String(x.platform || "").toUpperCase() === "META" && String(x.source || "") === META_DIRECT_SOURCE && x.periodStart && x.periodEnd);
  const latest = active.sort((a, b) => String(b.periodEnd).localeCompare(String(a.periodEnd)))[0];
  if (!latest) {
    return { protected: false, overlappingDirectIds: [], latestPeriodEnd: null, reason: "No active Meta direct snapshots exist; manual may be canonical." };
  }
  const today = isoDateUTC(deps.now ?? new Date());
  const daysOld = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${latest.periodEnd}T00:00:00Z`)) / 86400000);
  const overlapping = active.filter((x) => x.periodStart <= periodEnd && x.periodEnd >= periodStart);
  if (!overlapping.length) {
    return { protected: false, overlappingDirectIds: [], latestPeriodEnd: latest.periodEnd, reason: "No direct Meta row overlaps this manual period." };
  }
  if (daysOld <= 2) {
    return {
      protected: true,
      overlappingDirectIds: overlapping.map((x) => x.id),
      latestPeriodEnd: latest.periodEnd,
      reason: "Fresh Meta direct API data overlaps this period, so manual upload is ignored to prevent double-counting.",
    };
  }
  return {
    protected: false,
    overlappingDirectIds: overlapping.map((x) => x.id),
    latestPeriodEnd: latest.periodEnd,
    reason: "Meta direct API data is stale >2 days; manual upload may replace it as fallback.",
  };
}

export async function syncMetaDirectSpend(
  deps: {
    storage?: MetaDirectStorage;
    client?: Pick<MetaAdsClient, "isDirectFeedConfigured" | "fetchDirectDailyInsights">;
    now?: Date;
  } = {},
): Promise<MetaDirectSyncResult> {
  const s = deps.storage ?? defaultStorage;
  const client = deps.client ?? metaAdsClient;
  const now = deps.now ?? new Date();
  const { start, end } = trailingMetaWindow(now);

  if (!client.isDirectFeedConfigured()) {
    const result: MetaDirectSyncResult = { status: "skipped", reason: "awaiting_credentials", periodStart: start, periodEnd: end, created: 0, superseded: 0, gapped: 0, days: [] };
    await s.setAppSetting(META_DIRECT_STATUS_KEY, JSON.stringify({ ...result, updatedAt: now.toISOString() })).catch(() => {});
    return result;
  }

  const paused = await s.getAppSetting(META_DIRECT_PAUSED_KEY).catch(() => null);
  if (paused === "true") {
    const result: MetaDirectSyncResult = { status: "skipped", reason: "paused_after_3_failures", periodStart: start, periodEnd: end, created: 0, superseded: 0, gapped: 0, days: [] };
    await s.setAppSetting(META_DIRECT_STATUS_KEY, JSON.stringify({ ...result, updatedAt: now.toISOString() })).catch(() => {});
    return result;
  }

  try {
    const rows = await client.fetchDirectDailyInsights(start, end);
    const days = aggregateMetaDirectRows(rows, start, end);
    let created = 0;
    let superseded = 0;
    let gapped = 0;

    for (const day of days) {
      if (day.status === "DATA_GAPPED") gapped++;
      const active = await s.getMarketingSpendSnapshotsInRange(day.date, day.date);
      const overlapping = (active as any[]).filter((snap) => String(snap.platform || "").toUpperCase() === "META");
      if (day.status === "DATA_GAPPED" && overlapping.some((snap: any) => String(snap.source || "") !== META_DIRECT_SOURCE)) {
        continue;
      }
      if (overlapping.length) {
        await s.markMarketingSpendSnapshotsSuperseded(overlapping.map((snap: any) => snap.id), META_DIRECT_SOURCE);
        superseded += overlapping.length;
      }

      const sourceHash = hashMarketingSnapshot({
        platform: "META",
        periodStart: day.date,
        periodEnd: day.date,
        spend: day.spend,
        impressions: day.impressions,
        clicks: null,
      });

      await s.createMarketingSpendSnapshot({
        platform: "META",
        periodStart: day.date,
        periodEnd: day.date,
        spend: day.spend,
        impressions: day.impressions,
        clicks: null,
        conversions: day.conversions,
        revenue: day.revenue,
        currency: "USD",
        source: META_DIRECT_SOURCE,
        status: day.status,
        dataGaps: day.dataGaps as unknown,
        raw: day.raw as unknown,
        sourceHash,
      } as any);
      created++;
    }

    await s.createDataReconciliationLog([{
      dataType: "marketing_spend",
      entityKey: `META ${start}..${end}`,
      action: superseded ? "SUPERSEDED" : "ADDED",
      field: "spend",
      oldValue: superseded ? `${superseded} active overlap(s)` : null,
      newValue: String(round2(days.reduce((sum, d) => sum + d.spend, 0))),
      reason: `Meta Marketing API direct feed wrote ${created} daily snapshot(s). Replaced ${superseded} overlapping active Meta snapshot(s); manual uploads remain fallback only when this feed is stale.`,
      source: META_DIRECT_SOURCE,
    }]).catch(() => {});

    await Promise.all([
      s.setAppSetting(META_DIRECT_FAILURES_KEY, "0").catch(() => {}),
      s.setAppSetting(META_DIRECT_STATUS_KEY, JSON.stringify({ status: "success", periodStart: start, periodEnd: end, created, superseded, gapped, updatedAt: now.toISOString() })).catch(() => {}),
    ]);
    return { status: "success", periodStart: start, periodEnd: end, created, superseded, gapped, days };
  } catch (error: any) {
    const previous = parseInt(String(await s.getAppSetting(META_DIRECT_FAILURES_KEY).catch(() => "0") ?? "0"), 10) || 0;
    const failures = previous + 1;
    await s.setAppSetting(META_DIRECT_FAILURES_KEY, String(failures)).catch(() => {});
    if (failures >= META_DIRECT_FAILURE_THRESHOLD) {
      await s.setAppSetting(META_DIRECT_PAUSED_KEY, "true").catch(() => {});
    }
    await s.setAppSetting(META_DIRECT_STATUS_KEY, JSON.stringify({ status: "failed", periodStart: start, periodEnd: end, failures, error: error?.message ?? String(error), updatedAt: now.toISOString() })).catch(() => {});
    await s.createSystemLog({
      type: "INTEGRATION",
      entityType: "INTEGRATION",
      entityId: "meta-direct-feed",
      severity: failures >= META_DIRECT_FAILURE_THRESHOLD ? "ERROR" : "WARNING",
      code: failures >= META_DIRECT_FAILURE_THRESHOLD ? "META_DIRECT_FEED_PAUSED" : "META_DIRECT_FEED_FAILED",
      message: failures >= META_DIRECT_FAILURE_THRESHOLD
        ? `Meta direct feed paused after ${failures} consecutive failure(s).`
        : `Meta direct feed failed (${failures}/3).`,
      details: { periodStart: start, periodEnd: end, failures, error: error?.message ?? String(error) } as any,
    } as any).catch(() => {});
    return { status: "failed", reason: error?.message ?? String(error), periodStart: start, periodEnd: end, created: 0, superseded: 0, gapped: 0, days: [] };
  }
}
