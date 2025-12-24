/**
 * Commerce Attribution Service
 * Syncs purchase source attribution from Shopify orders to GHL contacts
 * Supports backfill (historical) and incremental (ongoing) sync modes
 * 
 * Uses the project's existing storage layer for config and ShopifyClient for API calls.
 * Direct db access is used for commerce attribution tables with proper userId scoping.
 */

import { storage } from "../storage";
import { ShopifyClient } from "./shopify-client";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "@shared/schema";
import { 
  commerceAttributionCustomers, 
  commerceAttributionSyncState, 
  commerceAttributionSyncRuns, 
  commerceAttributionSyncErrors,
  CommerceSource,
  CommerceAttributionSyncMode,
  CommerceAttributionSyncStatus,
  type CommerceAttributionCustomer,
  type CommerceAttributionSyncRun,
  type CommerceAttributionSyncState,
} from "@shared/schema";
import { eq, and, desc, sql as drizzleSql } from "drizzle-orm";
import { logService } from "./log-service";

// Cached database connection for commerce attribution tables (reuses single connection)
let cachedDb: ReturnType<typeof drizzle> | null = null;
const getDb = () => {
  if (!cachedDb) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set");
    }
    const sqlClient = neon(process.env.DATABASE_URL);
    cachedDb = drizzle(sqlClient, { schema });
  }
  return cachedDb;
};

// Batch processing configuration
const GHL_BATCH_SIZE = 15; // Process 15 contacts at a time
const GHL_BATCH_DELAY_MS = 500; // 500ms delay between batches
const GHL_RETRY_DELAY_MS = 2000; // 2 seconds initial retry delay
const GHL_MAX_RETRIES = 3; // Max retries for rate limit errors

// Helper function for delays
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// GHL Custom Field IDs from the prompt
const GHL_FIELD_IDS = {
  originalPurchaseSource: "euuEYInRjyPm54FMsGRl",
  latestPurchaseSource: "gYLLeq4XgmjX81BC0P4P",
  allPurchaseSources: "zQms4kbFCOjfnCyNoSjy",
  purchaseCount: "QWH8t6fAnPa8swVFSoIV",
  firstPurchaseDate: "4w3S0TS3njUlIhzoz6eu",
  lastPurchaseDate: "FkyUn2IE9OKeIXg0i0jI",
  lifetimeValue: "GLkj2CwqASl0lPgnB3YM",
};

// GHL Tag NAMES (not IDs - the GHL API tags field expects tag names, not IDs)
const GHL_TAG_NAMES = {
  srcFirstAmazon: "srcFirstAmazon",
  srcFirstShopify: "srcFirstShopify",
  srcFirstUnknown: "srcFirstUnknown",
  srcLatestAmazon: "srcLatestAmazon",
  srcLatestShopify: "srcLatestShopify",
  srcLatestUnknown: "srcLatestUnknown",
  buyerMultiple: "buyerMultiple",
  buyerOnce: "buyerOnce",
};

// Default source classification patterns
const DEFAULT_PATTERNS = [
  { patternType: "channel_handle", pattern: "web", source: "shopify", priority: 10 },
  { patternType: "channel_display", pattern: "online store", source: "shopify", priority: 10 },
  { patternType: "channel_display", pattern: "amazon", source: "amazon", priority: 20 },
  { patternType: "channel_handle", pattern: "amazon", source: "amazon", priority: 20 },
  { patternType: "app_title", pattern: "amazon", source: "amazon", priority: 15 },
  { patternType: "tag", pattern: "AMZN", source: "amazon", priority: 25 },
  { patternType: "tag", pattern: "Amazon", source: "amazon", priority: 25 },
  { patternType: "tag", pattern: "AMZN Orders", source: "amazon", priority: 25 },
];

// Shopify GraphQL order query for attribution data
// IMPORTANT: sourceIdentifier contains external order IDs (e.g., Amazon order IDs like 111-1234567-1234567)
// This is the most reliable way to identify Amazon orders
const ORDERS_GRAPHQL_QUERY = `
query GetOrders($cursor: String, $first: Int!) {
  orders(first: $first, after: $cursor, sortKey: CREATED_AT, reverse: false) {
    pageInfo {
      hasNextPage
      endCursor
    }
    edges {
      node {
        id
        name
        createdAt
        email
        sourceIdentifier
        sourceName
        app {
          name
          id
        }
        totalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        tags
        displayFinancialStatus
        customer {
          id
          email
          phone
          firstName
          lastName
        }
        billingAddress {
          phone
          firstName
          lastName
        }
        shippingAddress {
          phone
          firstName
          lastName
        }
        channelInformation {
          channelId
          channelDefinition {
            handle
            channelName
          }
          app {
            title
          }
        }
      }
    }
  }
}
`;

// Amazon order ID pattern: 3 digits, dash, 7 digits, dash, 7 digits (e.g., 111-1234567-1234567)
const AMAZON_ORDER_ID_PATTERN = /^\d{3}-\d{7}-\d{7}$/;

interface ShopifyGraphQLOrder {
  id: string;
  name: string;
  createdAt: string;
  email?: string;
  sourceIdentifier?: string;
  sourceName?: string;
  app?: {
    name?: string;
    id?: string;
  };
  totalPriceSet?: {
    shopMoney?: {
      amount: string;
      currencyCode: string;
    };
  };
  tags: string[];
  displayFinancialStatus: string;
  customer?: {
    id: string;
    email?: string;
    phone?: string;
    firstName?: string;
    lastName?: string;
  };
  billingAddress?: {
    phone?: string;
    firstName?: string;
    lastName?: string;
  };
  shippingAddress?: {
    phone?: string;
    firstName?: string;
    lastName?: string;
  };
  channelInformation?: {
    channelId?: string;
    channelDefinition?: {
      handle?: string;
      channelName?: string;
    };
    app?: {
      title?: string;
    };
  };
}

interface AttributionAggregation {
  emailKey?: string;
  phoneKey?: string;
  firstName?: string;
  lastName?: string;
  firstOrderId: string;
  firstOrderAt: Date;
  firstSource: string;
  lastOrderId: string;
  lastOrderAt: Date;
  lastSource: string;
  purchaseCount: number;
  lifetimeValueCents: number;
  sourcesSet: string;
}

export class CommerceAttributionService {
  private userId: string;
  private shopDomain: string = "";
  private accessToken: string = "";
  private ghlApiKey: string = "";
  private ghlLocationId: string = "";
  private runId: string | null = null;
  private initialized: boolean = false;

  constructor(userId: string) {
    this.userId = userId;
  }

  /**
   * Initialize the service by loading config from the database using storage layer
   */
  async initialize(): Promise<{ success: boolean; error?: string }> {
    try {
      // Get Shopify config using storage layer
      const shopifyConfig = await storage.getIntegrationConfig(this.userId, "SHOPIFY");

      if (!shopifyConfig) {
        return { success: false, error: "Shopify integration not configured" };
      }

      const shopifyConfigData = shopifyConfig.config as Record<string, any> || {};
      this.shopDomain = (shopifyConfigData.shopDomain || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
      this.accessToken = shopifyConfig.apiKey || "";

      if (!this.shopDomain || !this.accessToken) {
        return { success: false, error: "Shopify credentials not configured" };
      }

      // Get GHL config using storage layer
      const ghlConfig = await storage.getIntegrationConfig(this.userId, "GOHIGHLEVEL");

      if (!ghlConfig) {
        return { success: false, error: "GoHighLevel integration not configured" };
      }

      const ghlConfigData = ghlConfig.config as Record<string, any> || {};
      
      // Use database API key, but fallback to environment variable if database key is invalid
      // (e.g., contains non-ASCII characters like bullet points from masked copy-paste)
      let dbApiKey = ghlConfig.apiKey || "";
      const isValidAscii = /^[\x00-\x7F]*$/.test(dbApiKey) && dbApiKey.length > 10;
      
      if (isValidAscii) {
        this.ghlApiKey = dbApiKey;
      } else {
        // Fallback to environment variable
        this.ghlApiKey = process.env.GOHIGHLEVEL_API_KEY || "";
        if (this.ghlApiKey) {
          console.log("[CommerceAttribution] Using GOHIGHLEVEL_API_KEY from environment (database key was invalid)");
        }
      }
      
      this.ghlLocationId = ghlConfigData.locationId || "";

      if (!this.ghlApiKey || !this.ghlLocationId) {
        return { success: false, error: "GoHighLevel credentials not configured. Please update the API key in Settings or set GOHIGHLEVEL_API_KEY environment variable." };
      }

      this.initialized = true;
      return { success: true };
    } catch (error: any) {
      console.error("[CommerceAttribution] Initialize error:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Run backfill sync (historical orders)
   */
  async runBackfillSync(fromDate?: Date, toDate?: Date): Promise<{
    ordersProcessed: number;
    customersUpdated: number;
    contactsUpdated: number;
    errors: number;
  }> {
    if (!this.initialized) {
      throw new Error("Service not initialized. Call initialize() first.");
    }
    
    const lockResult = await this.acquireLock();
    if (!lockResult.acquired) {
      throw new Error(lockResult.message || "Sync already running");
    }

    try {
      const run = await this.createSyncRun(CommerceAttributionSyncMode.BACKFILL);
      this.runId = run.id;

      console.log(`[CommerceAttribution] Starting backfill sync for user ${this.userId}`);
      const stats = await this.runBackfill();

      const status = stats.errors > 0 ? CommerceAttributionSyncStatus.PARTIAL : CommerceAttributionSyncStatus.SUCCESS;
      await this.updateSyncRun(run.id, status, stats);
      await this.markBackfillComplete();

      return stats;
    } finally {
      await this.releaseLock();
    }
  }

  /**
   * Run incremental sync (new orders since last sync)
   */
  async runIncrementalSync(): Promise<{
    ordersProcessed: number;
    customersUpdated: number;
    contactsUpdated: number;
    errors: number;
  }> {
    if (!this.initialized) {
      throw new Error("Service not initialized. Call initialize() first.");
    }

    const lockResult = await this.acquireLock();
    if (!lockResult.acquired) {
      throw new Error(lockResult.message || "Sync already running");
    }

    try {
      const syncState = await this.getSyncState();
      const run = await this.createSyncRun(CommerceAttributionSyncMode.INCREMENTAL);
      this.runId = run.id;

      console.log(`[CommerceAttribution] Starting incremental sync for user ${this.userId}`);
      const stats = await this.runIncremental(syncState!);

      const status = stats.errors > 0 ? CommerceAttributionSyncStatus.PARTIAL : CommerceAttributionSyncStatus.SUCCESS;
      await this.updateSyncRun(run.id, status, stats);

      return stats;
    } finally {
      await this.releaseLock();
    }
  }

  /**
   * Get recent sync runs
   */
  async getRecentSyncRuns(limit: number = 5): Promise<CommerceAttributionSyncRun[]> {
    const runs = await getDb()
      .select()
      .from(commerceAttributionSyncRuns)
      .where(eq(commerceAttributionSyncRuns.userId, this.userId))
      .orderBy(desc(commerceAttributionSyncRuns.startedAt))
      .limit(limit);
    return runs;
  }

  /**
   * Get attributed customers with pagination
   */
  async getAttributedCustomers(
    sourceFilter?: string,
    page: number = 1,
    limit: number = 50
  ): Promise<{
    customers: CommerceAttributionCustomer[];
    total: number;
    page: number;
    limit: number;
  }> {
    const offset = (page - 1) * limit;

    let whereClause = eq(commerceAttributionCustomers.userId, this.userId);
    if (sourceFilter) {
      whereClause = and(
        whereClause,
        eq(commerceAttributionCustomers.lastSource, sourceFilter as typeof CommerceSource.AMAZON | typeof CommerceSource.SHOPIFY | typeof CommerceSource.UNKNOWN)
      )!;
    }

    const customers = await getDb()
      .select()
      .from(commerceAttributionCustomers)
      .where(whereClause)
      .orderBy(desc(commerceAttributionCustomers.lastOrderAt))
      .limit(limit)
      .offset(offset);

    const countResult = await getDb().select({ count: drizzleSql<number>`count(*)` })
      .from(commerceAttributionCustomers)
      .where(whereClause);

    return {
      customers,
      total: Number(countResult[0]?.count || 0),
      page,
      limit,
    };
  }

  /**
   * Cancel a running sync
   */
  async cancelSync(): Promise<void> {
    await this.releaseLock();
    if (this.runId) {
      await this.updateSyncRun(this.runId, CommerceAttributionSyncStatus.FAILED, {
        ordersProcessed: 0,
        customersUpdated: 0,
        contactsUpdated: 0,
        contactsMatched: 0,
        contactsCreated: 0,
        errors: 1,
      });
    }
  }

  /**
   * Clean up incorrectly added tag ID tags from GHL contacts
   * These are tags where the tag name looks like a GHL ID (alphanumeric ~20 chars)
   */
  async cleanupWrongTags(): Promise<{ cleaned: number; errors: number }> {
    // Initialize first to get GHL credentials
    const initResult = await this.initialize();
    if (!initResult.success) {
      throw new Error(initResult.error || "Failed to initialize");
    }

    // The wrong tag IDs that were incorrectly used as tag names
    const wrongTagIds = [
      "T6ZSk1QJVMVic0aeeYDO",
      "h7wDFKmSw83LaXQ18flg", 
      "6xB0AtCzlQpicv7MmBHh",
      "RNNReOFEKclM6KeiYfeq",
      "y7REy3Fua1RmEHsbIsWQ",
      "W2im5PmmInK8u1hmZ0bg",
      "Usy0iBWEJsWSQ3eYHYeT",
      "I7D6zT7GpQOcWeMLpWht",
    ];
    
    // Also match any lowercase variants
    const wrongTagSet = new Set([
      ...wrongTagIds,
      ...wrongTagIds.map(t => t.toLowerCase()),
    ]);

    let cleaned = 0;
    let errors = 0;
    let totalScanned = 0;
    let startAfterId: string | null = null;
    const pageSize = 100;

    console.log("[CommerceAttribution] Starting cleanup of wrong tag IDs...");

    while (true) {
      try {
        // Build URL with proper pagination (startAfterId, not skip)
        const url = new URL(`https://services.leadconnectorhq.com/contacts/`);
        url.searchParams.set("locationId", this.ghlLocationId!);
        url.searchParams.set("limit", String(pageSize));
        if (startAfterId) {
          url.searchParams.set("startAfterId", startAfterId);
        }

        const response = await fetch(url.toString(), {
          headers: {
            Authorization: `Bearer ${this.ghlApiKey}`,
            Version: "2021-07-28",
          },
        });

        if (!response.ok) {
          if (response.status === 429) {
            console.log("[CommerceAttribution] Rate limited, waiting 5 seconds...");
            await delay(5000);
            continue;
          }
          const errorText = await response.text();
          throw new Error(`GHL API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        const contacts = data.contacts || [];
        const meta = data.meta || {};

        if (contacts.length === 0) break;

        totalScanned += contacts.length;

        for (const contact of contacts) {
          const tags = contact.tags || [];
          const wrongTags = tags.filter((t: string) => wrongTagSet.has(t));

          if (wrongTags.length > 0) {
            // Remove wrong tags
            const cleanedTags = tags.filter((t: string) => !wrongTagSet.has(t));
            
            try {
              const updateResponse = await fetch(
                `https://services.leadconnectorhq.com/contacts/${contact.id}`,
                {
                  method: "PUT",
                  headers: {
                    Authorization: `Bearer ${this.ghlApiKey}`,
                    "Content-Type": "application/json",
                    Version: "2021-07-28",
                  },
                  body: JSON.stringify({ tags: cleanedTags }),
                }
              );

              if (updateResponse.ok) {
                cleaned++;
                console.log(`[CommerceAttribution] Cleaned ${wrongTags.length} wrong tags from contact ${contact.id}`);
              } else if (updateResponse.status === 429) {
                console.log("[CommerceAttribution] Rate limited during update, waiting 2 seconds...");
                await delay(2000);
                errors++;
              } else {
                errors++;
              }
            } catch (err) {
              errors++;
            }

            // Small delay between updates
            await delay(100);
          }
        }

        // Use startAfterId for pagination (GHL v2 API)
        startAfterId = meta.startAfterId || null;
        if (!startAfterId) break;

        console.log(`[CommerceAttribution] Scanned ${totalScanned} contacts, ${cleaned} cleaned so far`);
        await delay(500); // Delay between pages

      } catch (err: any) {
        console.error("[CommerceAttribution] Cleanup error:", err.message);
        errors++;
        break;
      }
    }

    console.log(`[CommerceAttribution] Cleanup complete: ${cleaned} contacts cleaned, ${errors} errors`);
    return { cleaned, errors };
  }

  /**
   * Get sync status
   */
  async getSyncStatus(): Promise<CommerceAttributionSyncState | null> {
    return await this.getSyncState();
  }

  /**
   * Main entry point - called when user clicks Sync on Shopify card
   */
  async runSync(): Promise<{
    success: boolean;
    runId?: string;
    mode?: string;
    message: string;
    stats?: {
      ordersProcessed: number;
      customersUpdated: number;
      contactsUpdated: number;
      errors: number;
    };
  }> {
    // Check if sync is already running
    const lockResult = await this.acquireLock();
    if (!lockResult.acquired) {
      return {
        success: false,
        message: lockResult.message || "Sync already running",
      };
    }

    try {
      // Check if backfill is complete
      const syncState = await this.getSyncState();
      const mode = syncState?.backfillComplete
        ? CommerceAttributionSyncMode.INCREMENTAL
        : CommerceAttributionSyncMode.BACKFILL;

      // Create sync run record
      const run = await this.createSyncRun(mode);
      this.runId = run.id;

      console.log(`[CommerceAttribution] Starting ${mode} sync for user ${this.userId}`);

      let stats: { ordersProcessed: number; customersUpdated: number; contactsUpdated: number; contactsMatched: number; contactsCreated: number; errors: number };

      if (mode === CommerceAttributionSyncMode.BACKFILL) {
        stats = await this.runBackfill();
      } else {
        stats = await this.runIncremental(syncState!);
      }

      // Mark run as complete
      const status = stats.errors > 0 ? CommerceAttributionSyncStatus.PARTIAL : CommerceAttributionSyncStatus.SUCCESS;
      await this.updateSyncRun(run.id, status, stats);

      // Update sync state
      if (mode === CommerceAttributionSyncMode.BACKFILL) {
        await this.markBackfillComplete();
      }

      console.log(`[CommerceAttribution] ${mode} sync complete: ${stats.ordersProcessed} orders, ${stats.customersUpdated} customers, ${stats.contactsUpdated} contacts`);

      return {
        success: true,
        runId: run.id,
        mode,
        message: `${mode} sync completed successfully`,
        stats,
      };
    } catch (error: any) {
      console.error(`[CommerceAttribution] Sync failed:`, error);

      if (this.runId) {
        await this.updateSyncRun(this.runId, CommerceAttributionSyncStatus.FAILED, {
          ordersProcessed: 0,
          customersUpdated: 0,
          contactsUpdated: 0,
          contactsMatched: 0,
          contactsCreated: 0,
          errors: 1,
        });
        await this.logError("api", null, "SYNC_FAILED", error.message);
      }

      return {
        success: false,
        message: error.message || "Sync failed",
      };
    } finally {
      await this.releaseLock();
    }
  }

  /**
   * Run backfill - fetch ALL historical orders
   */
  private async runBackfill(): Promise<{
    ordersProcessed: number;
    customersUpdated: number;
    contactsUpdated: number;
    contactsMatched: number;
    contactsCreated: number;
    errors: number;
  }> {
    console.log("[CommerceAttribution] Starting backfill...");

    // Mark backfill started
    await getDb()
      .update(commerceAttributionSyncState)
      .set({ lastBackfillStartedAt: new Date() })
      .where(eq(commerceAttributionSyncState.userId, this.userId));

    // Fetch all orders via GraphQL with pagination
    const orders = await this.fetchAllOrders();

    if (orders.length === 0) {
      console.log("[CommerceAttribution] No orders found");
      return { ordersProcessed: 0, customersUpdated: 0, contactsUpdated: 0, contactsMatched: 0, contactsCreated: 0, errors: 0 };
    }

    // Aggregate by customer first so we can set total for progress tracking
    const { aggregations, stats } = await this.aggregateOrders(orders);
    const totalCustomers = aggregations.size;

    // Set totalOrders (using customer count for progress) on the sync run for progress tracking
    // Also store aggregation stats in summaryJson for UI display
    if (this.runId) {
      await getDb()
        .update(commerceAttributionSyncRuns)
        .set({ 
          totalOrders: totalCustomers,
          summaryJson: {
            totalOrdersFetched: stats.totalOrders,
            uniqueCustomers: totalCustomers,
            skippedNoContact: stats.skippedNoContact,
            skippedCancelledRefunded: stats.skippedCancelledRefunded,
            oldestOrderDate: stats.oldestOrderDate?.toISOString() || null,
            newestOrderDate: stats.newestOrderDate?.toISOString() || null,
          },
        })
        .where(eq(commerceAttributionSyncRuns.id, this.runId));
    }

    // Check if we got historical orders (older than 60 days)
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
    if (stats.oldestOrderDate && stats.oldestOrderDate > sixtyDaysAgo && orders.length > 100) {
      // If we have many orders but none older than 60 days, we might be missing read_all_orders scope
      await this.logError(
        "api",
        null,
        "POSSIBLE_MISSING_READ_ALL_ORDERS",
        "Orders only go back 60 days. If you have older orders, the app may need read_all_orders scope."
      );
    }

    console.log(`[CommerceAttribution] Fetched ${stats.totalOrders} orders, aggregated to ${totalCustomers} customers`);
    console.log(`[CommerceAttribution] Skipped: ${stats.skippedNoContact} no email/phone, ${stats.skippedCancelledRefunded} cancelled/refunded`);
    if (stats.oldestOrderDate && stats.newestOrderDate) {
      console.log(`[CommerceAttribution] Order date range: ${stats.oldestOrderDate.toISOString().split('T')[0]} to ${stats.newestOrderDate.toISOString().split('T')[0]}`);
    }

    // Convert aggregations to array for batch processing
    const aggregationArray = Array.from(aggregations.entries());
    
    // Process in batches with rate limiting
    const result = await this.processAggregationsInBatches(aggregationArray, totalCustomers);

    console.log(`[CommerceAttribution] Backfill complete: ${result.customersUpdated} customers updated, ${result.contactsUpdated} GHL contacts synced (${result.contactsMatched} matched, ${result.contactsCreated} created), ${result.errors} errors`);

    return result;
  }

  /**
   * Run incremental sync - fetch orders since last sync
   */
  private async runIncremental(
    syncState: CommerceAttributionSyncState
  ): Promise<{
    ordersProcessed: number;
    customersUpdated: number;
    contactsUpdated: number;
    contactsMatched: number;
    contactsCreated: number;
    errors: number;
  }> {
    console.log("[CommerceAttribution] Starting incremental sync...");

    // Fetch orders since last sync (use cursor if available)
    const orders = await this.fetchOrdersSince(syncState.lastSyncedAt || new Date(0));

    if (orders.length === 0) {
      console.log("[CommerceAttribution] No new orders since last sync");
      await getDb()
        .update(commerceAttributionSyncState)
        .set({ lastSyncedAt: new Date() })
        .where(eq(commerceAttributionSyncState.userId, this.userId));
      return { ordersProcessed: 0, customersUpdated: 0, contactsUpdated: 0, contactsMatched: 0, contactsCreated: 0, errors: 0 };
    }

    console.log(`[CommerceAttribution] Fetched ${orders.length} new orders`);

    // For incremental, we need to re-aggregate impacted customers
    const impactedCustomerKeys = new Set<string>();
    for (const order of orders) {
      const emailKey = this.normalizeEmail(order.customer?.email || order.email);
      const phoneKey = this.normalizePhone(
        order.customer?.phone || order.shippingAddress?.phone || order.billingAddress?.phone
      );
      if (emailKey) impactedCustomerKeys.add(`email:${emailKey}`);
      if (phoneKey) impactedCustomerKeys.add(`phone:${phoneKey}`);
    }

    // For simplicity, just aggregate the new orders (full re-aggregation would require fetching all orders again)
    const { aggregations } = await this.aggregateOrders(orders);
    const totalCustomers = aggregations.size;

    // Set totalOrders for progress tracking
    if (this.runId) {
      await getDb()
        .update(commerceAttributionSyncRuns)
        .set({ totalOrders: totalCustomers })
        .where(eq(commerceAttributionSyncRuns.id, this.runId));
    }

    // Convert aggregations to array for batch processing
    const aggregationArray = Array.from(aggregations.entries());
    
    // Process in batches with rate limiting (incremental mode merges with existing data)
    const result = await this.processAggregationsInBatches(aggregationArray, totalCustomers, true);

    console.log(`[CommerceAttribution] Incremental sync complete: ${result.customersUpdated} customers updated, ${result.contactsUpdated} GHL contacts synced (${result.contactsMatched} matched, ${result.contactsCreated} created), ${result.errors} errors`);

    // Update last synced timestamp
    await getDb()
      .update(commerceAttributionSyncState)
      .set({ lastSyncedAt: new Date() })
      .where(eq(commerceAttributionSyncState.userId, this.userId));

    return result;
  }

  /**
   * Process aggregations in batches with rate limiting for GHL API
   * Handles retries for rate limit errors and logs all failures
   */
  private async processAggregationsInBatches(
    aggregationArray: [string, AttributionAggregation][],
    totalCustomers: number,
    isIncremental: boolean = false
  ): Promise<{
    ordersProcessed: number;
    customersUpdated: number;
    contactsUpdated: number;
    contactsMatched: number;
    contactsCreated: number;
    errors: number;
  }> {
    let customersUpdated = 0;
    let contactsUpdated = 0;
    let contactsCreated = 0;
    let contactsMatched = 0;
    let errors = 0;
    let processed = 0;

    const totalBatches = Math.ceil(aggregationArray.length / GHL_BATCH_SIZE);
    console.log(`[CommerceAttribution] Starting ${isIncremental ? 'incremental' : 'backfill'} GHL sync: ${totalCustomers} customers in ${totalBatches} batches of ${GHL_BATCH_SIZE}`);

    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const batchStart = batchIndex * GHL_BATCH_SIZE;
      const batchEnd = Math.min(batchStart + GHL_BATCH_SIZE, aggregationArray.length);
      const batch = aggregationArray.slice(batchStart, batchEnd);

      console.log(`[CommerceAttribution] Processing batch ${batchIndex + 1}/${totalBatches} (${batch.length} contacts)...`);

      // Process each item in the batch
      for (const [key, agg] of batch) {
        processed++;

        try {
          // For incremental syncs, merge with existing customer data
          let aggregationToSync = agg;
          if (isIncremental) {
            const existing = await this.getExistingCustomer(agg.emailKey, agg.phoneKey);
            aggregationToSync = this.mergeAggregations(existing, agg);
          }

          // Save to our database first
          await this.upsertCustomerAttribution(aggregationToSync);
          customersUpdated++;

          // Sync to GHL with retry logic for rate limits
          const ghlResult = await this.syncToGHLWithRetry(aggregationToSync, key);
          
          if (ghlResult.success) {
            contactsUpdated++;
            if (ghlResult.created) {
              contactsCreated++;
            } else {
              contactsMatched++;
            }
          } else {
            errors++;
            // Log detailed error to database
            await this.logError("ghl", key, "GHL_SYNC_FAILED", ghlResult.error || "Unknown error");
          }
        } catch (error: any) {
          errors++;
          console.error(`[CommerceAttribution] Error processing ${key}: ${error.message}`);
          await this.logError("customer", key, "CUSTOMER_UPDATE_FAILED", error.message);
        }
      }

      // Update progress after each batch
      console.log(`[CommerceAttribution] Batch ${batchIndex + 1}/${totalBatches} complete: ${processed}/${totalCustomers} processed (${contactsMatched} matched, ${contactsCreated} created, ${errors} errors)`);
      
      if (this.runId) {
        await this.updateSyncRunProgress({
          ordersProcessed: processed,
          customersUpdated,
          contactsUpdated,
          contactsMatched,
          contactsCreated,
          errors,
        });
      }

      // Add delay between batches to respect GHL rate limits (skip on last batch)
      if (batchIndex < totalBatches - 1) {
        await delay(GHL_BATCH_DELAY_MS);
      }
    }

    return {
      ordersProcessed: totalCustomers,
      customersUpdated,
      contactsUpdated,
      contactsMatched,
      contactsCreated,
      errors,
    };
  }

  /**
   * Sync to GHL with retry logic for rate limit errors
   */
  private async syncToGHLWithRetry(
    agg: AttributionAggregation,
    key: string
  ): Promise<{ success: boolean; created?: boolean; error?: string }> {
    let lastError: string = "";
    
    for (let attempt = 0; attempt < GHL_MAX_RETRIES; attempt++) {
      const result = await this.syncToGHL(agg);
      
      if (result.success) {
        return result;
      }

      // Check if it's a rate limit error (429)
      if (result.error?.includes("429") || result.error?.includes("rate limit") || result.error?.includes("Too Many Requests")) {
        const retryDelay = GHL_RETRY_DELAY_MS * Math.pow(2, attempt); // Exponential backoff
        console.log(`[CommerceAttribution] Rate limited on ${key}, waiting ${retryDelay}ms before retry ${attempt + 1}/${GHL_MAX_RETRIES}`);
        await delay(retryDelay);
        lastError = result.error || "Rate limited";
        continue;
      }

      // Non-rate-limit error, don't retry
      return result;
    }

    // All retries exhausted
    return { success: false, error: `Rate limit exceeded after ${GHL_MAX_RETRIES} retries: ${lastError}` };
  }

  /**
   * Fetch all orders from Shopify GraphQL API
   */
  private async fetchAllOrders(): Promise<ShopifyGraphQLOrder[]> {
    const allOrders: ShopifyGraphQLOrder[] = [];
    let cursor: string | null = null;
    let hasNextPage = true;
    const pageSize = 100;

    while (hasNextPage) {
      try {
        const response = await fetch(
          `https://${this.shopDomain}/admin/api/2024-01/graphql.json`,
          {
            method: "POST",
            headers: {
              "X-Shopify-Access-Token": this.accessToken,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              query: ORDERS_GRAPHQL_QUERY,
              variables: { cursor, first: pageSize },
            }),
          }
        );

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Shopify GraphQL error: ${response.status} - ${errorText}`);
        }

        const data: { errors?: any[]; data?: { orders?: { edges: { node: ShopifyGraphQLOrder }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } } = await response.json();

        if (data.errors) {
          throw new Error(`Shopify GraphQL errors: ${JSON.stringify(data.errors)}`);
        }

        const ordersData = data.data?.orders;
        if (!ordersData) {
          throw new Error("No orders data in response");
        }

        for (const edge of ordersData.edges) {
          allOrders.push(edge.node);
        }

        hasNextPage = ordersData.pageInfo.hasNextPage;
        cursor = ordersData.pageInfo.endCursor;

        console.log(`[CommerceAttribution] Fetched ${allOrders.length} orders so far...`);

        // Rate limiting - Shopify GraphQL has cost-based throttling
        await new Promise((resolve) => setTimeout(resolve, 200));
      } catch (error: any) {
        console.error("[CommerceAttribution] Error fetching orders:", error);
        await this.logError("api", null, "SHOPIFY_FETCH_ERROR", error.message);
        throw error;
      }
    }

    return allOrders;
  }

  /**
   * Fetch orders since a specific date
   */
  private async fetchOrdersSince(since: Date): Promise<ShopifyGraphQLOrder[]> {
    const query = `
      query GetOrdersSince($cursor: String, $first: Int!, $since: DateTime!) {
        orders(first: $first, after: $cursor, sortKey: CREATED_AT, query: "created_at:>'\${since.toISOString()}'") {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node {
              id
              name
              createdAt
              email
              sourceIdentifier
              app {
                name
                id
              }
              totalPriceSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              tags
              displayFinancialStatus
              customer {
                id
                email
                phone
                firstName
                lastName
              }
              billingAddress {
                phone
                firstName
                lastName
              }
              shippingAddress {
                phone
                firstName
                lastName
              }
              channelInformation {
                channelId
                channelDefinition {
                  handle
                  channelName
                }
                app {
                  title
                }
              }
            }
          }
        }
      }
    `;

    const allOrders: ShopifyGraphQLOrder[] = [];
    let cursor: string | null = null;
    let hasNextPage = true;

    while (hasNextPage) {
      const response = await fetch(
        `https://${this.shopDomain}/admin/api/2024-01/graphql.json`,
        {
          method: "POST",
          headers: {
            "X-Shopify-Access-Token": this.accessToken,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query,
            variables: { cursor, first: 100, since: since.toISOString() },
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`Shopify GraphQL error: ${response.status}`);
      }

      const data: { data?: { orders?: { edges: { node: ShopifyGraphQLOrder }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } } = await response.json();
      const ordersData = data.data?.orders;

      if (!ordersData) break;

      for (const edge of ordersData.edges) {
        allOrders.push(edge.node);
      }

      hasNextPage = ordersData.pageInfo.hasNextPage;
      cursor = ordersData.pageInfo.endCursor;

      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    return allOrders;
  }

  /**
   * Classify order source (amazon, shopify, unknown)
   * Uses multiple detection methods in priority order for maximum accuracy
   * 
   * PRIORITY ORDER (based on empirical testing):
   * 1. sourceName contains "amazon" → AMAZON (GOLD STANDARD - CS Amazon Sync sets "Amazon", others may use variants)
   * 2. app.name contains "amazon" or "codisto" → AMAZON
   * 3. channelInformation.app.title contains "amazon" or "codisto" → AMAZON
   * 4. channelHandle/channelName contains "amazon" → AMAZON
   * 5. sourceIdentifier matches Amazon order ID pattern (###-#######-#######) → AMAZON (fallback for legacy connectors)
   * 6. Tags contain literal "amzn" or "amazon" text (only if NOT definitely Shopify) → AMAZON
   * 7. sourceName = "web" or "shopify_draft_order" → SHOPIFY
   * 8. app.name = "Online Store" or "Draft Orders" or "Buy Button" → SHOPIFY
   * 9. channelHandle = "web" or channelName = "Online Store" or "Buy Button" → SHOPIFY
   * 10. Otherwise → Unknown
   * 
   * NOTE: Tag pattern matching (###-#######-#######) is NOT used on tags due to false positives.
   * sourceIdentifier is safe to pattern match as it's system-controlled, not user-editable.
   */
  private classifyOrderSource(order: ShopifyGraphQLOrder): string {
    const sourceName = order.sourceName?.toLowerCase() || "";
    const topLevelAppName = order.app?.name?.toLowerCase() || "";
    const channelInfo = order.channelInformation;
    const channelHandle = channelInfo?.channelDefinition?.handle?.toLowerCase() || "";
    const channelName = channelInfo?.channelDefinition?.channelName?.toLowerCase() || "";
    const channelAppTitle = channelInfo?.app?.title?.toLowerCase() || "";
    const sourceIdentifier = order.sourceIdentifier || "";
    const tags = order.tags.map((t) => t.toLowerCase());

    // KNOWN SHOPIFY INDICATORS - if these match, it's definitely Shopify
    const isDefinitelyShopify = 
      sourceName === "web" ||
      sourceName === "shopify_draft_order" ||
      topLevelAppName === "online store" ||
      topLevelAppName === "draft orders" ||
      topLevelAppName === "shopify pos" ||
      topLevelAppName === "point of sale" ||
      topLevelAppName === "buy button" ||
      topLevelAppName.includes("buy button") ||
      channelHandle === "web" ||
      channelName === "online store" ||
      channelName === "buy button" ||
      channelAppTitle.includes("buy button");

    // 1. GOLD STANDARD: sourceName contains "amazon" (CS Amazon Sync = "Amazon", others may vary)
    if (sourceName.includes("amazon")) {
      return CommerceSource.AMAZON;
    }

    // 2. Check app.name for Amazon/Codisto indicators
    if (
      topLevelAppName.includes("amazon") ||
      topLevelAppName.includes("codisto")
    ) {
      return CommerceSource.AMAZON;
    }

    // 3. Check channelInformation.app.title for Amazon/Codisto
    if (
      channelAppTitle.includes("amazon") ||
      channelAppTitle.includes("codisto")
    ) {
      return CommerceSource.AMAZON;
    }

    // 4. Check channel handle/name for Amazon
    if (
      channelHandle.includes("amazon") ||
      channelName.includes("amazon")
    ) {
      return CommerceSource.AMAZON;
    }

    // 5. Check sourceIdentifier for Amazon order ID pattern (###-#######-#######)
    // This is safe to pattern match as it's system-controlled, not user-editable
    if (sourceIdentifier && AMAZON_ORDER_ID_PATTERN.test(sourceIdentifier)) {
      return CommerceSource.AMAZON;
    }

    // 6. Check tags for Amazon indicators (EXACT MATCHES ONLY to prevent false positives)
    // Tags like "Amazon Prime" or "amazon_gift" on Shopify orders would cause misclassification
    // ONLY check tags if we haven't already identified this as definitely Shopify
    if (!isDefinitelyShopify) {
      // Exact match only - tags must be exactly "amzn" or "amazon" (case-insensitive)
      if (tags.some((t) => t === "amzn" || t === "amazon")) {
        return CommerceSource.AMAZON;
      }
    }

    // 7-9. Check for Shopify indicators
    if (isDefinitelyShopify) {
      return CommerceSource.SHOPIFY;
    }

    // Default to unknown
    return CommerceSource.UNKNOWN;
  }

  /**
   * Aggregate orders by customer
   * Returns aggregation map plus stats about skipped orders and date range
   */
  private async aggregateOrders(
    orders: ShopifyGraphQLOrder[]
  ): Promise<{
    aggregations: Map<string, AttributionAggregation>;
    stats: {
      totalOrders: number;
      skippedNoContact: number;
      skippedCancelledRefunded: number;
      oldestOrderDate: Date | null;
      newestOrderDate: Date | null;
    };
  }> {
    const aggregations = new Map<string, AttributionAggregation>();
    
    // Debug: Count sources for logging
    const sourceCounts = { amazon: 0, shopify: 0, unknown: 0 };
    let amazonSamples: string[] = [];
    
    // Stats tracking
    let skippedNoContact = 0;
    let skippedCancelledRefunded = 0;
    let oldestOrderDate: Date | null = null;
    let newestOrderDate: Date | null = null;

    for (const order of orders) {
      const orderDate = new Date(order.createdAt);
      
      // Track date range for all orders (before filtering)
      if (!oldestOrderDate || orderDate < oldestOrderDate) {
        oldestOrderDate = orderDate;
      }
      if (!newestOrderDate || orderDate > newestOrderDate) {
        newestOrderDate = orderDate;
      }
      
      // Skip cancelled/voided orders
      if (
        order.displayFinancialStatus === "VOIDED" ||
        order.displayFinancialStatus === "REFUNDED"
      ) {
        skippedCancelledRefunded++;
        continue;
      }

      const emailKey = this.normalizeEmail(order.customer?.email || order.email);
      const phoneKey = this.normalizePhone(
        order.customer?.phone || order.shippingAddress?.phone || order.billingAddress?.phone
      );

      // Get customer name - try customer, then shipping, then billing address
      const firstName = order.customer?.firstName || order.shippingAddress?.firstName || order.billingAddress?.firstName;
      const lastName = order.customer?.lastName || order.shippingAddress?.lastName || order.billingAddress?.lastName;

      if (!emailKey && !phoneKey) {
        // Can't aggregate without identity
        skippedNoContact++;
        continue;
      }

      // Use email as primary key, fallback to phone
      const customerKey = emailKey || phoneKey!;
      const source = this.classifyOrderSource(order);
      
      // Track source counts for logging
      if (source === CommerceSource.AMAZON) {
        sourceCounts.amazon++;
        if (amazonSamples.length < 5) {
          // Show what indicator triggered Amazon classification
          const srcName = order.sourceName || '';
          const appName = order.app?.name || '';
          const channelAppTitle = order.channelInformation?.app?.title || '';
          let trigger = 'unknown';
          if (srcName.toLowerCase() === 'amazon') trigger = 'sourceName';
          else if (appName.toLowerCase().includes('amazon') || appName.toLowerCase().includes('codisto')) trigger = 'app.name';
          else if (channelAppTitle.toLowerCase().includes('amazon') || channelAppTitle.toLowerCase().includes('codisto')) trigger = 'channelApp';
          else trigger = 'tags/channel';
          amazonSamples.push(`${order.name} [${trigger}] sourceName:${srcName || 'none'} app:${appName || 'none'}`);
        }
      } else if (source === CommerceSource.SHOPIFY) {
        sourceCounts.shopify++;
      } else {
        sourceCounts.unknown++;
      }
      
      const orderAt = new Date(order.createdAt);
      const orderId = order.id.replace("gid://shopify/Order/", "");
      const amount = order.totalPriceSet?.shopMoney?.amount
        ? Math.round(parseFloat(order.totalPriceSet.shopMoney.amount) * 100)
        : 0;

      const existing = aggregations.get(customerKey);

      if (!existing) {
        aggregations.set(customerKey, {
          emailKey,
          phoneKey,
          firstName,
          lastName,
          firstOrderId: orderId,
          firstOrderAt: orderAt,
          firstSource: source,
          lastOrderId: orderId,
          lastOrderAt: orderAt,
          lastSource: source,
          purchaseCount: 1,
          lifetimeValueCents: amount,
          sourcesSet: source,
        });
      } else {
        // Update name if we didn't have it before
        if (!existing.firstName && firstName) existing.firstName = firstName;
        if (!existing.lastName && lastName) existing.lastName = lastName;
        // Update aggregation
        if (orderAt < existing.firstOrderAt) {
          existing.firstOrderId = orderId;
          existing.firstOrderAt = orderAt;
          existing.firstSource = source;
        }
        if (orderAt > existing.lastOrderAt) {
          existing.lastOrderId = orderId;
          existing.lastOrderAt = orderAt;
          existing.lastSource = source;
        }
        existing.purchaseCount++;
        existing.lifetimeValueCents += amount;

        // Update sources set
        const sources = new Set(existing.sourcesSet.split(",").filter(Boolean));
        sources.add(source);
        // Remove unknown if we have other sources
        if (sources.size > 1) {
          sources.delete(CommerceSource.UNKNOWN);
        }
        existing.sourcesSet = Array.from(sources).sort().join(",");
      }
    }
    
    // Log source classification summary
    console.log(`[CommerceAttribution] Source classification: Amazon=${sourceCounts.amazon}, Shopify=${sourceCounts.shopify}, Unknown=${sourceCounts.unknown}`);
    if (amazonSamples.length > 0) {
      console.log(`[CommerceAttribution] Amazon order samples: ${amazonSamples.join('; ')}`);
    }
    
    // Log skipped orders and date range
    console.log(`[CommerceAttribution] Orders skipped: ${skippedNoContact} missing email/phone, ${skippedCancelledRefunded} cancelled/refunded`);
    if (oldestOrderDate && newestOrderDate) {
      console.log(`[CommerceAttribution] Date range: ${oldestOrderDate.toISOString().split('T')[0]} to ${newestOrderDate.toISOString().split('T')[0]}`);
    }

    return {
      aggregations,
      stats: {
        totalOrders: orders.length,
        skippedNoContact,
        skippedCancelledRefunded,
        oldestOrderDate,
        newestOrderDate,
      },
    };
  }

  /**
   * Upsert customer attribution record
   */
  private async upsertCustomerAttribution(agg: AttributionAggregation): Promise<void> {
    // Try to find existing by email or phone
    const existing = await this.getExistingCustomer(agg.emailKey, agg.phoneKey);

    if (existing) {
      await getDb()
        .update(commerceAttributionCustomers)
        .set({
          firstOrderId: agg.firstOrderId,
          firstOrderAt: agg.firstOrderAt,
          firstSource: agg.firstSource,
          lastOrderId: agg.lastOrderId,
          lastOrderAt: agg.lastOrderAt,
          lastSource: agg.lastSource,
          purchaseCount: agg.purchaseCount,
          lifetimeValueCents: agg.lifetimeValueCents,
          sourcesSet: agg.sourcesSet,
          updatedAt: new Date(),
        })
        .where(eq(commerceAttributionCustomers.id, existing.id));
    } else {
      await getDb().insert(commerceAttributionCustomers).values({
        userId: this.userId,
        emailKey: agg.emailKey,
        phoneKey: agg.phoneKey,
        firstOrderId: agg.firstOrderId,
        firstOrderAt: agg.firstOrderAt,
        firstSource: agg.firstSource,
        lastOrderId: agg.lastOrderId,
        lastOrderAt: agg.lastOrderAt,
        lastSource: agg.lastSource,
        purchaseCount: agg.purchaseCount,
        lifetimeValueCents: agg.lifetimeValueCents,
        sourcesSet: agg.sourcesSet,
      });
    }
  }

  /**
   * Sync attribution to GHL contact - smart matching with fallback to create
   */
  private async syncToGHL(
    agg: AttributionAggregation
  ): Promise<{ success: boolean; notFound?: boolean; created?: boolean; matchMethod?: string; error?: string }> {
    try {
      // Build custom fields array for V2 API
      const customFields: Array<{ id: string; value: any }> = [
        { id: GHL_FIELD_IDS.originalPurchaseSource, value: agg.firstSource },
        { id: GHL_FIELD_IDS.latestPurchaseSource, value: agg.lastSource },
        { id: GHL_FIELD_IDS.allPurchaseSources, value: agg.sourcesSet },
        { id: GHL_FIELD_IDS.purchaseCount, value: agg.purchaseCount },
        { id: GHL_FIELD_IDS.firstPurchaseDate, value: agg.firstOrderAt.toISOString() },
        { id: GHL_FIELD_IDS.lastPurchaseDate, value: agg.lastOrderAt.toISOString() },
        { id: GHL_FIELD_IDS.lifetimeValue, value: agg.lifetimeValueCents / 100 },
      ];

      // Build tags to add
      const tagsToAdd: string[] = [];
      const tagsToRemove: string[] = [];

      // First source tags
      if (agg.firstSource === CommerceSource.AMAZON) {
        tagsToAdd.push(GHL_TAG_NAMES.srcFirstAmazon);
        tagsToRemove.push(GHL_TAG_NAMES.srcFirstShopify, GHL_TAG_NAMES.srcFirstUnknown);
      } else if (agg.firstSource === CommerceSource.SHOPIFY) {
        tagsToAdd.push(GHL_TAG_NAMES.srcFirstShopify);
        tagsToRemove.push(GHL_TAG_NAMES.srcFirstAmazon, GHL_TAG_NAMES.srcFirstUnknown);
      } else {
        tagsToAdd.push(GHL_TAG_NAMES.srcFirstUnknown);
        tagsToRemove.push(GHL_TAG_NAMES.srcFirstAmazon, GHL_TAG_NAMES.srcFirstShopify);
      }

      // Latest source tags
      if (agg.lastSource === CommerceSource.AMAZON) {
        tagsToAdd.push(GHL_TAG_NAMES.srcLatestAmazon);
        tagsToRemove.push(GHL_TAG_NAMES.srcLatestShopify, GHL_TAG_NAMES.srcLatestUnknown);
      } else if (agg.lastSource === CommerceSource.SHOPIFY) {
        tagsToAdd.push(GHL_TAG_NAMES.srcLatestShopify);
        tagsToRemove.push(GHL_TAG_NAMES.srcLatestAmazon, GHL_TAG_NAMES.srcLatestUnknown);
      } else {
        tagsToAdd.push(GHL_TAG_NAMES.srcLatestUnknown);
        tagsToRemove.push(GHL_TAG_NAMES.srcLatestAmazon, GHL_TAG_NAMES.srcLatestShopify);
      }

      // Buyer frequency tags
      if (agg.purchaseCount >= 2) {
        tagsToAdd.push(GHL_TAG_NAMES.buyerMultiple);
        tagsToRemove.push(GHL_TAG_NAMES.buyerOnce);
      } else {
        tagsToAdd.push(GHL_TAG_NAMES.buyerOnce);
        tagsToRemove.push(GHL_TAG_NAMES.buyerMultiple);
      }

      // Try to find and verify GHL contact with smart matching
      const matchResult = await this.findAndVerifyGHLContact(agg);

      // Check for error response (includes rate limit errors with HTTP status)
      if ("error" in matchResult) {
        return { success: false, error: matchResult.error };
      }

      let contactId: string;
      let wasCreated = false;
      let matchMethod: string | undefined;

      if ("matched" in matchResult && matchResult.matched) {
        // Found a verified match
        contactId = matchResult.id;
        matchMethod = matchResult.matchMethod;
        
        // Update existing contact with custom fields
        await this.updateGHLContact(contactId, customFields);
        
        // Update tags
        await this.updateGHLContactTags(contactId, tagsToAdd, tagsToRemove);
      } else {
        // No match found - create new contact
        const newContact = await this.createGHLContact(agg, customFields, tagsToAdd);
        
        if ("error" in newContact) {
          return { success: false, error: newContact.error };
        }
        
        if (!newContact.id) {
          return { success: false, error: "Failed to create new GHL contact - no ID returned" };
        }
        
        contactId = newContact.id;
        wasCreated = true;
        matchMethod = "created new";
      }

      // Update our record with GHL contact ID
      if (agg.emailKey) {
        await getDb()
          .update(commerceAttributionCustomers)
          .set({ ghlContactId: contactId, ghlLastSyncAt: new Date() })
          .where(
            and(
              eq(commerceAttributionCustomers.userId, this.userId),
              eq(commerceAttributionCustomers.emailKey, agg.emailKey)
            )
          );
      }

      return { success: true, created: wasCreated, matchMethod };
    } catch (error: any) {
      console.error("[CommerceAttribution] GHL sync error:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Sanitize a string for use in GHL API search queries.
   * Removes non-ASCII characters that cause ByteString encoding errors.
   */
  private sanitizeForSearch(str: string): string {
    // Remove non-ASCII characters (anything > 127) and replace with space
    // Then collapse multiple spaces and trim
    return str
      .replace(/[^\x00-\x7F]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Find and verify GHL contact with smart matching:
   * 1. Search by full name first, verify with email/phone
   * 2. If no name match, fallback to direct email/phone search
   * 3. Only create new contact if no match found
   * 
   * Returns error field with HTTP status for rate limit handling
   */
  private async findAndVerifyGHLContact(
    agg: AttributionAggregation
  ): Promise<{ id: string; matched: boolean; matchMethod?: string } | { id: null; shouldCreate: boolean } | { error: string }> {
    const rawFullName = `${agg.firstName || ""} ${agg.lastName || ""}`.trim();
    const fullName = this.sanitizeForSearch(rawFullName);
    const aggEmail = agg.emailKey?.toLowerCase().trim();
    const aggPhone = agg.phoneKey;

    try {
      // STEP 1: If we have a name, search by name first
      if (fullName) {
        const nameResponse: Response = await fetch(
          `https://services.leadconnectorhq.com/contacts/?locationId=${this.ghlLocationId}&query=${encodeURIComponent(fullName)}&limit=10`,
          {
            headers: {
              Authorization: `Bearer ${this.ghlApiKey}`,
              "Content-Type": "application/json",
              Version: "2021-07-28",
            },
          }
        );

        if (!nameResponse.ok) {
          const errorText = await nameResponse.text();
          return { error: `GHL API error ${nameResponse.status}: ${errorText}` };
        }

        const nameData: { contacts?: Array<{ id: string; email?: string; phone?: string; firstName?: string; lastName?: string }> } = await nameResponse.json();
        const nameContacts = nameData.contacts || [];

        // Check each contact found by name search - if email/phone matches, it's the same person
        // (name search returns fuzzy matches, so we verify with email/phone)
        for (const contact of nameContacts) {
          const contactEmail = contact.email?.toLowerCase().trim();
          const contactPhone = this.normalizePhone(contact.phone);

          // Email matches - accept even if name formatting differs
          if (aggEmail && contactEmail && aggEmail === contactEmail) {
            return { id: contact.id, matched: true, matchMethod: "name-search+email" };
          }

          // Phone matches - accept even if name formatting differs
          if (aggPhone && contactPhone && aggPhone === contactPhone) {
            return { id: contact.id, matched: true, matchMethod: "name-search+phone" };
          }
        }
      }

      // STEP 2: Fallback - search directly by email if available
      if (aggEmail) {
        const sanitizedEmail = this.sanitizeForSearch(aggEmail);
        const emailResponse: Response = await fetch(
          `https://services.leadconnectorhq.com/contacts/?locationId=${this.ghlLocationId}&query=${encodeURIComponent(sanitizedEmail)}&limit=5`,
          {
            headers: {
              Authorization: `Bearer ${this.ghlApiKey}`,
              "Content-Type": "application/json",
              Version: "2021-07-28",
            },
          }
        );

        if (!emailResponse.ok) {
          const errorText = await emailResponse.text();
          return { error: `GHL API error ${emailResponse.status}: ${errorText}` };
        }

        const emailData: { contacts?: Array<{ id: string; email?: string; phone?: string; firstName?: string; lastName?: string }> } = await emailResponse.json();
        const emailContacts = emailData.contacts || [];

        for (const contact of emailContacts) {
          const contactEmail = contact.email?.toLowerCase().trim();
          
          // Direct email match - update existing contact even if name differs
          if (contactEmail && aggEmail === contactEmail) {
            return { id: contact.id, matched: true, matchMethod: "email (direct)" };
          }
        }
      }

      // STEP 3: Fallback - search directly by phone if available
      if (aggPhone) {
        const sanitizedPhone = this.sanitizeForSearch(aggPhone);
        const phoneResponse: Response = await fetch(
          `https://services.leadconnectorhq.com/contacts/?locationId=${this.ghlLocationId}&query=${encodeURIComponent(sanitizedPhone)}&limit=5`,
          {
            headers: {
              Authorization: `Bearer ${this.ghlApiKey}`,
              "Content-Type": "application/json",
              Version: "2021-07-28",
            },
          }
        );

        if (!phoneResponse.ok) {
          const errorText = await phoneResponse.text();
          return { error: `GHL API error ${phoneResponse.status}: ${errorText}` };
        }

        const phoneData: { contacts?: Array<{ id: string; email?: string; phone?: string; firstName?: string; lastName?: string }> } = await phoneResponse.json();
        const phoneContacts = phoneData.contacts || [];

        for (const contact of phoneContacts) {
          const contactPhone = this.normalizePhone(contact.phone);
          
          // Direct phone match - update existing contact even if name differs
          if (contactPhone && aggPhone === contactPhone) {
            return { id: contact.id, matched: true, matchMethod: "phone (direct)" };
          }
        }
      }

      // STEP 4: No match found anywhere - should create new contact
      return { id: null, shouldCreate: true };
    } catch (error: any) {
      console.error("[CommerceAttribution] GHL contact search error:", error.message);
      return { error: error.message };
    }
  }

  /**
   * Create a new GHL contact with attribution data
   */
  private async createGHLContact(
    agg: AttributionAggregation,
    customFields: Array<{ id: string; value: any }>,
    tags: string[]
  ): Promise<{ id: string } | { error: string }> {
    try {
      // Add the special tag for contacts created by this sync
      const allTags = [...tags, "new contact from app sync"];

      const contactData: Record<string, any> = {
        locationId: this.ghlLocationId,
        firstName: agg.firstName || "",
        lastName: agg.lastName || "",
        tags: allTags,
        customFields,
      };

      if (agg.emailKey) {
        contactData.email = agg.emailKey;
      }
      if (agg.phoneKey) {
        contactData.phone = agg.phoneKey;
      }

      const response = await fetch(
        "https://services.leadconnectorhq.com/contacts/",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.ghlApiKey}`,
            "Content-Type": "application/json",
            Version: "2021-07-28",
          },
          body: JSON.stringify(contactData),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[CommerceAttribution] Failed to create GHL contact: ${response.status} - ${errorText}`);
        return { error: `GHL create contact error ${response.status}: ${errorText}` };
      }

      const result = await response.json();
      if (!result.contact?.id) {
        return { error: "GHL create contact returned no ID" };
      }
      return { id: result.contact.id };
    } catch (error: any) {
      console.error("[CommerceAttribution] Error creating GHL contact:", error.message);
      return { error: error.message };
    }
  }

  /**
   * Update GHL contact custom fields
   */
  private async updateGHLContact(
    contactId: string,
    customFields: Array<{ id: string; value: any }>
  ): Promise<void> {
    const response = await fetch(
      `https://services.leadconnectorhq.com/contacts/${contactId}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${this.ghlApiKey}`,
          "Content-Type": "application/json",
          Version: "2021-07-28",
        },
        body: JSON.stringify({
          customFields,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GHL update failed: ${response.status} - ${errorText}`);
    }
  }

  /**
   * Update GHL contact tags (add and remove)
   */
  private async updateGHLContactTags(
    contactId: string,
    tagsToAdd: string[],
    tagsToRemove: string[]
  ): Promise<void> {
    // First get current tags
    const getResponse = await fetch(
      `https://services.leadconnectorhq.com/contacts/${contactId}`,
      {
        headers: {
          Authorization: `Bearer ${this.ghlApiKey}`,
          "Content-Type": "application/json",
          Version: "2021-07-28",
        },
      }
    );

    if (!getResponse.ok) {
      return;
    }

    const contactData = await getResponse.json();
    const currentTags: string[] = contactData.contact?.tags || [];

    // Build new tags list
    const newTags = new Set(currentTags);
    for (const tag of tagsToRemove) {
      newTags.delete(tag);
    }
    for (const tag of tagsToAdd) {
      newTags.add(tag);
    }

    // Update tags
    await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${this.ghlApiKey}`,
        "Content-Type": "application/json",
        Version: "2021-07-28",
      },
      body: JSON.stringify({
        tags: Array.from(newTags),
      }),
    });
  }

  // Helper methods

  private normalizeEmail(email?: string): string | undefined {
    if (!email) return undefined;
    return email.toLowerCase().trim();
  }

  private normalizePhone(phone?: string): string | undefined {
    if (!phone) return undefined;
    // Basic normalization - remove non-digits, ensure starts with country code
    const digits = phone.replace(/\D/g, "");
    if (digits.length >= 10) {
      // Assume US if 10 digits
      return digits.length === 10 ? `+1${digits}` : `+${digits}`;
    }
    return undefined;
  }

  private async getSyncState(): Promise<CommerceAttributionSyncState | null> {
    const [state] = await getDb()
      .select()
      .from(commerceAttributionSyncState)
      .where(eq(commerceAttributionSyncState.userId, this.userId));
    return state || null;
  }

  private async acquireLock(): Promise<{ acquired: boolean; message?: string }> {
    // Ensure sync state exists
    const existing = await this.getSyncState();
    if (!existing) {
      await getDb().insert(commerceAttributionSyncState).values({
        userId: this.userId,
        isRunning: true,
        runningJobId: crypto.randomUUID(),
      });
      return { acquired: true };
    }

    if (existing.isRunning) {
      return { acquired: false, message: "Sync already running" };
    }

    await getDb()
      .update(commerceAttributionSyncState)
      .set({ isRunning: true, runningJobId: crypto.randomUUID() })
      .where(eq(commerceAttributionSyncState.userId, this.userId));

    return { acquired: true };
  }

  private async releaseLock(): Promise<void> {
    await getDb()
      .update(commerceAttributionSyncState)
      .set({ isRunning: false, runningJobId: null })
      .where(eq(commerceAttributionSyncState.userId, this.userId));
  }

  private async createSyncRun(mode: string): Promise<CommerceAttributionSyncRun> {
    const [run] = await getDb()
      .insert(commerceAttributionSyncRuns)
      .values({
        userId: this.userId,
        mode,
        status: CommerceAttributionSyncStatus.RUNNING,
      })
      .returning();
    return run;
  }

  private async updateSyncRun(
    runId: string,
    status: string,
    stats: {
      ordersProcessed: number;
      customersUpdated: number;
      contactsUpdated: number;
      contactsMatched: number;
      contactsCreated: number;
      errors: number;
    }
  ): Promise<void> {
    await getDb()
      .update(commerceAttributionSyncRuns)
      .set({
        status,
        finishedAt: new Date(),
        ordersProcessed: stats.ordersProcessed,
        customersUpdated: stats.customersUpdated,
        contactsUpdated: stats.contactsUpdated,
        contactsMatched: stats.contactsMatched,
        contactsCreated: stats.contactsCreated,
        errorCount: stats.errors,
      })
      .where(and(
        eq(commerceAttributionSyncRuns.id, runId),
        eq(commerceAttributionSyncRuns.userId, this.userId)
      ));
  }

  private async updateSyncRunProgress(stats: {
    ordersProcessed: number;
    customersUpdated: number;
    contactsUpdated: number;
    contactsMatched: number;
    contactsCreated: number;
    errors: number;
  }): Promise<void> {
    if (!this.runId) return;
    
    await getDb()
      .update(commerceAttributionSyncRuns)
      .set({
        ordersProcessed: stats.ordersProcessed,
        customersUpdated: stats.customersUpdated,
        contactsUpdated: stats.contactsUpdated,
        contactsMatched: stats.contactsMatched,
        contactsCreated: stats.contactsCreated,
        errorCount: stats.errors,
      })
      .where(and(
        eq(commerceAttributionSyncRuns.id, this.runId),
        eq(commerceAttributionSyncRuns.userId, this.userId)
      ));
  }

  private async markBackfillComplete(): Promise<void> {
    await getDb()
      .update(commerceAttributionSyncState)
      .set({
        backfillComplete: true,
        lastBackfillCompletedAt: new Date(),
        lastSyncedAt: new Date(),
      })
      .where(eq(commerceAttributionSyncState.userId, this.userId));
  }

  private async logError(
    entityType: string,
    entityId: string | null,
    code: string,
    message: string
  ): Promise<void> {
    if (!this.runId) return;

    await getDb().insert(commerceAttributionSyncErrors).values({
      runId: this.runId,
      entityType,
      entityId,
      code,
      message,
    });

    await getDb()
      .update(commerceAttributionSyncRuns)
      .set({ errorCount: drizzleSql`error_count + 1` })
      .where(eq(commerceAttributionSyncRuns.id, this.runId));
  }

  private async getExistingCustomer(
    emailKey?: string,
    phoneKey?: string
  ): Promise<CommerceAttributionCustomer | null> {
    if (emailKey) {
      const [customer] = await getDb()
        .select()
        .from(commerceAttributionCustomers)
        .where(
          and(
            eq(commerceAttributionCustomers.userId, this.userId),
            eq(commerceAttributionCustomers.emailKey, emailKey)
          )
        );
      if (customer) return customer;
    }

    if (phoneKey) {
      const [customer] = await getDb()
        .select()
        .from(commerceAttributionCustomers)
        .where(
          and(
            eq(commerceAttributionCustomers.userId, this.userId),
            eq(commerceAttributionCustomers.phoneKey, phoneKey)
          )
        );
      if (customer) return customer;
    }

    return null;
  }

  private mergeAggregations(
    existing: CommerceAttributionCustomer | null,
    incoming: AttributionAggregation
  ): AttributionAggregation {
    if (!existing) return incoming;

    const existingFirstAt = existing.firstOrderAt ? new Date(existing.firstOrderAt) : null;
    const existingLastAt = existing.lastOrderAt ? new Date(existing.lastOrderAt) : null;

    return {
      emailKey: incoming.emailKey || existing.emailKey || undefined,
      phoneKey: incoming.phoneKey || existing.phoneKey || undefined,
      // Preserve existing names if incoming has none (don't overwrite with empty)
      firstName: incoming.firstName || (existing as any).firstName || undefined,
      lastName: incoming.lastName || (existing as any).lastName || undefined,
      firstOrderId:
        existingFirstAt && existingFirstAt < incoming.firstOrderAt
          ? existing.firstOrderId!
          : incoming.firstOrderId,
      firstOrderAt:
        existingFirstAt && existingFirstAt < incoming.firstOrderAt
          ? existingFirstAt
          : incoming.firstOrderAt,
      firstSource:
        existingFirstAt && existingFirstAt < incoming.firstOrderAt
          ? existing.firstSource!
          : incoming.firstSource,
      lastOrderId:
        existingLastAt && existingLastAt > incoming.lastOrderAt
          ? existing.lastOrderId!
          : incoming.lastOrderId,
      lastOrderAt:
        existingLastAt && existingLastAt > incoming.lastOrderAt
          ? existingLastAt
          : incoming.lastOrderAt,
      lastSource:
        existingLastAt && existingLastAt > incoming.lastOrderAt
          ? existing.lastSource!
          : incoming.lastSource,
      purchaseCount: existing.purchaseCount + incoming.purchaseCount,
      lifetimeValueCents: existing.lifetimeValueCents + incoming.lifetimeValueCents,
      sourcesSet: this.mergeSourcesSets(existing.sourcesSet || "", incoming.sourcesSet),
    };
  }

  private mergeSourcesSets(existing: string, incoming: string): string {
    const sources = new Set([
      ...existing.split(",").filter(Boolean),
      ...incoming.split(",").filter(Boolean),
    ]);
    if (sources.size > 1) {
      sources.delete(CommerceSource.UNKNOWN);
    }
    return Array.from(sources).sort().join(",");
  }
}

/**
 * Get sync status for a user
 */
export async function getCommerceAttributionSyncStatus(
  userId: string
): Promise<{
  isRunning: boolean;
  backfillComplete: boolean;
  lastSyncedAt?: Date;
  lastRun?: {
    id: string;
    mode: string;
    status: string;
    ordersProcessed: number;
    customersUpdated: number;
    contactsUpdated: number;
    errorCount: number;
    startedAt: Date;
    finishedAt?: Date;
  };
}> {
  const [state] = await getDb()
    .select()
    .from(commerceAttributionSyncState)
    .where(eq(commerceAttributionSyncState.userId, userId));

  const [lastRun] = await getDb()
    .select()
    .from(commerceAttributionSyncRuns)
    .where(eq(commerceAttributionSyncRuns.userId, userId))
    .orderBy(desc(commerceAttributionSyncRuns.startedAt))
    .limit(1);

  return {
    isRunning: state?.isRunning || false,
    backfillComplete: state?.backfillComplete || false,
    lastSyncedAt: state?.lastSyncedAt || undefined,
    lastRun: lastRun
      ? {
          id: lastRun.id,
          mode: lastRun.mode,
          status: lastRun.status,
          ordersProcessed: lastRun.ordersProcessed,
          customersUpdated: lastRun.customersUpdated,
          contactsUpdated: lastRun.contactsUpdated,
          errorCount: lastRun.errorCount,
          startedAt: lastRun.startedAt,
          finishedAt: lastRun.finishedAt || undefined,
        }
      : undefined,
  };
}

/**
 * Get recent sync errors
 */
export async function getCommerceAttributionSyncErrors(
  runId: string,
  limit = 50
): Promise<Array<{
  id: string;
  entityType: string;
  entityId?: string;
  code: string;
  message: string;
  createdAt: Date;
}>> {
  const errors = await getDb()
    .select()
    .from(commerceAttributionSyncErrors)
    .where(eq(commerceAttributionSyncErrors.runId, runId))
    .orderBy(desc(commerceAttributionSyncErrors.createdAt))
    .limit(limit);

  return errors.map((e) => ({
    id: e.id,
    entityType: e.entityType,
    entityId: e.entityId || undefined,
    code: e.code,
    message: e.message,
    createdAt: e.createdAt,
  }));
}
