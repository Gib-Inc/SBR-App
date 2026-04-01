/**
 * Trap Runner — orchestrator
 *
 * Pulls all data in parallel, generates briefing, sends SMS, logs result.
 * This is the only file that calls multiple services.
 */

import { pullGoogleAds, type AdSnapshot } from './ad-performance';
import { pullMetaAds } from './ad-performance';
import { pullShopifyMTD, type ShopifySnapshot } from './shopify-orders';
import { produceBriefing } from './briefing';
import { GHLClient } from '../clients/ghl';
import { googleAdsClient } from '../clients/google-ads';
import { metaAdsClient } from '../clients/meta-ads';
import { createTrapRun } from '../db/queries';
import { loadConfig, type Lane2Config } from '../config';

export interface TrapResult {
  success: boolean;
  briefing: string | null;
  smsSent: boolean;
  smsError?: string;
  dataSources: {
    google: { ok: boolean; error?: string };
    meta: { ok: boolean; error?: string };
    shopify: { ok: boolean; error?: string };
  };
}

export async function runTrapCheck(options?: {
  sendSms?: boolean;
  config?: Lane2Config;
}): Promise<TrapResult> {
  const cfg = options?.config || loadConfig();
  const sendSms = options?.sendSms ?? true;
  const runDate = new Date().toISOString().split('T')[0];

  console.log(`[TrapRunner] Starting trap check for ${runDate}`);

  // Set tokens
  if (cfg.googleAds.accessToken) {
    googleAdsClient.setAccessToken(cfg.googleAds.accessToken);
    if (cfg.googleAds.refreshToken) googleAdsClient.setRefreshToken(cfg.googleAds.refreshToken);
  }
  if (cfg.metaAds.accessToken) {
    metaAdsClient.setAccessToken(cfg.metaAds.accessToken);
  }

  // MTD date range
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const yesterday = new Date(now.getTime() - 86400000);

  // Google Ads with token refresh retry
  async function pullGoogleWithRetry(): Promise<AdSnapshot> {
    if (!cfg.googleAds.customerId) throw new Error('Google Ads customer ID not configured');
    try {
      return await pullGoogleAds(cfg.googleAds.customerId, monthStart, yesterday);
    } catch (err: any) {
      if ((err.message?.includes('401') || err.message?.includes('token')) && cfg.googleAds.refreshToken) {
        console.log('[TrapRunner] Google Ads token expired, refreshing...');
        await googleAdsClient.refreshAccessToken();
        return await pullGoogleAds(cfg.googleAds.customerId, monthStart, yesterday);
      }
      throw err;
    }
  }

  // Pull all three in parallel
  const [googleResult, metaResult, shopifyResult] = await Promise.allSettled([
    pullGoogleWithRetry(),
    cfg.metaAds.accountId
      ? pullMetaAds(cfg.metaAds.accountId, monthStart, yesterday)
      : Promise.reject('Meta Ads account ID not configured'),
    pullShopifyMTD(cfg.shopify.domain, cfg.shopify.accessToken),
  ]);

  const google = googleResult.status === 'fulfilled' ? googleResult.value : null;
  const googleErr = googleResult.status === 'rejected' ? String(googleResult.reason) : undefined;
  const meta = metaResult.status === 'fulfilled' ? metaResult.value : null;
  const metaErr = metaResult.status === 'rejected' ? String(metaResult.reason) : undefined;
  const shopify = shopifyResult.status === 'fulfilled' ? shopifyResult.value : null;
  const shopifyErr = shopifyResult.status === 'rejected' ? String(shopifyResult.reason) : undefined;

  // Generate briefing
  let briefing: string | null = null;
  try {
    briefing = await produceBriefing(runDate, google, googleErr, meta, metaErr, shopify, shopifyErr);
  } catch (err: any) {
    briefing = `${runDate} TRAP CHECK\n\nBRIEFING GENERATION FAILED: ${err.message}\nRoute to Matt.`;
  }

  // Send SMS
  let smsSent = false;
  let smsError: string | undefined;
  if (sendSms && briefing && cfg.ghl.apiKey && cfg.ghl.locationId && cfg.ghl.zoContactId) {
    const ghl = new GHLClient(cfg.ghl.apiKey, cfg.ghl.locationId);
    const msg = briefing.length > 1500
      ? briefing.substring(0, 1450) + '\n\n[Truncated. Full version in app.]'
      : briefing;
    const result = await ghl.sendSMS(cfg.ghl.zoContactId, msg);
    smsSent = result.success;
    smsError = result.error;
  } else if (sendSms) {
    smsError = 'GHL not fully configured (need apiKey, locationId, zoContactId)';
  }

  // Log to DB
  try {
    await createTrapRun({
      runDate: new Date(runDate),
      googleAdsRaw: google || (googleErr ? { error: googleErr } : null),
      metaAdsRaw: meta || (metaErr ? { error: metaErr } : null),
      shopifyOrderCount: shopify?.orderCount ?? 0,
      shopifyGrossSales: shopify?.grossSales?.toFixed(2) ?? '0',
      shopifySourceBreakdown: shopify?.sourceBreakdown ?? null,
      shopifyRefundCount: shopify?.refundCount ?? 0,
      claudeBriefing: briefing,
      smsSent,
      smsSentAt: smsSent ? new Date() : null,
    });
  } catch (err: any) {
    console.error('[TrapRunner] Failed to log run:', err.message);
  }

  console.log(`[TrapRunner] Done. SMS: ${smsSent}`);

  return {
    success: true,
    briefing,
    smsSent,
    smsError,
    dataSources: {
      google: { ok: !!google, error: googleErr },
      meta: { ok: !!meta, error: metaErr },
      shopify: { ok: !!shopify, error: shopifyErr },
    },
  };
}
