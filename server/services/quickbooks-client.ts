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

// CreditMemo and RefundReceipt for tracking returns
interface QBCreditMemo {
  Id: string;
  DocNumber?: string;
  TxnDate: string;
  Line: QBLineItem[];
  TotalAmt?: number;
  CustomerRef?: { value: string; name?: string };
}

interface QBRefundReceipt {
  Id: string;
  DocNumber?: string;
  TxnDate: string;
  Line: QBLineItem[];
  TotalAmt?: number;
  CustomerRef?: { value: string; name?: string };
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
  quickbooksItemId: string;
}

// Normalized returns line for aggregation
interface NormalizedReturnsLine {
  sku: string;
  productName: string;
  qty: number;
  amount: number;
  date: Date;
  source: 'creditmemo' | 'refundreceipt';
  docNumber: string;
  quickbooksItemId: string;
}

export class QuickBooksClient {
  private storage: IStorage;
  private baseUrl: string;
  private auth: QuickbooksAuth | null = null;
  private userId: string;

  // QuickBooks OAuth endpoints
  private static readonly TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
  // Using sandbox URL for development - change to production URL when ready:
  // private static readonly API_BASE = 'https://quickbooks.api.intuit.com/v3/company';
  private static readonly API_BASE = 'https://sandbox-quickbooks.api.intuit.com/v3/company';

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
        tokenLastRotatedAt: now,
      });

      // Reload auth
      this.auth = await this.storage.getQuickbooksAuth(this.userId);
      console.log('[QuickBooks] Tokens refreshed successfully');
      
      await AuditLogger.logEvent({
        source: 'QUICKBOOKS',
        eventType: 'TOKEN_REFRESH',
        status: 'INFO',
        description: `QuickBooks OAuth tokens refreshed successfully`,
        details: {
          accessTokenExpiresAt: accessTokenExpiresAt.toISOString(),
          refreshTokenExpiresAt: refreshTokenExpiresAt.toISOString(),
        },
      });
      
      return true;
    } catch (error: any) {
      console.error('[QuickBooks] Token refresh error:', error);
      
      await AuditLogger.logEvent({
        source: 'QUICKBOOKS',
        eventType: 'TOKEN_REFRESH_ERROR',
        status: 'ERROR',
        description: `QuickBooks token refresh failed: ${error.message || 'Unknown error'}`,
        details: { error: error.message },
      });
      
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
            const quickbooksItemId = detail.ItemRef?.value || 'UNKNOWN';
            const productName = detail.ItemRef?.name || line.Description || 'Unknown Product';
            
            results.push({
              sku: quickbooksItemId,
              productName,
              qty: detail.Qty || 1,
              amount: line.Amount || 0,
              date: txnDate,
              source: 'invoice',
              docNumber: invoice.DocNumber || invoice.Id,
              quickbooksItemId,
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
            const quickbooksItemId = detail.ItemRef?.value || 'UNKNOWN';
            const productName = detail.ItemRef?.name || line.Description || 'Unknown Product';
            
            results.push({
              sku: quickbooksItemId,
              productName,
              qty: detail.Qty || 1,
              amount: line.Amount || 0,
              date: txnDate,
              source: 'salesreceipt',
              docNumber: receipt.DocNumber || receipt.Id,
              quickbooksItemId,
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

      for (const agg of Array.from(aggregations.values())) {
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
   * Fetch historical returns data from QuickBooks (READ-ONLY)
   * Returns normalized line-level data from CreditMemos and RefundReceipts
   */
  async fetchReturnsHistory(startDate: Date, endDate: Date): Promise<NormalizedReturnsLine[]> {
    const initialized = await this.initialize();
    if (!initialized) {
      throw new Error('QuickBooks not connected');
    }

    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];
    const results: NormalizedReturnsLine[] = [];

    // Fetch CreditMemos
    try {
      const creditMemoQuery = encodeURIComponent(
        `SELECT * FROM CreditMemo WHERE TxnDate >= '${startStr}' AND TxnDate <= '${endStr}' MAXRESULTS 1000`
      );
      const creditMemoData = await this.apiRequest<{ QueryResponse: { CreditMemo?: QBCreditMemo[] } }>(
        `/query?query=${creditMemoQuery}`
      );

      for (const memo of creditMemoData.QueryResponse?.CreditMemo || []) {
        const txnDate = new Date(memo.TxnDate);
        for (const line of memo.Line || []) {
          if (line.SalesItemLineDetail) {
            const detail = line.SalesItemLineDetail;
            const quickbooksItemId = detail.ItemRef?.value || 'UNKNOWN';
            const productName = detail.ItemRef?.name || line.Description || 'Unknown Product';
            
            results.push({
              sku: quickbooksItemId,
              productName,
              qty: detail.Qty || 1,
              amount: line.Amount || 0,
              date: txnDate,
              source: 'creditmemo',
              docNumber: memo.DocNumber || memo.Id,
              quickbooksItemId,
            });
          }
        }
      }
    } catch (error) {
      console.error('[QuickBooks] Error fetching credit memos:', error);
    }

    // Fetch RefundReceipts
    try {
      const refundQuery = encodeURIComponent(
        `SELECT * FROM RefundReceipt WHERE TxnDate >= '${startStr}' AND TxnDate <= '${endStr}' MAXRESULTS 1000`
      );
      const refundData = await this.apiRequest<{ QueryResponse: { RefundReceipt?: QBRefundReceipt[] } }>(
        `/query?query=${refundQuery}`
      );

      for (const refund of refundData.QueryResponse?.RefundReceipt || []) {
        const txnDate = new Date(refund.TxnDate);
        for (const line of refund.Line || []) {
          if (line.SalesItemLineDetail) {
            const detail = line.SalesItemLineDetail;
            const quickbooksItemId = detail.ItemRef?.value || 'UNKNOWN';
            const productName = detail.ItemRef?.name || line.Description || 'Unknown Product';
            
            results.push({
              sku: quickbooksItemId,
              productName,
              qty: detail.Qty || 1,
              amount: line.Amount || 0,
              date: txnDate,
              source: 'refundreceipt',
              docNumber: refund.DocNumber || refund.Id,
              quickbooksItemId,
            });
          }
        }
      }
    } catch (error) {
      console.error('[QuickBooks] Error fetching refund receipts:', error);
    }

    return results;
  }

  /**
   * Sync demand history (sales and returns) to the new demand history table
   * Aggregates by QuickBooks Item ID + year + month with qtySold, qtyReturned, netQty, revenue
   */
  async syncDemandHistory(sinceYears: number = 3): Promise<{ 
    success: boolean; 
    message: string; 
    recordsCreated: number;
    recordsUpdated: number;
  }> {
    try {
      const initialized = await this.initialize();
      if (!initialized) {
        return { success: false, message: 'QuickBooks not connected', recordsCreated: 0, recordsUpdated: 0 };
      }

      const endDate = new Date();
      const startDate = new Date();
      startDate.setFullYear(startDate.getFullYear() - sinceYears);

      console.log(`[QuickBooks] Syncing demand history from ${startDate.toISOString()} to ${endDate.toISOString()}`);

      // Fetch sales and returns in parallel
      const [salesLines, returnsLines] = await Promise.all([
        this.fetchSalesHistory(startDate, endDate),
        this.fetchReturnsHistory(startDate, endDate),
      ]);

      console.log(`[QuickBooks] Fetched ${salesLines.length} sales lines and ${returnsLines.length} returns lines`);

      // Aggregate by QuickBooks Item ID + year + month
      const aggregations = new Map<string, { 
        quickbooksItemId: string;
        sku: string;
        productName: string;
        year: number; 
        month: number; 
        qtySold: number;
        qtyReturned: number;
        salesRevenue: number;
        returnsRevenue: number;
      }>();

      // Process sales
      for (const line of salesLines) {
        const year = line.date.getFullYear();
        const month = line.date.getMonth() + 1; // 1-12
        const key = `${line.quickbooksItemId}-${year}-${month}`;

        const existing = aggregations.get(key);
        if (existing) {
          existing.qtySold += line.qty;
          existing.salesRevenue += line.amount;
        } else {
          aggregations.set(key, {
            quickbooksItemId: line.quickbooksItemId,
            sku: line.sku,
            productName: line.productName,
            year,
            month,
            qtySold: line.qty,
            qtyReturned: 0,
            salesRevenue: line.amount,
            returnsRevenue: 0,
          });
        }
      }

      // Process returns
      for (const line of returnsLines) {
        const year = line.date.getFullYear();
        const month = line.date.getMonth() + 1; // 1-12
        const key = `${line.quickbooksItemId}-${year}-${month}`;

        const existing = aggregations.get(key);
        if (existing) {
          existing.qtyReturned += line.qty;
          existing.returnsRevenue += line.amount;
        } else {
          aggregations.set(key, {
            quickbooksItemId: line.quickbooksItemId,
            sku: line.sku,
            productName: line.productName,
            year,
            month,
            qtySold: 0,
            qtyReturned: line.qty,
            salesRevenue: 0,
            returnsRevenue: line.amount,
          });
        }
      }

      // Upsert demand history records
      let created = 0;
      let updated = 0;

      for (const agg of Array.from(aggregations.values())) {
        const netQty = agg.qtySold - agg.qtyReturned;
        const revenue = agg.salesRevenue - agg.returnsRevenue;

        const result = await this.storage.upsertQuickbooksDemandHistory({
          quickbooksItemId: agg.quickbooksItemId,
          sku: agg.sku,
          productName: agg.productName,
          year: agg.year,
          month: agg.month,
          qtySold: agg.qtySold,
          qtyReturned: agg.qtyReturned,
          netQty,
          revenue,
          lastSyncedAt: new Date(),
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
        eventType: 'DEMAND_HISTORY_SYNC',
        status: 'INFO',
        description: `QuickBooks demand history sync completed: ${created} created, ${updated} updated`,
        details: {
          sinceYears,
          salesLinesProcessed: salesLines.length,
          returnsLinesProcessed: returnsLines.length,
          recordsCreated: created,
          recordsUpdated: updated,
          dateRange: { start: startDate.toISOString(), end: endDate.toISOString() },
        },
      });

      return {
        success: true,
        message: `Synced demand history: ${created} new, ${updated} updated (${salesLines.length} sales, ${returnsLines.length} returns)`,
        recordsCreated: created,
        recordsUpdated: updated,
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
        eventType: 'DEMAND_HISTORY_SYNC_ERROR',
        status: 'ERROR',
        description: `QuickBooks demand history sync failed: ${error.message}`,
        details: { error: error.message },
      });

      return {
        success: false,
        message: error.message || 'Demand history sync failed',
        recordsCreated: 0,
        recordsUpdated: 0,
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
   * Fetch all items from QuickBooks for SKU mapping wizard
   * Returns Inventory and NonInventory items only (PO-eligible types)
   * Inventory = finished products (for sales data/LLM forecasting)
   * NonInventory = raw materials/components (for PO workflows)
   */
  async fetchItems(): Promise<{
    success: boolean;
    items: Array<{
      id: string;
      name: string;
      sku: string | null;
      type: string;
      unitPrice: number | null;
      purchaseCost: number | null;
      active: boolean;
      preferredVendorId: string | null;
      preferredVendorName: string | null;
      purchaseTaxCodeRef: string | null;
    }>;
    totalItems: number;
    error?: string;
  }> {
    try {
      const initialized = await this.initialize();
      if (!initialized) {
        return { success: false, items: [], totalItems: 0, error: 'QuickBooks not connected' };
      }

      // Fetch only Inventory and NonInventory items (PO-relevant types)
      // Service, Category, Group, Bundle are excluded
      const query = encodeURIComponent(
        `SELECT * FROM Item WHERE Active = true AND (Type = 'Inventory' OR Type = 'NonInventory') MAXRESULTS 1000`
      );
      
      const result = await this.apiRequest<{ 
        QueryResponse: { 
          Item?: Array<{
            Id: string;
            Name: string;
            Sku?: string;
            Type: string;
            UnitPrice?: number;
            PurchaseCost?: number;
            Active?: boolean;
            PrefVendorRef?: { value: string; name?: string };
            PurchaseTaxCodeRef?: { value: string };
          }>;
          totalCount?: number;
        } 
      }>(`/query?query=${query}`);

      const items = (result.QueryResponse?.Item || []).map(item => ({
        id: item.Id,
        name: item.Name,
        sku: item.Sku || null,
        type: item.Type,
        unitPrice: item.UnitPrice || null,
        purchaseCost: item.PurchaseCost || null,
        active: item.Active !== false,
        preferredVendorId: item.PrefVendorRef?.value || null,
        preferredVendorName: item.PrefVendorRef?.name || null,
        purchaseTaxCodeRef: item.PurchaseTaxCodeRef?.value || null,
      }));

      await AuditLogger.logEvent({
        source: 'QUICKBOOKS',
        eventType: 'ITEMS_FETCHED',
        status: 'INFO',
        description: `Fetched ${items.length} PO-eligible items from QuickBooks (Inventory: ${items.filter(i => i.type === 'Inventory').length}, NonInventory: ${items.filter(i => i.type === 'NonInventory').length})`,
      });

      return {
        success: true,
        items,
        totalItems: items.length,
      };
    } catch (error: any) {
      console.error('[QuickBooks] Error fetching items:', error);
      await AuditLogger.logEvent({
        source: 'QUICKBOOKS',
        eventType: 'ITEMS_FETCH_ERROR',
        status: 'ERROR',
        description: `Failed to fetch QuickBooks items: ${error.message}`,
      });
      return {
        success: false,
        items: [],
        totalItems: 0,
        error: error.message || 'Failed to fetch items',
      };
    }
  }

  /**
   * Resolve a PurchaseTaxCodeRef to get the actual tax rate percentage
   */
  async getTaxRateForCode(taxCodeId: string): Promise<number | null> {
    try {
      const result = await this.apiRequest<{
        TaxCode: {
          Id: string;
          Name: string;
          SalesTaxRateList?: {
            TaxRateDetail?: Array<{
              TaxRateRef?: { value: string };
            }>;
          };
          PurchaseTaxRateList?: {
            TaxRateDetail?: Array<{
              TaxRateRef?: { value: string };
            }>;
          };
        };
      }>(`/taxcode/${taxCodeId}`);

      // Get the purchase tax rate reference
      const taxRateRef = result.TaxCode?.PurchaseTaxRateList?.TaxRateDetail?.[0]?.TaxRateRef?.value;
      if (!taxRateRef) {
        return null;
      }

      // Fetch the actual tax rate
      const taxRateResult = await this.apiRequest<{
        TaxRate: {
          Id: string;
          Name: string;
          RateValue: number;
        };
      }>(`/taxrate/${taxRateRef}`);

      return taxRateResult.TaxRate?.RateValue ?? null;
    } catch (error: any) {
      console.warn(`[QuickBooks] Failed to resolve tax rate for code ${taxCodeId}:`, error.message);
      return null;
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

  /**
   * Create a Credit Memo in QuickBooks for a return
   * This records the refund/credit for accounting purposes
   * 
   * @param returnRequest - The return request to create a refund for
   * @param returnItems - The items being returned
   * @param items - Map of item SKUs to Item objects for price lookup
   * @returns Result with refundId and type
   */
  async createRefundFromReturn(
    returnRequest: {
      id: string;
      rmaNumber: string | null;
      customerName: string;
      customerEmail?: string | null;
      externalOrderId: string;
      salesChannel: string;
    },
    returnItems: Array<{
      sku: string;
      quantityReturned: number;
      reason?: string | null;
    }>,
    items: Map<string, { id: string; sku: string; name: string; price?: number | null }>
  ): Promise<{ 
    success: boolean; 
    refundId?: string; 
    refundNumber?: string; 
    refundType?: 'CREDIT_MEMO' | 'REFUND_RECEIPT';
    totalAmount?: number;
    error?: string 
  }> {
    try {
      const initialized = await this.initialize();
      if (!initialized) {
        return { success: false, error: 'QuickBooks not connected' };
      }

      // Build line items for the credit memo
      const creditMemoLines: Array<{
        Amount: number;
        Description: string;
        DetailType: string;
        SalesItemLineDetail?: {
          ItemRef: { value: string };
          Qty: number;
          UnitPrice: number;
        };
      }> = [];
      
      let totalAmount = 0;

      for (const returnItem of returnItems) {
        const item = items.get(returnItem.sku);
        if (!item) {
          console.warn(`[QuickBooks] Item not found for SKU: ${returnItem.sku}, skipping`);
          continue;
        }

        const unitPrice = item.price || 0;
        const amount = returnItem.quantityReturned * unitPrice;
        totalAmount += amount;

        // Try to find mapped QB item
        const itemLookup = await this.findItemOrFallback(returnItem.sku, item.id);

        if (itemLookup.itemId && !itemLookup.useAccount) {
          creditMemoLines.push({
            Amount: amount,
            Description: returnItem.reason || `Return: ${item.name} (${item.sku})`,
            DetailType: 'SalesItemLineDetail',
            SalesItemLineDetail: {
              ItemRef: { value: itemLookup.itemId },
              Qty: returnItem.quantityReturned,
              UnitPrice: unitPrice,
            },
          });
        } else {
          // Fallback to simple line without item reference
          creditMemoLines.push({
            Amount: amount,
            Description: `Return: ${item.name} (SKU: ${item.sku}) - Qty: ${returnItem.quantityReturned} @ $${unitPrice.toFixed(2)}${returnItem.reason ? ` - Reason: ${returnItem.reason}` : ''}`,
            DetailType: 'SalesItemLineDetail',
            SalesItemLineDetail: {
              ItemRef: { value: '1' }, // Default services item
              Qty: 1,
              UnitPrice: amount,
            },
          });
        }
      }

      if (creditMemoLines.length === 0) {
        await AuditLogger.logEvent({
          source: 'QUICKBOOKS',
          eventType: 'REFUND_CREATE_ERROR',
          entityType: 'RETURN_REQUEST',
          entityId: returnRequest.id,
          entityLabel: returnRequest.rmaNumber || returnRequest.id,
          status: 'ERROR',
          description: `Cannot create refund: no valid items with mapped SKUs`,
          details: { returnItemCount: returnItems.length },
        });
        return { success: false, error: 'No valid items to create refund for. Ensure items have QuickBooks mappings.' };
      }

      if (totalAmount <= 0) {
        await AuditLogger.logEvent({
          source: 'QUICKBOOKS',
          eventType: 'REFUND_CREATE_ERROR',
          entityType: 'RETURN_REQUEST',
          entityId: returnRequest.id,
          entityLabel: returnRequest.rmaNumber || returnRequest.id,
          status: 'ERROR',
          description: `Cannot create refund: total amount is zero or negative`,
          details: { totalAmount },
        });
        return { success: false, error: 'Cannot create refund: total amount must be greater than zero.' };
      }

      // Find or create customer in QuickBooks
      const customerId = await this.findOrCreateCustomer(
        returnRequest.customerName,
        returnRequest.customerEmail || undefined
      );

      // Create Credit Memo
      const creditMemoData = {
        CustomerRef: { value: customerId },
        TxnDate: new Date().toISOString().split('T')[0],
        Line: creditMemoLines,
        PrivateNote: `RMA: ${returnRequest.rmaNumber || 'N/A'} | Order: ${returnRequest.externalOrderId} | Channel: ${returnRequest.salesChannel}`,
      };

      const createResult = await this.apiRequest<{ CreditMemo: QBCreditMemo }>('/creditmemo', {
        method: 'POST',
        body: JSON.stringify(creditMemoData),
      });

      const newCreditMemo = createResult.CreditMemo;

      // Log success
      await AuditLogger.logEvent({
        source: 'QUICKBOOKS',
        eventType: 'REFUND_CREATED',
        entityType: 'RETURN_REQUEST',
        entityId: returnRequest.id,
        entityLabel: returnRequest.rmaNumber || returnRequest.id,
        status: 'INFO',
        description: `Created QuickBooks Credit Memo ${newCreditMemo.DocNumber || newCreditMemo.Id} for RMA ${returnRequest.rmaNumber || 'N/A'}`,
        details: {
          quickbooksRefundId: newCreditMemo.Id,
          refundNumber: newCreditMemo.DocNumber,
          refundType: 'CREDIT_MEMO',
          totalAmount: newCreditMemo.TotalAmt || totalAmount,
          customerId,
          lineCount: creditMemoLines.length,
          externalOrderId: returnRequest.externalOrderId,
          salesChannel: returnRequest.salesChannel,
        },
      });

      return {
        success: true,
        refundId: newCreditMemo.Id,
        refundNumber: newCreditMemo.DocNumber,
        refundType: 'CREDIT_MEMO',
        totalAmount: newCreditMemo.TotalAmt || totalAmount,
      };
    } catch (error: any) {
      // Log error
      await AuditLogger.logEvent({
        source: 'QUICKBOOKS',
        eventType: 'REFUND_CREATE_ERROR',
        entityType: 'RETURN_REQUEST',
        entityId: returnRequest.id,
        entityLabel: returnRequest.rmaNumber || returnRequest.id,
        status: 'ERROR',
        description: `Failed to create QuickBooks refund for RMA ${returnRequest.rmaNumber || 'N/A'}: ${error.message}`,
        details: { error: error.message },
      });

      return {
        success: false,
        error: error.message || 'Failed to create refund',
      };
    }
  }

  /**
   * Create a QuickBooks Credit Memo with a specific dollar amount (after damage assessment)
   * This is the preferred method for returns that have gone through damage assessment
   */
  async createRefundFromReturnWithAmount(
    returnRequest: {
      id: string;
      rmaNumber: string | null;
      customerName: string;
      customerEmail?: string | null;
      externalOrderId: string;
      salesChannel: string;
    },
    refundAmount: number,
    description: string
  ): Promise<{ 
    success: boolean; 
    refundId?: string; 
    refundNumber?: string; 
    refundType?: 'CREDIT_MEMO' | 'REFUND_RECEIPT';
    totalAmount?: number;
    error?: string 
  }> {
    try {
      const initialized = await this.initialize();
      if (!initialized) {
        return { success: false, error: 'QuickBooks not connected' };
      }

      if (refundAmount <= 0) {
        await AuditLogger.logEvent({
          source: 'QUICKBOOKS',
          eventType: 'REFUND_CREATE_ERROR',
          entityType: 'RETURN_REQUEST',
          entityId: returnRequest.id,
          entityLabel: returnRequest.rmaNumber || returnRequest.id,
          status: 'ERROR',
          description: `Cannot create refund: amount is zero or negative`,
          details: { refundAmount },
        });
        return { success: false, error: 'Cannot create refund: amount must be greater than zero.' };
      }

      // Find or create customer in QuickBooks
      const customerId = await this.findOrCreateCustomer(
        returnRequest.customerName,
        returnRequest.customerEmail || undefined
      );

      // Create single-line Credit Memo with the exact refund amount
      const creditMemoData = {
        CustomerRef: { value: customerId },
        TxnDate: new Date().toISOString().split('T')[0],
        Line: [
          {
            Amount: refundAmount,
            Description: description,
            DetailType: 'SalesItemLineDetail',
            SalesItemLineDetail: {
              ItemRef: { value: '1' }, // Default services item
              Qty: 1,
              UnitPrice: refundAmount,
            },
          }
        ],
        PrivateNote: `RMA: ${returnRequest.rmaNumber || 'N/A'} | Order: ${returnRequest.externalOrderId} | Channel: ${returnRequest.salesChannel}`,
      };

      const createResult = await this.apiRequest<{ CreditMemo: QBCreditMemo }>('/creditmemo', {
        method: 'POST',
        body: JSON.stringify(creditMemoData),
      });

      const newCreditMemo = createResult.CreditMemo;

      // Log success
      await AuditLogger.logEvent({
        source: 'QUICKBOOKS',
        eventType: 'REFUND_CREATED',
        entityType: 'RETURN_REQUEST',
        entityId: returnRequest.id,
        entityLabel: returnRequest.rmaNumber || returnRequest.id,
        status: 'INFO',
        description: `Created QuickBooks Credit Memo ${newCreditMemo.DocNumber || newCreditMemo.Id} for RMA ${returnRequest.rmaNumber || 'N/A'} with amount $${refundAmount.toFixed(2)}`,
        details: {
          quickbooksRefundId: newCreditMemo.Id,
          refundNumber: newCreditMemo.DocNumber,
          refundType: 'CREDIT_MEMO',
          totalAmount: refundAmount,
          customerId,
          externalOrderId: returnRequest.externalOrderId,
          salesChannel: returnRequest.salesChannel,
        },
      });

      return {
        success: true,
        refundId: newCreditMemo.Id,
        refundNumber: newCreditMemo.DocNumber,
        refundType: 'CREDIT_MEMO',
        totalAmount: refundAmount,
      };
    } catch (error: any) {
      // Log error
      await AuditLogger.logEvent({
        source: 'QUICKBOOKS',
        eventType: 'REFUND_CREATE_ERROR',
        entityType: 'RETURN_REQUEST',
        entityId: returnRequest.id,
        entityLabel: returnRequest.rmaNumber || returnRequest.id,
        status: 'ERROR',
        description: `Failed to create QuickBooks refund for RMA ${returnRequest.rmaNumber || 'N/A'}: ${error.message}`,
        details: { error: error.message, refundAmount },
      });

      return {
        success: false,
        error: error.message || 'Failed to create refund',
      };
    }
  }

  /**
   * Find or create a customer in QuickBooks
   */
  private async findOrCreateCustomer(displayName: string, email?: string): Promise<string> {
    try {
      // Search for existing customer by display name
      const searchQuery = encodeURIComponent(
        `SELECT * FROM Customer WHERE DisplayName = '${displayName.replace(/'/g, "\\'")}'`
      );
      const searchResult = await this.apiRequest<{ QueryResponse: { Customer?: Array<{ Id: string }> } }>(
        `/query?query=${searchQuery}`
      );

      if (searchResult.QueryResponse?.Customer?.[0]) {
        return searchResult.QueryResponse.Customer[0].Id;
      }

      // Create new customer
      const customerData: { DisplayName: string; PrimaryEmailAddr?: { Address: string } } = {
        DisplayName: displayName,
      };
      if (email) {
        customerData.PrimaryEmailAddr = { Address: email };
      }

      const createResult = await this.apiRequest<{ Customer: { Id: string } }>('/customer', {
        method: 'POST',
        body: JSON.stringify(customerData),
      });

      return createResult.Customer.Id;
    } catch (error: any) {
      console.error('[QuickBooks] Failed to find/create customer:', error.message);
      // Fall back to a default customer ID (typically '1' is the default)
      return '1';
    }
  }

  /**
   * Look up an item by SKU and return purchase cost + preferred vendor info + tax rate
   * This ensures the cost, vendor, and tax data come from the same QuickBooks record
   * For PO workflows - only NonInventory items should be used for ordering
   */
  async lookupItemBySku(sku: string): Promise<{
    success: boolean;
    item?: {
      quickbooksItemId: string;
      name: string;
      sku: string;
      purchaseCost: number | null;
      unitPrice: number | null;
      type: string;
      taxRate: number | null; // Tax percentage (e.g., 7.5 for 7.5%)
    };
    vendor?: {
      quickbooksVendorId: string;
      name: string;
      email: string | null;
      phone: string | null;
    };
    error?: string;
  }> {
    try {
      const initialized = await this.initialize();
      if (!initialized) {
        return { success: false, error: 'QuickBooks not connected' };
      }

      // Search for item by SKU - QuickBooks uses doubled single quotes for escaping
      const escapedSku = sku.replace(/'/g, "''");
      const itemQuery = encodeURIComponent(
        `SELECT * FROM Item WHERE Sku = '${escapedSku}' AND Active = true`
      );
      
      const itemResult = await this.apiRequest<{
        QueryResponse: {
          Item?: Array<{
            Id: string;
            Name: string;
            Sku?: string;
            Type: string;
            PurchaseCost?: number;
            UnitPrice?: number;
            PrefVendorRef?: { value: string; name?: string };
            PurchaseTaxCodeRef?: { value: string };
          }>;
        };
      }>(`/query?query=${itemQuery}`);

      const qbItem = itemResult.QueryResponse?.Item?.[0];
      if (!qbItem) {
        return { success: false, error: `No QuickBooks item found with SKU: ${sku}` };
      }

      // Resolve tax rate if PurchaseTaxCodeRef is present
      let taxRate: number | null = null;
      if (qbItem.PurchaseTaxCodeRef?.value) {
        taxRate = await this.getTaxRateForCode(qbItem.PurchaseTaxCodeRef.value);
      }

      const result: {
        success: boolean;
        item: {
          quickbooksItemId: string;
          name: string;
          sku: string;
          purchaseCost: number | null;
          unitPrice: number | null;
          type: string;
          taxRate: number | null;
        };
        vendor?: {
          quickbooksVendorId: string;
          name: string;
          email: string | null;
          phone: string | null;
        };
      } = {
        success: true,
        item: {
          quickbooksItemId: qbItem.Id,
          name: qbItem.Name,
          sku: qbItem.Sku || sku,
          purchaseCost: qbItem.PurchaseCost ?? null,
          unitPrice: qbItem.UnitPrice ?? null,
          type: qbItem.Type,
          taxRate,
        },
      };

      // If item has a preferred vendor, fetch vendor details
      if (qbItem.PrefVendorRef?.value) {
        try {
          const vendorResult = await this.apiRequest<{
            Vendor: {
              Id: string;
              DisplayName: string;
              PrimaryEmailAddr?: { Address: string };
              PrimaryPhone?: { FreeFormNumber: string };
            };
          }>(`/vendor/${qbItem.PrefVendorRef.value}`);

          const vendor = vendorResult.Vendor;
          result.vendor = {
            quickbooksVendorId: vendor.Id,
            name: vendor.DisplayName,
            email: vendor.PrimaryEmailAddr?.Address || null,
            phone: vendor.PrimaryPhone?.FreeFormNumber || null,
          };
        } catch (vendorError: any) {
          console.warn(`[QuickBooks] Failed to fetch preferred vendor: ${vendorError.message}`);
          // Still return the item info even if vendor lookup fails
        }
      }

      return result;
    } catch (error: any) {
      console.error('[QuickBooks] Error looking up item by SKU:', error);
      return {
        success: false,
        error: error.message || 'Failed to lookup item',
      };
    }
  }

  /**
   * Search for QuickBooks items by name similarity for fallback matching
   * Returns NonInventory items only since these are PO-eligible
   */
  async searchItemsByName(searchTerm: string, limit: number = 10): Promise<{
    success: boolean;
    items: Array<{
      id: string;
      name: string;
      sku: string | null;
      type: string;
      purchaseCost: number | null;
      preferredVendorName: string | null;
    }>;
    error?: string;
  }> {
    try {
      const initialized = await this.initialize();
      if (!initialized) {
        return { success: false, items: [], error: 'QuickBooks not connected' };
      }

      // Search for NonInventory items with matching name (PO-eligible only)
      const escapedTerm = searchTerm.replace(/'/g, "''");
      const query = encodeURIComponent(
        `SELECT * FROM Item WHERE Active = true AND Type = 'NonInventory' AND Name LIKE '%${escapedTerm}%' MAXRESULTS ${limit}`
      );
      
      const result = await this.apiRequest<{
        QueryResponse: {
          Item?: Array<{
            Id: string;
            Name: string;
            Sku?: string;
            Type: string;
            PurchaseCost?: number;
            PrefVendorRef?: { value: string; name?: string };
          }>;
        };
      }>(`/query?query=${query}`);

      const items = (result.QueryResponse?.Item || []).map(item => ({
        id: item.Id,
        name: item.Name,
        sku: item.Sku || null,
        type: item.Type,
        purchaseCost: item.PurchaseCost || null,
        preferredVendorName: item.PrefVendorRef?.name || null,
      }));

      return { success: true, items };
    } catch (error: any) {
      console.error('[QuickBooks] Error searching items:', error);
      return {
        success: false,
        items: [],
        error: error.message || 'Failed to search items',
      };
    }
  }
}

/**
 * Check if QuickBooks is configured (has client credentials)
 */
export function isQuickBooksConfigured(): boolean {
  return !!(process.env.QUICKBOOKS_CLIENT_ID && process.env.QUICKBOOKS_CLIENT_SECRET);
}
