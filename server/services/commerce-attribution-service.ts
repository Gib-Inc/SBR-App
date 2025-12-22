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

// GHL Tag IDs from the prompt
const GHL_TAG_IDS = {
  srcFirstAmazon: "T6ZSk1QJVMVic0aeeYDO",
  srcFirstShopify: "h7wDFKmSw83LaXQ18flg",
  srcFirstUnknown: "6xB0AtCzlQpicv7MmBHh",
  srcLatestAmazon: "RNNReOFEKclM6KeiYfeq",
  srcLatestShopify: "y7REy3Fua1RmEHsbIsWQ",
  srcLatestUnknown: "W2im5PmmInK8u1hmZ0bg",
  buyerMultiple: "Usy0iBWEJsWSQ3eYHYeT",
  buyerOnce: "I7D6zT7GpQOcWeMLpWht",
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
        }
        billingAddress {
          phone
        }
        shippingAddress {
          phone
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

interface ShopifyGraphQLOrder {
  id: string;
  name: string;
  createdAt: string;
  email?: string;
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
  };
  billingAddress?: {
    phone?: string;
  };
  shippingAddress?: {
    phone?: string;
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
      this.ghlApiKey = ghlConfig.apiKey || "";
      this.ghlLocationId = ghlConfigData.locationId || "";

      if (!this.ghlApiKey || !this.ghlLocationId) {
        return { success: false, error: "GoHighLevel credentials not configured" };
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
    const runs = await getDb().query.commerceAttributionSyncRuns.findMany({
      where: eq(commerceAttributionSyncRuns.userId, this.userId),
      orderBy: [desc(commerceAttributionSyncRuns.startedAt)],
      limit,
    });
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
        eq(commerceAttributionCustomers.latestSource, sourceFilter as typeof CommerceSource.AMAZON | typeof CommerceSource.SHOPIFY | typeof CommerceSource.UNKNOWN)
      )!;
    }

    const customers = await getDb().query.commerceAttributionCustomers.findMany({
      where: whereClause,
      orderBy: [desc(commerceAttributionCustomers.lastPurchaseAt)],
      limit,
      offset,
    });

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
        errors: 1,
      });
    }
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

      let stats: { ordersProcessed: number; customersUpdated: number; contactsUpdated: number; errors: number };

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
      return { ordersProcessed: 0, customersUpdated: 0, contactsUpdated: 0, errors: 0 };
    }

    // Check if we got historical orders (older than 60 days)
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
    const oldestOrder = orders[0]; // Orders are sorted oldest first
    if (new Date(oldestOrder.createdAt) > sixtyDaysAgo && orders.length > 100) {
      // If we have many orders but none older than 60 days, we might be missing read_all_orders scope
      await this.logError(
        "api",
        null,
        "POSSIBLE_MISSING_READ_ALL_ORDERS",
        "Orders only go back 60 days. If you have older orders, the app may need read_all_orders scope."
      );
    }

    console.log(`[CommerceAttribution] Fetched ${orders.length} orders`);

    // Aggregate by customer
    const aggregations = await this.aggregateOrders(orders);

    console.log(`[CommerceAttribution] Aggregated ${aggregations.size} unique customers`);

    // Update customer records and sync to GHL
    let customersUpdated = 0;
    let contactsUpdated = 0;
    let errors = 0;

    for (const [key, agg] of aggregations) {
      try {
        await this.upsertCustomerAttribution(agg);
        customersUpdated++;

        // Sync to GHL
        const ghlResult = await this.syncToGHL(agg);
        if (ghlResult.success) {
          contactsUpdated++;
        } else if (ghlResult.notFound) {
          // Contact not found in GHL - log but don't count as error
        } else {
          errors++;
        }
      } catch (error: any) {
        errors++;
        await this.logError("customer", key, "CUSTOMER_UPDATE_FAILED", error.message);
      }
    }

    return {
      ordersProcessed: orders.length,
      customersUpdated,
      contactsUpdated,
      errors,
    };
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
      return { ordersProcessed: 0, customersUpdated: 0, contactsUpdated: 0, errors: 0 };
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

    // For each impacted customer, fetch ALL their orders and re-aggregate
    let customersUpdated = 0;
    let contactsUpdated = 0;
    let errors = 0;

    // For simplicity, just aggregate the new orders (full re-aggregation would require fetching all orders again)
    const aggregations = await this.aggregateOrders(orders);

    for (const [key, agg] of aggregations) {
      try {
        // Merge with existing customer data
        const existing = await this.getExistingCustomer(agg.emailKey, agg.phoneKey);
        const merged = this.mergeAggregations(existing, agg);

        await this.upsertCustomerAttribution(merged);
        customersUpdated++;

        const ghlResult = await this.syncToGHL(merged);
        if (ghlResult.success) {
          contactsUpdated++;
        } else if (!ghlResult.notFound) {
          errors++;
        }
      } catch (error: any) {
        errors++;
        await this.logError("customer", key, "CUSTOMER_UPDATE_FAILED", error.message);
      }
    }

    // Update last synced timestamp
    await getDb()
      .update(commerceAttributionSyncState)
      .set({ lastSyncedAt: new Date() })
      .where(eq(commerceAttributionSyncState.userId, this.userId));

    return {
      ordersProcessed: orders.length,
      customersUpdated,
      contactsUpdated,
      errors,
    };
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

        const data = await response.json();

        if (data.errors) {
          throw new Error(`Shopify GraphQL errors: ${JSON.stringify(data.errors)}`);
        }

        const orders = data.data?.orders;
        if (!orders) {
          throw new Error("No orders data in response");
        }

        for (const edge of orders.edges) {
          allOrders.push(edge.node);
        }

        hasNextPage = orders.pageInfo.hasNextPage;
        cursor = orders.pageInfo.endCursor;

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
              }
              billingAddress {
                phone
              }
              shippingAddress {
                phone
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

      const data = await response.json();
      const orders = data.data?.orders;

      if (!orders) break;

      for (const edge of orders.edges) {
        allOrders.push(edge.node);
      }

      hasNextPage = orders.pageInfo.hasNextPage;
      cursor = orders.pageInfo.endCursor;

      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    return allOrders;
  }

  /**
   * Classify order source (amazon, shopify, unknown)
   */
  private classifyOrderSource(order: ShopifyGraphQLOrder): string {
    const channelInfo = order.channelInformation;
    const channelHandle = channelInfo?.channelDefinition?.handle?.toLowerCase() || "";
    const channelName = channelInfo?.channelDefinition?.channelName?.toLowerCase() || "";
    const appTitle = channelInfo?.app?.title?.toLowerCase() || "";
    const tags = order.tags.map((t) => t.toLowerCase());

    // Check channel handle
    if (channelHandle === "web" || channelName.includes("online store")) {
      return CommerceSource.SHOPIFY;
    }

    // Check for Amazon indicators
    if (
      channelHandle.includes("amazon") ||
      channelName.includes("amazon") ||
      appTitle.includes("amazon")
    ) {
      return CommerceSource.AMAZON;
    }

    // Check tags for Amazon
    if (
      tags.some(
        (t) => t === "amzn" || t === "amazon" || t.includes("amzn orders")
      )
    ) {
      return CommerceSource.AMAZON;
    }

    // If channel handle is present but not recognized, it's likely a marketplace
    if (channelHandle && channelHandle !== "web") {
      return CommerceSource.UNKNOWN;
    }

    // Default to Shopify for web orders, unknown otherwise
    return CommerceSource.UNKNOWN;
  }

  /**
   * Aggregate orders by customer
   */
  private async aggregateOrders(
    orders: ShopifyGraphQLOrder[]
  ): Promise<Map<string, AttributionAggregation>> {
    const aggregations = new Map<string, AttributionAggregation>();

    for (const order of orders) {
      // Skip cancelled/voided orders
      if (
        order.displayFinancialStatus === "VOIDED" ||
        order.displayFinancialStatus === "REFUNDED"
      ) {
        continue;
      }

      const emailKey = this.normalizeEmail(order.customer?.email || order.email);
      const phoneKey = this.normalizePhone(
        order.customer?.phone || order.shippingAddress?.phone || order.billingAddress?.phone
      );

      if (!emailKey && !phoneKey) {
        // Can't aggregate without identity
        continue;
      }

      // Use email as primary key, fallback to phone
      const customerKey = emailKey || phoneKey!;
      const source = this.classifyOrderSource(order);
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

    return aggregations;
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
   * Sync attribution to GHL contact
   */
  private async syncToGHL(
    agg: AttributionAggregation
  ): Promise<{ success: boolean; notFound?: boolean; error?: string }> {
    try {
      // Find GHL contact by email or phone
      const contact = await this.findGHLContact(agg.emailKey, agg.phoneKey);

      if (!contact) {
        return { success: false, notFound: true };
      }

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

      // Build tags to add/remove
      const tagsToAdd: string[] = [];
      const tagsToRemove: string[] = [];

      // First source tags
      if (agg.firstSource === CommerceSource.AMAZON) {
        tagsToAdd.push(GHL_TAG_IDS.srcFirstAmazon);
        tagsToRemove.push(GHL_TAG_IDS.srcFirstShopify, GHL_TAG_IDS.srcFirstUnknown);
      } else if (agg.firstSource === CommerceSource.SHOPIFY) {
        tagsToAdd.push(GHL_TAG_IDS.srcFirstShopify);
        tagsToRemove.push(GHL_TAG_IDS.srcFirstAmazon, GHL_TAG_IDS.srcFirstUnknown);
      } else {
        tagsToAdd.push(GHL_TAG_IDS.srcFirstUnknown);
        tagsToRemove.push(GHL_TAG_IDS.srcFirstAmazon, GHL_TAG_IDS.srcFirstShopify);
      }

      // Latest source tags
      if (agg.lastSource === CommerceSource.AMAZON) {
        tagsToAdd.push(GHL_TAG_IDS.srcLatestAmazon);
        tagsToRemove.push(GHL_TAG_IDS.srcLatestShopify, GHL_TAG_IDS.srcLatestUnknown);
      } else if (agg.lastSource === CommerceSource.SHOPIFY) {
        tagsToAdd.push(GHL_TAG_IDS.srcLatestShopify);
        tagsToRemove.push(GHL_TAG_IDS.srcLatestAmazon, GHL_TAG_IDS.srcLatestUnknown);
      } else {
        tagsToAdd.push(GHL_TAG_IDS.srcLatestUnknown);
        tagsToRemove.push(GHL_TAG_IDS.srcLatestAmazon, GHL_TAG_IDS.srcLatestShopify);
      }

      // Buyer frequency tags
      if (agg.purchaseCount >= 2) {
        tagsToAdd.push(GHL_TAG_IDS.buyerMultiple);
        tagsToRemove.push(GHL_TAG_IDS.buyerOnce);
      } else {
        tagsToAdd.push(GHL_TAG_IDS.buyerOnce);
        tagsToRemove.push(GHL_TAG_IDS.buyerMultiple);
      }

      // Update contact with custom fields
      await this.updateGHLContact(contact.id, customFields);

      // Update tags
      await this.updateGHLContactTags(contact.id, tagsToAdd, tagsToRemove);

      // Update our record with GHL contact ID
      if (agg.emailKey) {
        await getDb()
          .update(commerceAttributionCustomers)
          .set({ ghlContactId: contact.id, ghlLastSyncAt: new Date() })
          .where(
            and(
              eq(commerceAttributionCustomers.userId, this.userId),
              eq(commerceAttributionCustomers.emailKey, agg.emailKey)
            )
          );
      }

      return { success: true };
    } catch (error: any) {
      console.error("[CommerceAttribution] GHL sync error:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Find GHL contact by email or phone
   */
  private async findGHLContact(
    email?: string,
    phone?: string
  ): Promise<{ id: string } | null> {
    const searchValue = email || phone;
    if (!searchValue) return null;

    try {
      const response = await fetch(
        `https://services.leadconnectorhq.com/contacts/?locationId=${this.ghlLocationId}&query=${encodeURIComponent(searchValue)}&limit=1`,
        {
          headers: {
            Authorization: `Bearer ${this.ghlApiKey}`,
            "Content-Type": "application/json",
            Version: "2021-07-28",
          },
        }
      );

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      const contacts = data.contacts || [];

      if (contacts.length === 0) {
        return null;
      }

      return { id: contacts[0].id };
    } catch {
      return null;
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
        errorCount: stats.errors,
      })
      .where(and(
        eq(commerceAttributionSyncRuns.id, runId),
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
