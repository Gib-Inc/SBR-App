/**
 * QuickBooks Online API Client
 * V1 Scope: Read-only historical sales sync + PO→Bill creation
 * 
 * SAFETY RULES:
 * - NO creating/modifying QuickBooks sales documents (Invoices, SalesReceipts, Payments)
 * - NO inventory write-back to QuickBooks
 * - QuickBooks is the single source of truth for revenue history
 * - All actions logged to AI Logs for audit trail
 */

import { AuditLogger } from './audit-logger';
import type { IStorage } from '../storage';
import type { 
  QuickbooksAuth, 
  QuickbooksSalesSnapshot, 
  PurchaseOrder,
  PurchaseOrderLine,
  Supplier,
  Item
} from '@shared/schema';

// QuickBooks API response types
interface QBTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
  x_refresh_token_expires_in: number; // seconds
}

interface QBCompanyInfo {
  CompanyName?: string;
  LegalName?: string;
}

interface QBLineItem {
  Id?: string;
  Description?: string;
  Amount?: number;
  DetailType?: string;
  SalesItemLineDetail?: {
    ItemRef?: { value: string; name?: string };
    Qty?: number;
    UnitPrice?: number;
  };
}

interface QBInvoice {
  Id: string;
  DocNumber?: string;
  TxnDate: string;
  Line: QBLineItem[];
  TotalAmt?: number;
  CustomerRef?: { value: string; name?: string };
}

interface QBSalesReceipt {
  Id: string;
  DocNumber?: string;
  TxnDate: string;
  Line: QBLineItem[];
  TotalAmt?: number;
  CustomerRef?: { value: string; name?: string };
}

interface QBVendor {
  Id: string;
  DisplayName: string;
  PrimaryEmailAddr?: { Address: string };
  PrimaryPhone?: { FreeFormNumber: string };
}

interface QBItem {
  Id: string;
  Name: string;
  Sku?: string;
  Type: string;
}

interface QBBill {
  Id: string;
  DocNumber?: string;
  VendorRef: { value: string; name?: string };
  TxnDate: string;
  DueDate?: string;
  TotalAmt: number;
  Line: Array<{
    Id?: string;
    Amount: number;
    Description?: string;
    DetailType: string;
    ItemBasedExpenseLineDetail?: {
      ItemRef: { value: string; name?: string };
      Qty: number;
      UnitPrice: number;
    };
    AccountBasedExpenseLineDetail?: {
      AccountRef: { value: string; name?: string };
    };
  }>;
}

// Normalized sales line for aggregation
interface NormalizedSalesLine {
  sku: string;
  productName: string;
  qty: number;
  amount: number;
  date: Date;
  source: 'invoice' | 'salesreceipt';
  docNumber: string;
}

export class QuickBooksClient {
  private storage: IStorage;
  private baseUrl: string;
  private auth: QuickbooksAuth | null = null;
  private userId: string;

  // QuickBooks OAuth endpoints
  private static readonly TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
  private static readonly API_BASE = 'https://quickbooks.api.intuit.com/v3/company';

  constructor(storage: IStorage, userId: string) {
    this.storage = storage;
    this.userId = userId;
    this.baseUrl = QuickBooksClient.API_BASE;
  }

  /**
   * Initialize client by loading auth from database
   */
  async initialize(): Promise<boolean> {
    try {
      this.auth = await this.storage.getQuickbooksAuth(this.userId);
      if (!this.auth) {
        console.log('[QuickBooks] No auth found for user');
        return false;
      }
      
      // Check if tokens need refresh
      if (this.isAccessTokenExpired()) {
        const refreshed = await this.refreshTokens();
        if (!refreshed) {
          console.log('[QuickBooks] Token refresh failed');
          return false;
        }
      }
      
      return true;
    } catch (error) {
      console.error('[QuickBooks] Initialize error:', error);
      return false;
    }
  }

  /**
   * Check if access token is expired (with 5 minute buffer)
   */
  private isAccessTokenExpired(): boolean {
    if (!this.auth) return true;
    const expiresAt = new Date(this.auth.accessTokenExpiresAt);
    const now = new Date();
    const bufferMs = 5 * 60 * 1000; // 5 minutes
    return now.getTime() + bufferMs >= expiresAt.getTime();
  }

  /**
   * Refresh OAuth tokens
   */
  private async refreshTokens(): Promise<boolean> {
    if (!this.auth) return false;

    const clientId = process.env.QUICKBOOKS_CLIENT_ID;
    const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      console.error('[QuickBooks] Missing client credentials');
      return false;
    }

    try {
      const response = await fetch(QuickBooksClient.TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: this.auth.refreshToken,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[QuickBooks] Token refresh failed:', errorText);
        await this.storage.updateQuickbooksAuth(this.auth.id, { isConnected: false });
        return false;
      }

      const tokens: QBTokenResponse = await response.json();
      
      const now = new Date();
      const accessTokenExpiresAt = new Date(now.getTime() + tokens.expires_in * 1000);
      const refreshTokenExpiresAt = new Date(now.getTime() + tokens.x_refresh_token_expires_in * 1000);

      await this.storage.updateQuickbooksAuth(this.auth.id, {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        accessTokenExpiresAt,
        refreshTokenExpiresAt,
        updatedAt: now,
      });

      // Reload auth
      this.auth = await this.storage.getQuickbooksAuth(this.userId);
      console.log('[QuickBooks] Tokens refreshed successfully');
      return true;
    } catch (error) {
      console.error('[QuickBooks] Token refresh error:', error);
      return false;
    }
  }

  /**
   * Make authenticated API request
   */
  private async apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    if (!this.auth) {
      throw new Error('QuickBooks not authenticated');
    }

    // Ensure tokens are fresh
    if (this.isAccessTokenExpired()) {
      const refreshed = await this.refreshTokens();
      if (!refreshed) {
        throw new Error('Failed to refresh QuickBooks tokens');
      }
    }

    const url = `${this.baseUrl}/${this.auth.realmId}${endpoint}`;
    const headers = {
      'Authorization': `Bearer ${this.auth.accessToken}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...options.headers,
    };

    const response = await fetch(url, { ...options, headers });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`QuickBooks API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    return response.json();
  }

  /**
   * Test the QuickBooks connection
   */
  async testConnection(): Promise<{ success: boolean; message: string; companyName?: string }> {
    try {
      const initialized = await this.initialize();
      if (!initialized) {
        return { success: false, message: 'QuickBooks not connected. Please authenticate first.' };
      }

      const data = await this.apiRequest<{ CompanyInfo: QBCompanyInfo }>('/companyinfo/' + this.auth!.realmId);
      const companyName = data.CompanyInfo?.CompanyName || data.CompanyInfo?.LegalName || 'Unknown Company';

      await AuditLogger.logEvent({
        source: 'QUICKBOOKS',
        eventType: 'CONNECTION_TEST',
        status: 'INFO',
        description: `QuickBooks connection test successful: ${companyName}`,
      });

      return {
        success: true,
        message: `Connected to ${companyName}`,
        companyName,
      };
    } catch (error: any) {
      await AuditLogger.logEvent({
        source: 'QUICKBOOKS',
        eventType: 'CONNECTION_TEST',
        status: 'ERROR',
        description: `QuickBooks connection test failed: ${error.message}`,
      });

      return {
        success: false,
        message: error.message || 'Failed to connect to QuickBooks',
      };
    }
  }

  /**
   * Fetch historical sales data from QuickBooks (READ-ONLY)
   * Returns normalized line-level sales data from Invoices and SalesReceipts
   */
  async fetchSalesHistory(startDate: Date, endDate: Date): Promise<NormalizedSalesLine[]> {
    const initialized = await this.initialize();
    if (!initialized) {
      throw new Error('QuickBooks not connected');
    }

    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];
    const results: NormalizedSalesLine[] = [];

    // Fetch Invoices
    try {
      const invoiceQuery = encodeURIComponent(
        `SELECT * FROM Invoice WHERE TxnDate >= '${startStr}' AND TxnDate <= '${endStr}' MAXRESULTS 1000`
      );
      const invoiceData = await this.apiRequest<{ QueryResponse: { Invoice?: QBInvoice[] } }>(
        `/query?query=${invoiceQuery}`
      );

      for (const invoice of invoiceData.QueryResponse?.Invoice || []) {
        const txnDate = new Date(invoice.TxnDate);
        for (const line of invoice.Line || []) {
          if (line.SalesItemLineDetail) {
            const detail = line.SalesItemLineDetail;
            const sku = detail.ItemRef?.value || 'UNKNOWN';
            const productName = detail.ItemRef?.name || line.Description || 'Unknown Product';
            
            results.push({
              sku,
              productName,
              qty: detail.Qty || 1,
              amount: line.Amount || 0,
              date: txnDate,
              source: 'invoice',
              docNumber: invoice.DocNumber || invoice.Id,
            });
          }
        }
      }
    } catch (error) {
      console.error('[QuickBooks] Error fetching invoices:', error);
    }

    // Fetch SalesReceipts
    try {
      const receiptQuery = encodeURIComponent(
        `SELECT * FROM SalesReceipt WHERE TxnDate >= '${startStr}' AND TxnDate <= '${endStr}' MAXRESULTS 1000`
      );
      const receiptData = await this.apiRequest<{ QueryResponse: { SalesReceipt?: QBSalesReceipt[] } }>(
        `/query?query=${receiptQuery}`
      );

      for (const receipt of receiptData.QueryResponse?.SalesReceipt || []) {
        const txnDate = new Date(receipt.TxnDate);
        for (const line of receipt.Line || []) {
          if (line.SalesItemLineDetail) {
            const detail = line.SalesItemLineDetail;
            const sku = detail.ItemRef?.value || 'UNKNOWN';
            const productName = detail.ItemRef?.name || line.Description || 'Unknown Product';
            
            results.push({
              sku,
              productName,
              qty: detail.Qty || 1,
              amount: line.Amount || 0,
              date: txnDate,
              source: 'salesreceipt',
              docNumber: receipt.DocNumber || receipt.Id,
            });
          }
        }
      }
    } catch (error) {
      console.error('[QuickBooks] Error fetching sales receipts:', error);
    }

    return results;
  }

  /**
   * Sync sales history to snapshots table (idempotent upsert by SKU + year + month)
   */
  async syncSalesSnapshots(sinceYears: number = 3): Promise<{ 
    success: boolean; 
    message: string; 
    snapshotsCreated: number;
    snapshotsUpdated: number;
  }> {
    try {
      const initialized = await this.initialize();
      if (!initialized) {
        return { success: false, message: 'QuickBooks not connected', snapshotsCreated: 0, snapshotsUpdated: 0 };
      }

      const endDate = new Date();
      const startDate = new Date();
      startDate.setFullYear(startDate.getFullYear() - sinceYears);

      console.log(`[QuickBooks] Syncing sales from ${startDate.toISOString()} to ${endDate.toISOString()}`);

      const salesLines = await this.fetchSalesHistory(startDate, endDate);
      console.log(`[QuickBooks] Fetched ${salesLines.length} sales lines`);

      // Aggregate by SKU + year + month
      const aggregations = new Map<string, { 
        sku: string; 
        productName: string;
        year: number; 
        month: number; 
        totalQty: number; 
        totalRevenue: number;
      }>();

      for (const line of salesLines) {
        const year = line.date.getFullYear();
        const month = line.date.getMonth() + 1; // 1-12
        const key = `${line.sku}-${year}-${month}`;

        const existing = aggregations.get(key);
        if (existing) {
          existing.totalQty += line.qty;
          existing.totalRevenue += line.amount;
        } else {
          aggregations.set(key, {
            sku: line.sku,
            productName: line.productName,
            year,
            month,
            totalQty: line.qty,
            totalRevenue: line.amount,
          });
        }
      }

      // Upsert snapshots
      let created = 0;
      let updated = 0;

      for (const agg of aggregations.values()) {
        const result = await this.storage.upsertQuickbooksSalesSnapshot({
          sku: agg.sku,
          productName: agg.productName,
          year: agg.year,
          month: agg.month,
          totalQty: agg.totalQty,
          totalRevenue: agg.totalRevenue,
          source: 'quickbooks',
        });

        if (result.isNew) {
          created++;
        } else {
          updated++;
        }
      }

      // Update last sync timestamp
      if (this.auth) {
        await this.storage.updateQuickbooksAuth(this.auth.id, {
          lastSalesSyncAt: new Date(),
          lastSalesSyncStatus: 'SUCCESS',
        });
      }

      // Log to AI Logs
      await AuditLogger.logEvent({
        source: 'QUICKBOOKS',
        eventType: 'SALES_SYNC',
        status: 'INFO',
        description: `QuickBooks sales sync completed: ${created} created, ${updated} updated from ${salesLines.length} transactions`,
        details: {
          sinceYears,
          transactionsProcessed: salesLines.length,
          snapshotsCreated: created,
          snapshotsUpdated: updated,
          dateRange: { start: startDate.toISOString(), end: endDate.toISOString() },
        },
      });

      return {
        success: true,
        message: `Synced ${salesLines.length} transactions: ${created} new, ${updated} updated`,
        snapshotsCreated: created,
        snapshotsUpdated: updated,
      };
    } catch (error: any) {
      // Update last sync status
      if (this.auth) {
        await this.storage.updateQuickbooksAuth(this.auth.id, {
          lastSalesSyncStatus: 'FAILED',
        });
      }

      // Log error
      await AuditLogger.logEvent({
        source: 'QUICKBOOKS',
        eventType: 'SALES_SYNC_ERROR',
        status: 'ERROR',
        description: `QuickBooks sales sync failed: ${error.message}`,
        details: { error: error.message },
      });

      return {
        success: false,
        message: error.message || 'Sales sync failed',
        snapshotsCreated: 0,
        snapshotsUpdated: 0,
      };
    }
  }

  /**
   * Find or create a QuickBooks Vendor from our Supplier
   */
  private async findOrCreateVendor(supplier: Supplier): Promise<string> {
    // Check if mapping exists
    const existingMapping = await this.storage.getQuickbooksVendorMapping(supplier.id);
    if (existingMapping) {
      return existingMapping.quickbooksVendorId;
    }

    // Search for existing vendor by name
    const searchQuery = encodeURIComponent(`SELECT * FROM Vendor WHERE DisplayName = '${supplier.name.replace(/'/g, "\\'")}'`);
    const searchResult = await this.apiRequest<{ QueryResponse: { Vendor?: QBVendor[] } }>(
      `/query?query=${searchQuery}`
    );

    if (searchResult.QueryResponse?.Vendor?.length) {
      const vendor = searchResult.QueryResponse.Vendor[0];
      // Create mapping
      await this.storage.createQuickbooksVendorMapping({
        supplierId: supplier.id,
        quickbooksVendorId: vendor.Id,
        quickbooksVendorName: vendor.DisplayName,
      });
      return vendor.Id;
    }

    // Create new vendor
    const vendorData = {
      DisplayName: supplier.name,
      PrimaryEmailAddr: supplier.email ? { Address: supplier.email } : undefined,
      PrimaryPhone: supplier.phone ? { FreeFormNumber: supplier.phone } : undefined,
    };

    const createResult = await this.apiRequest<{ Vendor: QBVendor }>('/vendor', {
      method: 'POST',
      body: JSON.stringify(vendorData),
    });

    const newVendor = createResult.Vendor;
    
    // Create mapping
    await this.storage.createQuickbooksVendorMapping({
      supplierId: supplier.id,
      quickbooksVendorId: newVendor.Id,
      quickbooksVendorName: newVendor.DisplayName,
    });

    await AuditLogger.logEvent({
      source: 'QUICKBOOKS',
      eventType: 'VENDOR_CREATED',
      entityType: 'SUPPLIER',
      entityId: supplier.id,
      status: 'INFO',
      description: `Created QuickBooks Vendor "${newVendor.DisplayName}" for supplier`,
    });

    return newVendor.Id;
  }

  /**
   * Find QuickBooks Item by SKU or get fallback inventory purchase account
   */
  private async findItemOrFallback(sku: string, itemId: string): Promise<{ itemId: string | null; useAccount: boolean }> {
    // Check if mapping exists
    const existingMapping = await this.storage.getQuickbooksItemMapping(itemId);
    if (existingMapping) {
      return { itemId: existingMapping.quickbooksItemId, useAccount: false };
    }

    // Search for item by SKU
    const searchQuery = encodeURIComponent(`SELECT * FROM Item WHERE Sku = '${sku.replace(/'/g, "\\'")}'`);
    const searchResult = await this.apiRequest<{ QueryResponse: { Item?: QBItem[] } }>(
      `/query?query=${searchQuery}`
    );

    if (searchResult.QueryResponse?.Item?.length) {
      const item = searchResult.QueryResponse.Item[0];
      // Create mapping
      await this.storage.createQuickbooksItemMapping({
        itemId,
        sku,
        quickbooksItemId: item.Id,
        quickbooksItemName: item.Name,
      });
      return { itemId: item.Id, useAccount: false };
    }

    // Fallback: use account-based line (will need Cost of Goods Sold or similar account)
    return { itemId: null, useAccount: true };
  }

  /**
   * Get or create a fallback expense account for unmapped items
   */
  private async getFallbackAccountId(): Promise<string> {
    // Try to find "Cost of Goods Sold" or similar account
    const searchQuery = encodeURIComponent(`SELECT * FROM Account WHERE AccountType = 'Cost of Goods Sold' MAXRESULTS 1`);
    const searchResult = await this.apiRequest<{ QueryResponse: { Account?: Array<{ Id: string }> } }>(
      `/query?query=${searchQuery}`
    );

    if (searchResult.QueryResponse?.Account?.length) {
      return searchResult.QueryResponse.Account[0].Id;
    }

    // Fallback to any expense account
    const expenseQuery = encodeURIComponent(`SELECT * FROM Account WHERE AccountType = 'Expense' MAXRESULTS 1`);
    const expenseResult = await this.apiRequest<{ QueryResponse: { Account?: Array<{ Id: string }> } }>(
      `/query?query=${expenseQuery}`
    );

    if (expenseResult.QueryResponse?.Account?.length) {
      return expenseResult.QueryResponse.Account[0].Id;
    }

    throw new Error('No suitable expense account found in QuickBooks');
  }

  /**
   * Create a QuickBooks Bill from a Purchase Order
   */
  async createBillFromPurchaseOrder(
    po: PurchaseOrder,
    poLines: PurchaseOrderLine[],
    supplier: Supplier,
    items: Map<string, Item>
  ): Promise<{ success: boolean; billId?: string; billNumber?: string; error?: string }> {
    try {
      const initialized = await this.initialize();
      if (!initialized) {
        return { success: false, error: 'QuickBooks not connected' };
      }

      // Check if bill already exists for this PO (idempotency)
      const existingBill = await this.storage.getQuickbooksBillByPurchaseOrderId(po.id);
      if (existingBill) {
        return { 
          success: true, 
          billId: existingBill.quickbooksBillId, 
          billNumber: existingBill.quickbooksBillNumber || undefined 
        };
      }

      // Find or create vendor
      const vendorId = await this.findOrCreateVendor(supplier);

      // Get fallback account ID for unmapped items
      let fallbackAccountId: string | null = null;

      // Build bill lines
      const billLines: QBBill['Line'] = [];
      let totalAmount = 0;

      for (const poLine of poLines) {
        const item = items.get(poLine.itemId);
        if (!item) continue;

        const unitCost = poLine.unitCost || 0;
        const amount = poLine.qtyOrdered * unitCost;
        totalAmount += amount;

        const itemLookup = await this.findItemOrFallback(item.sku, item.id);

        if (itemLookup.itemId && !itemLookup.useAccount) {
          // Use item-based line
          billLines.push({
            Amount: amount,
            Description: `${item.name} (${item.sku})`,
            DetailType: 'ItemBasedExpenseLineDetail',
            ItemBasedExpenseLineDetail: {
              ItemRef: { value: itemLookup.itemId },
              Qty: poLine.qtyOrdered,
              UnitPrice: unitCost,
            },
          });
        } else {
          // Use account-based line (fallback)
          if (!fallbackAccountId) {
            fallbackAccountId = await this.getFallbackAccountId();
          }
          billLines.push({
            Amount: amount,
            Description: `${item.name} (SKU: ${item.sku}) - Qty: ${poLine.qtyOrdered} @ $${unitCost.toFixed(2)}`,
            DetailType: 'AccountBasedExpenseLineDetail',
            AccountBasedExpenseLineDetail: {
              AccountRef: { value: fallbackAccountId },
            },
          });
        }
      }

      // Create the bill
      const billData = {
        VendorRef: { value: vendorId },
        TxnDate: po.orderDate.toISOString().split('T')[0],
        DueDate: po.expectedDate ? po.expectedDate.toISOString().split('T')[0] : undefined,
        Line: billLines,
        PrivateNote: `Created from PO: ${po.poNumber}`,
      };

      const createResult = await this.apiRequest<{ Bill: QBBill }>('/bill', {
        method: 'POST',
        body: JSON.stringify(billData),
      });

      const newBill = createResult.Bill;

      // Store bill record
      await this.storage.createQuickbooksBill({
        purchaseOrderId: po.id,
        quickbooksBillId: newBill.Id,
        quickbooksBillNumber: newBill.DocNumber,
        status: 'CREATED',
        totalAmount: newBill.TotalAmt,
        dueDate: po.expectedDate,
      });

      // Log success
      await AuditLogger.logEvent({
        source: 'QUICKBOOKS',
        eventType: 'BILL_CREATED',
        entityType: 'PURCHASE_ORDER',
        entityId: po.id,
        entityLabel: po.poNumber,
        status: 'INFO',
        description: `Created QuickBooks Bill ${newBill.DocNumber || newBill.Id} for PO ${po.poNumber}`,
        details: {
          quickbooksBillId: newBill.Id,
          billNumber: newBill.DocNumber,
          totalAmount: newBill.TotalAmt,
          vendorId,
          lineCount: billLines.length,
        },
      });

      return {
        success: true,
        billId: newBill.Id,
        billNumber: newBill.DocNumber,
      };
    } catch (error: any) {
      // Log error
      await AuditLogger.logEvent({
        source: 'QUICKBOOKS',
        eventType: 'BILL_CREATE_ERROR',
        entityType: 'PURCHASE_ORDER',
        entityId: po.id,
        entityLabel: po.poNumber,
        status: 'ERROR',
        description: `Failed to create QuickBooks Bill for PO ${po.poNumber}: ${error.message}`,
        details: { error: error.message },
      });

      return {
        success: false,
        error: error.message || 'Failed to create bill',
      };
    }
  }

  /**
   * Get sales snapshots for AI forecasting
   */
  async getSalesSnapshotsForSku(sku: string): Promise<QuickbooksSalesSnapshot[]> {
    return this.storage.getQuickbooksSalesSnapshotsBySku(sku);
  }

  /**
   * Get all sales snapshots for trend analysis
   */
  async getAllSalesSnapshots(): Promise<QuickbooksSalesSnapshot[]> {
    return this.storage.getAllQuickbooksSalesSnapshots();
  }

  /**
   * Get connection status
   */
  async getConnectionStatus(): Promise<{
    isConnected: boolean;
    companyName?: string;
    lastSalesSyncAt?: Date;
    lastSalesSyncStatus?: string;
    tokenLastRotatedAt?: Date;
    tokenNextRotationAt?: Date;
  }> {
    const auth = await this.storage.getQuickbooksAuth(this.userId);
    if (!auth) {
      return { isConnected: false };
    }

    return {
      isConnected: auth.isConnected,
      companyName: auth.companyName || undefined,
      lastSalesSyncAt: auth.lastSalesSyncAt || undefined,
      lastSalesSyncStatus: auth.lastSalesSyncStatus || undefined,
      tokenLastRotatedAt: auth.tokenLastRotatedAt || undefined,
      tokenNextRotationAt: auth.tokenNextRotationAt || undefined,
    };
  }
}

/**
 * Check if QuickBooks is configured (has client credentials)
 */
export function isQuickBooksConfigured(): boolean {
  return !!(process.env.QUICKBOOKS_CLIENT_ID && process.env.QUICKBOOKS_CLIENT_SECRET);
}
