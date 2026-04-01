/**
 * Claude client — extracted from monolith llm.ts.
 * Stripped to: send a system + user message, get text back. Nothing else.
 *
 * Env vars: ANTHROPIC_API_KEY
 */

import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-sonnet-4-5-20250929';

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required');
    client = new Anthropic({ apiKey });
  }
  return client;
}

export async function generateBriefing(
  systemPrompt: string,
  userMessage: string,
): Promise<string> {
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('');

  if (!text) throw new Error('Claude returned empty response');
  return text;
}

export async function scoreCopyPerformance(
  copyBody: string,
  metrics: { impressions: number; clicks: number; conversions: number; spend: number; revenue: number },
): Promise<{ score: number; insight: string }> {
  const prompt = `Score this ad copy on a 0-100 scale based on its performance metrics, and provide a one-sentence insight about what's working or not.

Copy: "${copyBody}"

Metrics:
- Impressions: ${metrics.impressions}
- Clicks: ${metrics.clicks}
- CTR: ${metrics.impressions > 0 ? ((metrics.clicks / metrics.impressions) * 100).toFixed(2) : 0}%
- Conversions: ${metrics.conversions}
- ROAS: ${metrics.spend > 0 ? (metrics.revenue / metrics.spend).toFixed(2) : 'N/A'}

Respond with JSON only: { "score": number, "insight": "string" }`;

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 256,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('');

  const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  return JSON.parse(cleaned);
}
