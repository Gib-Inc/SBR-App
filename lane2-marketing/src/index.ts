/**
 * lane2-marketing entry point
 *
 * Three jobs:
 * 1. Pull Meta and Google Ads performance data
 * 2. Pull Shopify order data
 * 3. Send a Claude-generated briefing via GHL SMS
 *
 * Run directly: npx tsx lane2-marketing/src/index.ts
 * Or import { runTrapCheck } from 'lane2-marketing' in another service.
 */

import { runTrapCheck } from './services/trap-runner';
import { loadConfig, validateConfig } from './config';

// Re-export for programmatic use
export { runTrapCheck } from './services/trap-runner';
export { pullGoogleAds, pullMetaAds, recordPerformanceForCopy } from './services/ad-performance';
export { pullShopifyMTD } from './services/shopify-orders';
export { produceBriefing } from './services/briefing';
export { createCopyAsset, listCopyAssets, createCopyPerformance, getPerformanceForAsset, upsertCopyRoot, listCopyRoots } from './db/queries';
export { loadConfig, validateConfig } from './config';

// Direct execution
async function main() {
  console.log('[lane2-marketing] Starting...\n');

  // Validate
  const cfg = loadConfig();
  const missing = validateConfig(cfg);
  if (missing.length > 0) {
    console.log('Missing env vars (some optional):');
    for (const m of missing) console.log(`  - ${m}`);
    console.log('');
  }

  // Run
  const sendSms = process.argv.includes('--sms');
  const result = await runTrapCheck({ sendSms, config: cfg });

  // Output
  console.log('\n--- RESULT ---');
  console.log(`Success: ${result.success}`);
  console.log(`SMS sent: ${result.smsSent}${result.smsError ? ` (${result.smsError})` : ''}`);
  console.log(`\nData sources:`);
  for (const [name, src] of Object.entries(result.dataSources)) {
    console.log(`  ${name}: ${src.ok ? 'OK' : `FAILED — ${src.error}`}`);
  }

  if (result.briefing) {
    console.log('\n--- BRIEFING ---');
    console.log(result.briefing);
  }
}

// Run if executed directly
const isDirectRun = process.argv[1]?.includes('lane2-marketing');
if (isDirectRun) {
  main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
