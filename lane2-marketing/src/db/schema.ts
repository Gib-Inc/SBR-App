/**
 * lane2-marketing schema
 *
 * Four tables. Three new (copy intelligence layer), one carried from monolith (trap runs).
 * Same Drizzle ORM patterns as the parent codebase.
 */

import { pgTable, varchar, text, integer, numeric, boolean, timestamp, jsonb, index, real } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ── copy_assets — every piece of copy before it goes live ──

export const copyAssets = pgTable('copy_assets', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp('created_at').notNull().default(sql`now()`),
  contentType: text('content_type').notNull(),       // VIDEO_SCRIPT, AD_COPY, EMAIL, SMS, CAPTION
  channel: text('channel').notNull(),                 // TIKTOK, INSTAGRAM, YOUTUBE, EMAIL, META_AD, GOOGLE_AD
  body: text('body').notNull(),
  headline: text('headline'),
  schwartzLevel: text('schwartz_level'),              // UNAWARE, PROBLEM_AWARE, SOLUTION_AWARE, PRODUCT_AWARE, MOST_AWARE
  framework: text('framework'),                       // AIDA, PAS, BAB, HOOK_STORY_OFFER, 4Ps
  cialdiniTrigger: text('cialdini_trigger'),           // SCARCITY, SOCIAL_PROOF, AUTHORITY, RECIPROCITY, COMMITMENT, LIKING
  primaryObjection: text('primary_objection'),         // PRICE, SKEPTICISM, TIMING, SIZE, WEIGHT
  createdBy: text('created_by'),                       // zo, kevin, carpe_diem, ai_agent
}, (table) => ({
  channelIdx: index('copy_assets_channel_idx').on(table.channel),
  contentTypeIdx: index('copy_assets_content_type_idx').on(table.contentType),
  createdAtIdx: index('copy_assets_created_at_idx').on(table.createdAt),
}));

// ── copy_performance — results from Meta/Google matched to copy ──

export const copyPerformance = pgTable('copy_performance', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  copyAssetId: varchar('copy_asset_id').notNull().references(() => copyAssets.id),
  measuredAt: timestamp('measured_at').notNull().default(sql`now()`),
  channel: text('channel').notNull(),                 // META, GOOGLE, TIKTOK
  impressions: integer('impressions').default(0),
  clicks: integer('clicks').default(0),
  conversions: integer('conversions').default(0),
  spend: numeric('spend', { precision: 12, scale: 2 }).default('0'),
  revenue: numeric('revenue', { precision: 12, scale: 2 }).default('0'),
  roas: real('roas').default(0),
  ctr: real('ctr').default(0),
  performanceScore: real('performance_score'),         // 0-100, computed by Claude
}, (table) => ({
  copyAssetIdIdx: index('copy_perf_asset_id_idx').on(table.copyAssetId),
  channelIdx: index('copy_perf_channel_idx').on(table.channel),
  measuredAtIdx: index('copy_perf_measured_at_idx').on(table.measuredAt),
}));

// ── copy_roots — living intelligence layer, patterns from what converts ──

export const copyRoots = pgTable('copy_roots', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  updatedAt: timestamp('updated_at').notNull().default(sql`now()`),
  framework: text('framework'),
  schwartzLevel: text('schwartz_level'),
  cialdiniTrigger: text('cialdini_trigger'),
  channel: text('channel'),
  contentType: text('content_type'),
  avgRoas: real('avg_roas').default(0),
  avgCtr: real('avg_ctr').default(0),
  sampleSize: integer('sample_size').default(0),
  topPerformingHeadline: text('top_performing_headline'),
  topPerformingHook: text('top_performing_hook'),
  insight: text('insight'),                            // Claude-generated pattern insight
}, (table) => ({
  frameworkIdx: index('copy_roots_framework_idx').on(table.framework),
  channelIdx: index('copy_roots_channel_idx').on(table.channel),
}));

// ── morning_trap_runs — daily briefing history (carried from monolith) ──

export const morningTrapRuns = pgTable('morning_trap_runs', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  runDate: timestamp('run_date').notNull(),
  googleAdsRaw: jsonb('google_ads_raw'),
  metaAdsRaw: jsonb('meta_ads_raw'),
  shopifyOrderCount: integer('shopify_order_count').default(0),
  shopifyGrossSales: numeric('shopify_gross_sales', { precision: 12, scale: 2 }).default('0'),
  shopifySourceBreakdown: jsonb('shopify_source_breakdown'),
  shopifyRefundCount: integer('shopify_refund_count').default(0),
  claudeBriefing: text('claude_briefing'),
  smsSent: boolean('sms_sent').default(false),
  smsSentAt: timestamp('sms_sent_at'),
  createdAt: timestamp('created_at').notNull().default(sql`now()`),
}, (table) => ({
  runDateIdx: index('morning_trap_runs_date_idx').on(table.runDate),
}));
