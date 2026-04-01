/**
 * Configuration loader
 *
 * All credentials come from environment variables.
 * Same pattern as the monolith — env vars, no config files.
 */

export interface Lane2Config {
  googleAds: {
    accessToken: string | null;
    refreshToken: string | null;
    customerId: string | null;
  };
  metaAds: {
    accessToken: string | null;
    accountId: string | null;
  };
  shopify: {
    domain: string;
    accessToken: string;
  };
  ghl: {
    apiKey: string | null;
    locationId: string | null;
    zoContactId: string | null;
  };
}

export function loadConfig(): Lane2Config {
  const shopifyDomain = process.env.SHOPIFY_SHOP_DOMAIN;
  const shopifyToken = process.env.SHOPIFY_ACCESS_TOKEN;

  if (!shopifyDomain || !shopifyToken) {
    throw new Error('SHOPIFY_SHOP_DOMAIN and SHOPIFY_ACCESS_TOKEN are required');
  }

  return {
    googleAds: {
      accessToken: process.env.GOOGLE_ADS_ACCESS_TOKEN || null,
      refreshToken: process.env.GOOGLE_ADS_REFRESH_TOKEN || null,
      customerId: process.env.GOOGLE_ADS_CUSTOMER_ID || null,
    },
    metaAds: {
      accessToken: process.env.META_ADS_ACCESS_TOKEN || null,
      accountId: process.env.META_ADS_ACCOUNT_ID || null,
    },
    shopify: {
      domain: shopifyDomain,
      accessToken: shopifyToken,
    },
    ghl: {
      apiKey: process.env.GHL_API_KEY || null,
      locationId: process.env.GHL_LOCATION_ID || null,
      zoContactId: process.env.GHL_ZO_CONTACT_ID || null,
    },
  };
}

export function validateConfig(cfg: Lane2Config): string[] {
  const missing: string[] = [];

  if (!cfg.shopify.domain) missing.push('SHOPIFY_SHOP_DOMAIN');
  if (!cfg.shopify.accessToken) missing.push('SHOPIFY_ACCESS_TOKEN');
  if (!cfg.googleAds.customerId) missing.push('GOOGLE_ADS_CUSTOMER_ID (optional but needed for Google data)');
  if (!cfg.metaAds.accountId) missing.push('META_ADS_ACCOUNT_ID (optional but needed for Meta data)');
  if (!cfg.ghl.apiKey) missing.push('GHL_API_KEY (optional but needed for SMS)');
  if (!cfg.ghl.zoContactId) missing.push('GHL_ZO_CONTACT_ID (optional but needed for SMS)');
  if (!process.env.ANTHROPIC_API_KEY) missing.push('ANTHROPIC_API_KEY');
  if (!process.env.DATABASE_URL) missing.push('DATABASE_URL');

  return missing;
}
