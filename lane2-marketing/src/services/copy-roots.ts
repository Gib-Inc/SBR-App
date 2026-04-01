/**
 * Copy Roots Service
 *
 * Analyzes copy_performance data grouped by framework, schwartz level,
 * cialdini trigger, channel, and content type. Updates copy_roots with
 * computed averages and Claude-generated insights.
 */

import { db } from '../db/connection';
import { copyAssets, copyPerformance, copyRoots } from '../db/schema';
import { eq, desc, sql } from 'drizzle-orm';
import { generateBriefing } from '../clients/claude';

interface RootKey {
  framework: string | null;
  schwartzLevel: string | null;
  cialdiniTrigger: string | null;
  channel: string | null;
  contentType: string | null;
}

interface AggregatedMetrics {
  avgRoas: number;
  avgCtr: number;
  sampleSize: number;
  topHeadline: string | null;
  topHook: string | null;
}

/**
 * Rebuild all copy_roots from copy_performance + copy_assets data.
 * Call this after a batch of new performance data is recorded.
 */
export async function rebuildCopyRoots(): Promise<number> {
  // Pull all performance records joined with their copy asset
  const rows = await db
    .select({
      framework: copyAssets.framework,
      schwartzLevel: copyAssets.schwartzLevel,
      cialdiniTrigger: copyAssets.cialdiniTrigger,
      channel: copyPerformance.channel,
      contentType: copyAssets.contentType,
      roas: copyPerformance.roas,
      ctr: copyPerformance.ctr,
      headline: copyAssets.headline,
      body: copyAssets.body,
      performanceScore: copyPerformance.performanceScore,
    })
    .from(copyPerformance)
    .innerJoin(copyAssets, eq(copyPerformance.copyAssetId, copyAssets.id));

  if (rows.length === 0) return 0;

  // Group by root key
  const groups = new Map<string, { key: RootKey; rows: typeof rows }>();

  for (const row of rows) {
    const keyStr = `${row.framework}|${row.schwartzLevel}|${row.cialdiniTrigger}|${row.channel}|${row.contentType}`;
    if (!groups.has(keyStr)) {
      groups.set(keyStr, {
        key: {
          framework: row.framework,
          schwartzLevel: row.schwartzLevel,
          cialdiniTrigger: row.cialdiniTrigger,
          channel: row.channel,
          contentType: row.contentType,
        },
        rows: [],
      });
    }
    groups.get(keyStr)!.rows.push(row);
  }

  // Compute aggregates and upsert
  let updated = 0;

  for (const [, group] of groups) {
    if (group.rows.length < 2) continue; // Need at least 2 samples

    const avgRoas = group.rows.reduce((s, r) => s + (r.roas || 0), 0) / group.rows.length;
    const avgCtr = group.rows.reduce((s, r) => s + (r.ctr || 0), 0) / group.rows.length;

    // Find top performer
    const sorted = [...group.rows].sort((a, b) => (b.performanceScore || 0) - (a.performanceScore || 0));
    const top = sorted[0];

    await db.insert(copyRoots).values({
      framework: group.key.framework,
      schwartzLevel: group.key.schwartzLevel,
      cialdiniTrigger: group.key.cialdiniTrigger,
      channel: group.key.channel,
      contentType: group.key.contentType,
      avgRoas,
      avgCtr,
      sampleSize: group.rows.length,
      topPerformingHeadline: top?.headline || null,
      topPerformingHook: top?.body?.substring(0, 100) || null,
      updatedAt: new Date(),
    }).returning();

    updated++;
  }

  return updated;
}
