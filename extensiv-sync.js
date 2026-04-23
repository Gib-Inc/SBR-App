#!/usr/bin/env node

/**
 * Extensiv → Railway Standalone Sync Script
 * 
 * This script runs independently of the main app server as a Railway cron job.
 * It authenticates with Extensiv's API, pulls stock data, and updates the
 * Railway PostgreSQL database directly.
 * 
 * Required environment variables:
 *   EXTENSIV_CLIENT_ID       - API Client ID from Extensiv Settings → API Credentials
 *   EXTENSIV_CLIENT_SECRET   - API Client Secret (only visible once when created)
 *   EXTENSIV_USER_LOGIN      - Extensiv login email (Zo's account)
 *   EXTENSIV_CUSTOMER_ID     - SBR's Customer ID in Extensiv
 *   DATABASE_URL             - Railway PostgreSQL connection string (auto-set by Railway)
 * 
 * Usage:
 *   node extensiv-sync.js           (run manually or via cron)
 *   npm run sync:extensiv           (via package.json script)
 * 
 * Recommended cron: 0 * * * *  (every hour at minute 0)
 * 
 * What it does:
 *   1. Gets an OAuth2 access token from Extensiv
 *   2. Fetches stock summary for all SKUs at the Pivot/Pyvott warehouse
 *   3. Matches each Extensiv SKU to an item in the Railway DB via extensiv_sku column
 *   4. Updates pivot_qty, extensiv_on_hand_snapshot, and extensiv_last_sync_at
 *   5. Logs everything to stdout (Railway captures this in deploy logs)
 */

const { Client } = require('pg');

// ─── Configuration ───

const CONFIG = {
  clientId: process.env.EXTENSIV_CLIENT_ID,
  clientSecret: process.env.EXTENSIV_CLIENT_SECRET,
  userLogin: process.env.EXTENSIV_USER_LOGIN,
  customerId: process.env.EXTENSIV_CUSTOMER_ID,
  databaseUrl: process.env.DATABASE_URL,
  // Extensiv 3PL Central API base URL
  baseUrl: process.env.EXTENSIV_BASE_URL || 'https://secure-wms.com',
  // Token endpoint for OAuth2 client credentials flow
  tokenUrl: process.env.EXTENSIV_TOKEN_URL || 'https://secure-wms.com/AuthServer/api/Token',
};

// ─── Validation ───

function validateConfig() {
  const missing = [];
  if (!CONFIG.clientId) missing.push('EXTENSIV_CLIENT_ID');
  if (!CONFIG.clientSecret) missing.push('EXTENSIV_CLIENT_SECRET');
  if (!CONFIG.userLogin) missing.push('EXTENSIV_USER_LOGIN');
  if (!CONFIG.databaseUrl) missing.push('DATABASE_URL');

  if (missing.length > 0) {
    console.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
    console.error('Set these in Railway → your service → Variables tab');
    process.exit(1);
  }
}

// ─── Extensiv API ───

async function getAccessToken() {
  // Extensiv uses OAuth2 client credentials grant
  // Docs: https://developer.extensiv.com/docs/authentication
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: CONFIG.clientId,
    client_secret: CONFIG.clientSecret,
    user_login_id: CONFIG.userLogin,
  });

  // If customer ID is provided, scope the token to that customer
  if (CONFIG.customerId) {
    body.append('tpl', CONFIG.customerId);
  }

  const response = await fetch(CONFIG.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Auth failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const expiresIn = data.expires_in ? Math.round(data.expires_in / 60) : '?';
  console.log(`✅ Token obtained (expires in ~${expiresIn} min)`);
  return data.access_token;
}

async function fetchStockSummary(accessToken) {
  // Fetch inventory/stock summary from Extensiv
  // This returns all items with their on-hand, allocated, and available quantities
  const url = `${CONFIG.baseUrl}/inventory/stocksummary`;
  const params = new URLSearchParams({
    pgsiz: '200', // Page size — adjust if you have more than 200 SKUs
    pgnum: '1',
    rql: CONFIG.customerId ? `ReadOnly.CustomerIdentifier.Id==${CONFIG.customerId}` : '',
  });

  const response = await fetch(`${url}?${params}`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Stock fetch failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();

  // Extensiv returns { ResourceList: [...] } or similar structure
  // Adjust based on actual API response format
  const items = data.ResourceList || data.Items || data || [];

  if (!Array.isArray(items)) {
    console.warn('⚠️  Unexpected API response format. Attempting to extract items...');
    return Object.values(data).find(v => Array.isArray(v)) || [];
  }

  return items;
}

function extractSkuAndQuantities(extensivItem) {
  // Map Extensiv response fields to our database fields
  // Field names may vary based on Extensiv API version — adjust if needed
  return {
    sku: extensivItem.ItemIdentifier?.Sku
      || extensivItem.Sku
      || extensivItem.sku
      || extensivItem.itemSku
      || null,
    description: extensivItem.ItemIdentifier?.Description
      || extensivItem.Description
      || extensivItem.description
      || null,
    onHand: extensivItem.OnHandQty
      ?? extensivItem.OnHand
      ?? extensivItem.onHand
      ?? extensivItem.Qty
      ?? 0,
    allocated: extensivItem.AllocatedQty
      ?? extensivItem.Allocated
      ?? extensivItem.allocated
      ?? 0,
    available: extensivItem.AvailableQty
      ?? extensivItem.Available
      ?? extensivItem.available
      ?? 0,
  };
}

// ─── Database ───

async function syncToDatabase(stockItems) {
  const db = new Client({ connectionString: CONFIG.databaseUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();

  const now = new Date().toISOString();
  let updated = 0;
  let notMatched = 0;
  const unmatchedSkus = [];

  for (const raw of stockItems) {
    const { sku, description, onHand, available } = extractSkuAndQuantities(raw);

    if (!sku) {
      console.warn('  ⚠️  Item with no SKU — skipped');
      continue;
    }

    // Match by extensiv_sku column in the items table
    const result = await db.query(
      `UPDATE items SET
        pivot_qty = $1,
        extensiv_on_hand_snapshot = $2,
        current_stock = CASE
          WHEN type = 'finished_product' THEN COALESCE($2, 0) + COALESCE(hildale_qty, 0)
          ELSE current_stock
        END,
        extensiv_last_sync_at = $3,
        forecast_dirty = true,
        updated_at = $3
      WHERE extensiv_sku = $4
      RETURNING sku, name`,
      [available, onHand, now, sku]
    );

    if (result.rowCount > 0) {
      const row = result.rows[0];
      console.log(`  ✅ Updated: ${row.sku} → OnHand: ${onHand}, Available: ${available}`);
      updated++;
    } else {
      // Try matching by house SKU as fallback
      const fallback = await db.query(
        `UPDATE items SET
          pivot_qty = $1,
          extensiv_on_hand_snapshot = $2,
          current_stock = CASE
            WHEN type = 'finished_product' THEN COALESCE($2, 0) + COALESCE(hildale_qty, 0)
            ELSE current_stock
          END,
          extensiv_last_sync_at = $3,
          forecast_dirty = true,
          updated_at = $3
        WHERE sku = $4
        RETURNING sku, name`,
        [available, onHand, now, sku]
      );

      if (fallback.rowCount > 0) {
        const row = fallback.rows[0];
        console.log(`  ✅ Updated (by house SKU): ${row.sku} → OnHand: ${onHand}, Available: ${available}`);
        updated++;
      } else {
        console.warn(`  ⚠️  SKU not matched in Railway DB: ${sku} (${description || 'no description'})`);
        unmatchedSkus.push(sku);
        notMatched++;
      }
    }
  }

  await db.end();
  return { updated, notMatched, unmatchedSkus };
}

// ─── Main ───

async function main() {
  const startTime = Date.now();
  console.log(`\n🔄 Extensiv sync started at ${new Date().toISOString()}`);
  console.log('─'.repeat(60));

  validateConfig();

  try {
    // Step 1: Authenticate
    const accessToken = await getAccessToken();

    // Step 2: Fetch stock data
    const stockItems = await fetchStockSummary(accessToken);
    console.log(`📦 Fetched ${stockItems.length} SKUs from Extensiv`);

    if (stockItems.length === 0) {
      console.log('No items returned from Extensiv. Check customer ID and permissions.');
      process.exit(0);
    }

    // Step 3: Update Railway database
    const { updated, notMatched, unmatchedSkus } = await syncToDatabase(stockItems);

    // Step 4: Summary
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('─'.repeat(60));
    console.log(`✅ Sync complete in ${elapsed}s — ${updated} updated, ${notMatched} not matched`);

    if (unmatchedSkus.length > 0) {
      console.log(`\n⚠️  Unmatched SKUs (exist in Extensiv but not in Railway DB):`);
      unmatchedSkus.forEach(s => console.log(`   - ${s}`));
      console.log('Tip: Add these SKUs to the app, or set the extensiv_sku column on existing items to match.');
    }
  } catch (error) {
    console.error(`\n❌ Sync failed:`, error.message || error);
    process.exit(1);
  }
}

main();
