/**
 * Database queries — thin layer over Drizzle.
 * One function per operation. No classes.
 */

import { db } from './connection';
import { copyAssets, copyPerformance, copyRoots, morningTrapRuns } from './schema';
import { eq, desc } from 'drizzle-orm';

// ── Copy Assets ──

export async function createCopyAsset(data: typeof copyAssets.$inferInsert) {
  const result = await db.insert(copyAssets).values(data).returning();
  return result[0];
}

export async function getCopyAssetById(id: string) {
  const result = await db.select().from(copyAssets).where(eq(copyAssets.id, id)).limit(1);
  return result[0];
}

export async function listCopyAssets(limit = 50) {
  return db.select().from(copyAssets).orderBy(desc(copyAssets.createdAt)).limit(limit);
}

// ── Copy Performance ──

export async function createCopyPerformance(data: typeof copyPerformance.$inferInsert) {
  const result = await db.insert(copyPerformance).values(data).returning();
  return result[0];
}

export async function getPerformanceForAsset(copyAssetId: string) {
  return db.select().from(copyPerformance)
    .where(eq(copyPerformance.copyAssetId, copyAssetId))
    .orderBy(desc(copyPerformance.measuredAt));
}

// ── Copy Roots ──

export async function upsertCopyRoot(data: typeof copyRoots.$inferInsert) {
  const result = await db.insert(copyRoots).values(data).returning();
  return result[0];
}

export async function listCopyRoots() {
  return db.select().from(copyRoots).orderBy(desc(copyRoots.updatedAt));
}

// ── Morning Trap Runs ──

export async function createTrapRun(data: typeof morningTrapRuns.$inferInsert) {
  const result = await db.insert(morningTrapRuns).values(data).returning();
  return result[0];
}

export async function getLatestTrapRun() {
  const result = await db.select().from(morningTrapRuns)
    .orderBy(desc(morningTrapRuns.runDate))
    .limit(1);
  return result[0];
}

export async function getTrapRunHistory(limit = 30) {
  return db.select().from(morningTrapRuns)
    .orderBy(desc(morningTrapRuns.runDate))
    .limit(limit);
}
