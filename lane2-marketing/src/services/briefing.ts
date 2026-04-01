/**
 * Briefing Service
 *
 * Builds the data payload, sends to Claude, returns text.
 * Owns the system prompt. One job: produce the morning briefing.
 */

import { generateBriefing } from '../clients/claude';
import type { AdSnapshot } from './ad-performance';
import type { ShopifySnapshot } from './shopify-orders';

const SYSTEM_PROMPT = `You are the Morning Trap Runner for Sticker Burr Roller (SBR), Hildale, Utah. You produce Zo's daily KPI briefing sent at 7 AM MST via SMS.

VOICE RULES (non-negotiable):
- Contractions always. Didn't, won't, it's. Never formal.
- No em dashes. Period or comma only.
- Short sentences. One idea per sentence.
- Max one exclamation mark total.
- Plain-spoken. Knowledgeable neighbor tone. Never hype.
- BANNED: game-changer, revolutionary, unlock, leverage, seamless, incredible, amazing, powerful, supercharge

BRIEFING FORMAT (SMS-optimized, under 400 words):

[DATE] TRAP CHECK

GOOGLE ADS MTD
Spend: $X | Sales: $X | ROAS: X:1
Top campaign: [name] at [ROAS]
Bottom campaign: [name] at [ROAS]

META ADS MTD
Spend: $X | Sales: $X | ROAS: X:1

SHOPIFY MTD
Gross sales: $X | Orders: X
Return rate: X%

COMBINED
Total ad spend: $X | Total revenue: $X
Blended ROAS: X:1

FLAGS (if any):
[One line per issue. Be specific.]

OPPORTUNITY (if any):
[One actionable insight.]

Go win your ground war.

CRITICAL BENCHMARKS (flag deviations):
- Shopify checkout conversion: BASELINE 27-30%. Flag below 20%. ALERT below 16%.
- Google ROAS mature campaigns: BASELINE 30:1. Flag below 15:1.
- Combined monthly ad spend: BASELINE under $7K. Flag above $10K.
- Return rate: Flag if above prior month average.

ESCALATION ROUTING:
- Checkout conversion drop -> Christopher + Kevin
- ROAS collapse -> Kevin + Zo
- Ad spend spike -> Christopher
- Return rate spike -> Sammie
- Attribution anomaly worsening -> Matt

Never fail silently. If data is missing, say what and who fixes it.`;

export async function produceBriefing(
  runDate: string,
  google: AdSnapshot | null,
  googleError: string | undefined,
  meta: AdSnapshot | null,
  metaError: string | undefined,
  shopify: ShopifySnapshot | null,
  shopifyError: string | undefined,
): Promise<string> {
  let payload = `MORNING TRAP CHECK DATA — ${runDate}\n\n`;

  // Google Ads
  payload += '=== GOOGLE ADS MTD ===\n';
  if (google) {
    payload += `Spend: $${google.totalSpend.toFixed(2)} | Sales: $${google.totalRevenue.toFixed(2)} | ROAS: ${google.roas.toFixed(1)}:1\n`;
    payload += `Conversions: ${google.totalConversions}\n`;
    for (const c of google.campaigns) {
      payload += `  ${c.name}: $${c.spend.toFixed(2)} spend, $${c.revenue.toFixed(2)} sales, ${c.roas.toFixed(1)}:1\n`;
    }
  } else {
    payload += `ERROR: ${googleError || 'No data'}\n`;
  }

  // Meta Ads
  payload += '\n=== META ADS MTD ===\n';
  if (meta) {
    payload += `Spend: $${meta.totalSpend.toFixed(2)} | Sales: $${meta.totalRevenue.toFixed(2)} | ROAS: ${meta.roas.toFixed(1)}:1\n`;
    for (const c of meta.campaigns) {
      payload += `  ${c.name}: $${c.spend.toFixed(2)} spend, $${c.revenue.toFixed(2)} sales, ${c.roas.toFixed(1)}:1\n`;
    }
  } else {
    payload += `ERROR: ${metaError || 'No data'}\n`;
  }

  // Shopify
  payload += '\n=== SHOPIFY MTD ===\n';
  if (shopify) {
    payload += `Orders: ${shopify.orderCount} | Gross sales: $${shopify.grossSales.toFixed(2)}\n`;
    payload += `Refunds: ${shopify.refundCount} | Cancelled: ${shopify.cancelledCount}\n`;
    payload += 'Source breakdown:\n';
    for (const [src, data] of Object.entries(shopify.sourceBreakdown)) {
      payload += `  ${src}: ${data.orders} orders, $${data.revenue.toFixed(2)}\n`;
    }
  } else {
    payload += `ERROR: ${shopifyError || 'No data'}\n`;
  }

  return generateBriefing(SYSTEM_PROMPT, `Produce today's briefing.\n\n${payload}`);
}
