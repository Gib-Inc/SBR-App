import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import crypto from "crypto";
import { storage } from "./storage";
import { LLMService, type LLMProvider } from "./services/llm";
import { BarcodeService } from "./services/barcode";
import { BarcodeGenerator } from "./barcode-generator";
import { ImportService } from "./import-service";
import { TransactionService } from "./transaction-service";
import { BackorderService } from "./services/backorder-service";
import { ExtensivClient } from "./services/extensiv-client";
import { ShopifyClient } from "./services/shopify-client";
import { AmazonClient } from "./services/amazon-client";
import { GoHighLevelClient } from "./services/gohighlevel-client";
// PhantomBusterClient import removed - V2 placeholder only, no real integration in V1
import { AuditLogger } from "./services/audit-logger";
import { requireAuth } from "./middleware/auth";
import bcrypt from "bcrypt";
import multer from "multer";
import { z } from "zod";
import {
  insertItemSchema,
  insertBinSchema,
  insertInventoryByBinSchema,
  insertBillOfMaterialsSchema,
  insertSupplierSchema,
  insertSupplierItemSchema,
  insertSalesHistorySchema,
  insertFinishedInventorySnapshotSchema,
  insertIntegrationHealthSchema,
  insertSettingsSchema,
  patchSettingsSchema,
  insertBarcodeSchema,
  updateItemSchema,
  updateBinSchema,
  updateSupplierSchema,
  updateSupplierItemSchema,
  updateBarcodeSchema,
  updateBarcodeSettingsSchema,
  insertImportProfileSchema,
  updateImportProfileSchema,
  insertImportJobSchema,
  updateImportJobSchema,
  insertPurchaseOrderSchema,
  insertPurchaseOrderLineSchema,
  insertSupplierLeadSchema,
  insertReturnRequestSchema,
  insertReturnItemSchema,
  insertReturnShipmentSchema,
  insertSalesOrderSchema,
  insertSalesOrderLineSchema,
  updateSalesOrderSchema,
  derivePoDisplayStatus,
  type Item,
  type SalesOrderLine,
  type ReturnItem,
  type ReturnRequest,
  type PurchaseOrder,
  type SalesOrder,
} from "@shared/schema";
import { createReturnLabelService } from "./return-label-service";
import { returnsService } from "./services/returns-service";
import { InventoryDecisionEngine } from "./services/inventory-decision-engine";
import { InventoryMovement } from "./services/inventory-movement";
import { logService } from "./services/log-service";

const SALT_ROUNDS = 10;

// Create a single instance of the decision engine
const decisionEngine = new InventoryDecisionEngine(storage);

// Helper function to process widget data based on config and widget type
function processWidgetData(rawData: any[], config: any, widgetType: string): any {
  if (!rawData || rawData.length === 0) {
    return widgetType === "KPI_CARD" ? { value: 0, label: config?.metric || "Count" } : [];
  }

  // Apply filters if present
  let filteredData = rawData;
  if (config?.filters) {
    for (const filter of config.filters) {
      if (filter.field && filter.value !== undefined) {
        filteredData = filteredData.filter((item: any) => {
          const fieldValue = item[filter.field];
          if (filter.operator === "equals") return fieldValue === filter.value;
          if (filter.operator === "contains") return String(fieldValue).includes(filter.value);
          if (filter.operator === "gt") return Number(fieldValue) > Number(filter.value);
          if (filter.operator === "lt") return Number(fieldValue) < Number(filter.value);
          return true;
        });
      }
    }
  }

  // Process based on widget type
  switch (widgetType) {
    case "KPI_CARD": {
      const metric = config?.metric || "count";
      const field = config?.field;
      let value = 0;
      
      if (metric === "count") {
        value = filteredData.length;
      } else if (metric === "sum" && field) {
        value = filteredData.reduce((acc: number, item: any) => acc + (Number(item[field]) || 0), 0);
      } else if (metric === "avg" && field) {
        const sum = filteredData.reduce((acc: number, item: any) => acc + (Number(item[field]) || 0), 0);
        value = filteredData.length > 0 ? sum / filteredData.length : 0;
      } else if (metric === "min" && field) {
        value = Math.min(...filteredData.map((item: any) => Number(item[field]) || 0));
      } else if (metric === "max" && field) {
        value = Math.max(...filteredData.map((item: any) => Number(item[field]) || 0));
      }
      
      return {
        value: Math.round(value * 100) / 100,
        label: config?.label || metric,
        trend: config?.showTrend ? calculateTrend(filteredData, field) : undefined,
      };
    }
    
    case "BAR_CHART":
    case "LINE_CHART":
    case "AREA_CHART": {
      const groupBy = config?.groupBy || "status";
      const valueField = config?.valueField;
      const aggregation = config?.aggregation || "count";
      
      const grouped = filteredData.reduce((acc: Record<string, number>, item: any) => {
        const key = String(item[groupBy] || "Unknown");
        if (aggregation === "count") {
          acc[key] = (acc[key] || 0) + 1;
        } else if (aggregation === "sum" && valueField) {
          acc[key] = (acc[key] || 0) + (Number(item[valueField]) || 0);
        }
        return acc;
      }, {});
      
      return Object.entries(grouped).map(([name, value]) => ({ name, value }));
    }
    
    case "PIE_CHART": {
      const groupBy = config?.groupBy || "status";
      const grouped = filteredData.reduce((acc: Record<string, number>, item: any) => {
        const key = String(item[groupBy] || "Unknown");
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});
      
      const total = Object.values(grouped).reduce((a, b) => a + b, 0);
      return Object.entries(grouped).map(([name, value]) => ({
        name,
        value,
        percentage: Math.round((value / total) * 100),
      }));
    }
    
    case "TABLE": {
      const columns = config?.columns || Object.keys(filteredData[0] || {}).slice(0, 5);
      const limit = config?.limit || 10;
      return filteredData.slice(0, limit).map((item: any) => {
        const row: Record<string, any> = {};
        for (const col of columns) {
          row[col] = item[col];
        }
        return row;
      });
    }
    
    case "LIST": {
      const labelField = config?.labelField || "name";
      const valueField = config?.valueField;
      const limit = config?.limit || 5;
      return filteredData.slice(0, limit).map((item: any) => ({
        label: item[labelField] || "Unknown",
        value: valueField ? item[valueField] : undefined,
        id: item.id,
      }));
    }
    
    case "PROGRESS": {
      const currentField = config?.currentField;
      const targetField = config?.targetField;
      const target = config?.target;
      
      if (currentField) {
        const current = filteredData.reduce((acc: number, item: any) => acc + (Number(item[currentField]) || 0), 0);
        const targetValue = targetField 
          ? filteredData.reduce((acc: number, item: any) => acc + (Number(item[targetField]) || 0), 0)
          : (target || 100);
        return {
          current,
          target: targetValue,
          percentage: Math.min(100, Math.round((current / targetValue) * 100)),
        };
      }
      return { current: 0, target: 100, percentage: 0 };
    }
    
    default:
      return filteredData;
  }
}

function calculateTrend(data: any[], field?: string): { direction: string; value: number } {
  if (!data || data.length < 2) return { direction: "stable", value: 0 };
  
  const sorted = [...data].sort((a, b) => {
    const dateA = a.createdAt || a.orderDate || a.date;
    const dateB = b.createdAt || b.orderDate || b.date;
    return new Date(dateA).getTime() - new Date(dateB).getTime();
  });
  
  const midpoint = Math.floor(sorted.length / 2);
  const firstHalf = sorted.slice(0, midpoint);
  const secondHalf = sorted.slice(midpoint);
  
  const getValue = (items: any[]) => {
    if (field) {
      return items.reduce((acc, item) => acc + (Number(item[field]) || 0), 0);
    }
    return items.length;
  };
  
  const firstValue = getValue(firstHalf);
  const secondValue = getValue(secondHalf);
  
  if (firstValue === 0) return { direction: secondValue > 0 ? "up" : "stable", value: 0 };
  
  const change = ((secondValue - firstValue) / firstValue) * 100;
  return {
    direction: change > 5 ? "up" : change < -5 ? "down" : "stable",
    value: Math.abs(Math.round(change)),
  };
}

// Calculate year-over-year trend for a widget (same day last year comparison)
async function calculateWidgetTrend(widget: any, storage: any): Promise<{ direction: string; value: number; label: string } | null> {
  try {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    
    // Same day last year
    const lastYearSameDay = new Date(today);
    lastYearSameDay.setFullYear(lastYearSameDay.getFullYear() - 1);
    const lastYearNextDay = new Date(lastYearSameDay.getTime() + 24 * 60 * 60 * 1000);
    
    // Get data for the widget's data source
    let allData: any[] = [];
    switch (widget.dataSource) {
      case "ITEMS":
        allData = await storage.getAllItems();
        break;
      case "SALES_ORDERS":
        allData = await storage.getAllSalesOrders();
        break;
      case "PURCHASE_ORDERS":
        allData = await storage.getAllPurchaseOrders();
        break;
      case "RETURNS":
        allData = await storage.getAllReturnRequests();
        break;
      case "SUPPLIERS":
        allData = await storage.getAllSuppliers();
        break;
      case "INVENTORY_TRANSACTIONS":
        allData = await storage.getAllInventoryTransactions();
        break;
      default:
        return null;
    }
    
    // Filter data for today
    const todayData = allData.filter((item: any) => {
      const itemDate = new Date(item.createdAt || item.orderDate || item.date);
      return itemDate >= today && itemDate < tomorrow;
    });
    
    // Filter data for same day last year
    const lastYearData = allData.filter((item: any) => {
      const itemDate = new Date(item.createdAt || item.orderDate || item.date);
      return itemDate >= lastYearSameDay && itemDate < lastYearNextDay;
    });
    
    // Calculate values based on widget config
    const config = widget.config as any || {};
    const metric = config.metric || "count";
    const field = config.field;
    
    const getValue = (items: any[]) => {
      if (metric === "count" || !field) return items.length;
      if (metric === "sum" && field) {
        return items.reduce((acc: number, item: any) => acc + (Number(item[field]) || 0), 0);
      }
      return items.length;
    };
    
    const currentValue = getValue(todayData);
    const lastYearValue = getValue(lastYearData);
    
    if (lastYearValue === 0 && currentValue === 0) {
      return { direction: "stable", value: 0, label: "vs last year" };
    }
    
    if (lastYearValue === 0) {
      return { direction: "up", value: 100, label: "vs last year" };
    }
    
    const percentChange = ((currentValue - lastYearValue) / lastYearValue) * 100;
    return {
      direction: percentChange > 0 ? "up" : percentChange < 0 ? "down" : "stable",
      value: Math.abs(Math.round(percentChange)),
      label: "vs last year same day",
    };
  } catch (error) {
    console.error("[Reports] Error calculating widget trend:", error);
    return null;
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  // ============================================================================
  // AUTHENTICATION
  // ============================================================================

  app.post("/api/auth/register", async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
      }

      // Check if user already exists
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(409).json({ error: "User already exists" });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

      // Create user
      const user = await storage.createUser({
        email,
        password: hashedPassword,
      });

      // Auto-login after registration
      req.session.userId = user.id;

      // Log user registration
      try {
        await AuditLogger.logUserRegistered({
          userId: user.id,
          email: user.email,
        });
      } catch (logError) {
        console.warn('[Auth] Failed to log user registration:', logError);
      }

      // Don't send password back
      const { password: _, ...userWithoutPassword } = user;
      
      res.status(201).json(userWithoutPassword);
    } catch (error) {
      console.error("Error registering user:", error);
      res.status(500).json({ error: "Failed to register user" });
    }
  });

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
      }

      // Find user
      const user = await storage.getUserByEmail(email);
      if (!user) {
        return res.status(401).json({ error: "Invalid email or password" });
      }

      // Verify password
      const isValidPassword = await bcrypt.compare(password, user.password);
      if (!isValidPassword) {
        return res.status(401).json({ error: "Invalid email or password" });
      }

      // Set session
      req.session.userId = user.id;

      // Log user login
      try {
        await AuditLogger.logUserLogin({
          userId: user.id,
          email: user.email,
        });
      } catch (logError) {
        console.warn('[Auth] Failed to log user login:', logError);
      }

      // Don't send password back
      const { password: _, ...userWithoutPassword } = user;
      
      res.json(userWithoutPassword);
    } catch (error) {
      console.error("Error logging in:", error);
      res.status(500).json({ error: "Failed to log in" });
    }
  });

  app.get("/api/auth/me", async (req: Request, res: Response) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }
      
      res.json({ id: user.id, email: user.email });
    } catch (error) {
      console.error("Error getting current user:", error);
      res.status(500).json({ error: "Failed to get user" });
    }
  });

  app.post("/api/auth/logout", async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId;
      
      // Get user email before destroying session
      let userEmail = '';
      if (userId) {
        const user = await storage.getUser(userId);
        userEmail = user?.email || '';
      }
      
      req.session.destroy(async (err) => {
        if (err) {
          console.error("Error destroying session:", err);
          return res.status(500).json({ error: "Failed to logout" });
        }
        
        // Log user logout
        if (userId) {
          try {
            await AuditLogger.logUserLogout({
              userId,
              email: userEmail,
            });
          } catch (logError) {
            console.warn('[Auth] Failed to log user logout:', logError);
          }
        }
        
        res.json({ message: "Logged out successfully" });
      });
    } catch (error) {
      console.error("Error logging out:", error);
      res.status(500).json({ error: "Failed to logout" });
    }
  });

  // ============================================================================
  // DASHBOARD
  // ============================================================================
  
  app.get("/api/dashboard", requireAuth, async (req: Request, res: Response) => {
    try {
      const items = await storage.getAllItems();
      const suppliers = await storage.getAllSuppliers();
      const integrations = await storage.getAllIntegrationHealth();
      const components = items.filter(item => item.type === "component");
      const finishedProducts = items.filter(item => item.type === "finished_product");

      // Calculate metrics
      // For finished products, use totalOwned (pivotQty + hildaleQty)
      // For components, use currentStock
      const inventoryValue = items.reduce((sum, item) => {
        const quantity = item.type === "finished_product" 
          ? (item.pivotQty ?? 0) + (item.hildaleQty ?? 0)
          : item.currentStock;
        return sum + (quantity * 10);
      }, 0); // Mock pricing
      
      // Find item with lowest days of cover
      let minDaysOfCover = Infinity;
      let constraintItem = "";
      components.forEach(item => {
        const daysOfCover = item.dailyUsage > 0 ? item.currentStock / item.dailyUsage : Infinity;
        if (daysOfCover < minDaysOfCover) {
          minDaysOfCover = daysOfCover;
          constraintItem = item.name;
        }
      });

      // Calculate production capacity based on BOM
      let maxProducibleUnits = 0;
      const productionConstraints: any[] = [];
      
      if (finishedProducts.length > 0) {
        const product = finishedProducts[0];
        const bom = await storage.getBillOfMaterialsByProductId(product.id);
        
        if (bom.length > 0) {
          let minUnits = Infinity;
          
          for (const bomItem of bom) {
            const component = await storage.getItem(bomItem.componentId);
            if (component) {
              const unitsCanMake = Math.floor(component.currentStock / bomItem.quantityRequired);
              minUnits = Math.min(minUnits, unitsCanMake);
              
              productionConstraints.push({
                name: component.name,
                available: component.currentStock,
                required: bomItem.quantityRequired,
              });
            }
          }
          
          maxProducibleUnits = minUnits === Infinity ? 0 : minUnits;
        }
      }

      // Get at-risk items (components and finished products)
      const atRiskComponents = components
        .map(item => ({
          ...item,
          daysOfCover: item.dailyUsage > 0 ? Math.floor(item.currentStock / item.dailyUsage) : 999,
        }));

      // For finished products, base risk check on pivotQty (ready-to-ship warehouse)
      const atRiskFinishedProducts = finishedProducts
        .map(item => ({
          ...item,
          daysOfCover: item.dailyUsage > 0 ? Math.floor((item.pivotQty ?? 0) / item.dailyUsage) : 999,
        }));

      const atRiskItems = [...atRiskComponents, ...atRiskFinishedProducts]
        .filter(item => item.daysOfCover < 30)
        .sort((a, b) => a.daysOfCover - b.daysOfCover)
        .slice(0, 5);

      // Count active alerts
      const activeAlerts = atRiskItems.filter(item => item.daysOfCover < 7).length;

      // Map integration names to their settings keys
      const integrationSettingsMap: Record<string, string> = {
        gohighlevel: "gohighlevelApiKey",
        extensiv: "extensivApiKey",
        extensiv_wh: "extensivApiKey", // Warehouse variant uses same key
        phantombuster: "phantombusterApiKey",
        shopify: "shopifyApiKey",
        shopify_pos: "shopifyApiKey", // POS variant uses same key
      };

      // Format integrations
      const formattedIntegrations = integrations.map(integration => ({
        id: integration.integrationName, // Use raw integration name as ID for sync endpoints
        name: integration.integrationName.charAt(0).toUpperCase() + integration.integrationName.slice(1).replace(/_/g, ' '),
        status: integration.lastStatus || "unknown",
        lastSync: integration.lastSuccessAt 
          ? new Date(integration.lastSuccessAt).toLocaleString()
          : "Never",
        errorMessage: integration.errorMessage || null,
        lastAlertAt: integration.lastAlertAt 
          ? new Date(integration.lastAlertAt).toLocaleString()
          : null,
        settingsKey: integrationSettingsMap[integration.integrationName] || null,
      }));

      res.json({
        metrics: {
          inventoryValue: Math.round(inventoryValue),
          daysUntilStockout: Math.floor(minDaysOfCover),
          productionCapacity: maxProducibleUnits,
          activeAlerts,
        },
        forecast: {
          constraint: constraintItem,
          daysRemaining: Math.floor(minDaysOfCover),
        },
        atRiskItems,
        productionCapacity: {
          maxUnits: maxProducibleUnits,
          constraints: productionConstraints,
        },
        suppliers: suppliers.map(s => ({ id: s.id, name: s.name, catalogUrl: s.catalogUrl })),
        integrations: formattedIntegrations,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch dashboard data" });
    }
  });

  /**
   * POST /api/dashboard/stock/fix-in-ghl
   * Creates DRAFT Purchase Orders for high/critical priority items, then optionally
   * creates GHL opportunities for communication/approval workflow.
   * 
   * SAFETY NOTE: Draft POs generated by the system should be reviewed by a human
   * before sending to suppliers. External ordering and messaging via GHL must
   * follow supplier agreements and communication laws.
   */
  app.post("/api/dashboard/stock/fix-in-ghl", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      
      // Get GHL configuration (optional - we can still create POs without GHL)
      const ghlConfig = await storage.getIntegrationConfig(userId, 'GOHIGHLEVEL');
      // V2 API uses a different base URL
      const baseUrl = 'https://services.leadconnectorhq.com';
      // Check environment variable first, then fall back to stored config
      const apiKey = process.env.GOHIGHLEVEL_API_KEY || ghlConfig?.apiKey;
      const locationId = (ghlConfig?.config as any)?.locationId;
      const pipelineId = (ghlConfig?.config as any)?.purchasePipelineId || process.env.GHL_PURCHASE_PIPELINE_ID;
      const stageDraftId = (ghlConfig?.config as any)?.purchaseStageDraftId || process.env.GHL_PURCHASE_STAGE_DRAFT_ID;
      
      const ghlConfigured = !!(apiKey && locationId && pipelineId && stageDraftId);
      
      // Get all items and compute at-risk status
      const items = await storage.getAllItems();
      const atRiskItems = items
        .map(item => {
          const stock = item.type === "finished_product" 
            ? (item.pivotQty ?? 0) + (item.hildaleQty ?? 0)
            : item.currentStock;
          const daysOfCover = item.dailyUsage > 0 ? stock / item.dailyUsage : Infinity;
          return { ...item, daysOfCover, currentStock: stock };
        })
        .filter(item => item.daysOfCover <= 7) // Only high and critical (<=7 days)
        .sort((a, b) => a.daysOfCover - b.daysOfCover);
      
      if (atRiskItems.length === 0) {
        return res.json({ 
          message: "No high or critical priority items to fix",
          primaryGhlOpportunityUrl: null,
          purchaseOrdersCreated: 0,
          opportunitiesCreated: 0,
          purchaseOrders: [],
        });
      }
      
      // Get supplier items to determine designated suppliers
      const allSupplierItems = await storage.getAllSupplierItems();
      const suppliers = await storage.getAllSuppliers();
      
      // Group items by supplier
      const itemsBySupplier: Map<string, Array<{
        item: typeof atRiskItems[0];
        supplierItem: typeof allSupplierItems[0] | null;
      }>> = new Map();
      
      for (const item of atRiskItems) {
        // Find designated supplier for this item
        const supplierItem = allSupplierItems.find(
          si => si.itemId === item.id && si.isDesignatedSupplier
        ) || allSupplierItems.find(si => si.itemId === item.id);
        
        const supplierId = supplierItem?.supplierId || 'UNKNOWN';
        
        // Skip items with unknown supplier
        if (supplierId === 'UNKNOWN') {
          console.warn(`[Fix in GHL] Skipping item ${item.sku} - no supplier assigned`);
          continue;
        }
        
        if (!itemsBySupplier.has(supplierId)) {
          itemsBySupplier.set(supplierId, []);
        }
        itemsBySupplier.get(supplierId)!.push({ item, supplierItem: supplierItem || null });
      }
      
      if (itemsBySupplier.size === 0) {
        return res.json({ 
          message: "At-risk items found but none have suppliers assigned. Please assign suppliers first.",
          primaryGhlOpportunityUrl: null,
          purchaseOrdersCreated: 0,
          opportunitiesCreated: 0,
          purchaseOrders: [],
        });
      }
      
      // Initialize GHL client if configured
      let ghlClient: any = null;
      if (ghlConfigured) {
        const { GoHighLevelClient } = await import("./services/gohighlevel-client");
        ghlClient = new GoHighLevelClient(baseUrl, apiKey, locationId);
      }
      
      const createdPOs: Array<{ 
        poId: string; 
        poNumber: string;
        supplierId: string; 
        supplierName: string; 
        total: number;
        ghlOpportunityId?: string;
        opportunityUrl?: string;
      }> = [];
      let primaryUrl: string | null = null;
      
      const today = new Date().toISOString().split('T')[0];
      
      for (const [supplierId, supplierItems] of itemsBySupplier) {
        const supplier = suppliers.find(s => s.id === supplierId);
        if (!supplier) {
          console.warn(`[Fix in GHL] Supplier not found: ${supplierId}`);
          continue;
        }
        const supplierName = supplier.name;
        
        // Calculate totals and build line items
        let subtotal = 0;
        let earliestStockout = Infinity;
        const poLines: Array<{
          itemId: string;
          sku: string;
          itemName: string;
          qtyOrdered: number;
          unitCost: number;
          lineTotal: number;
          unitOfMeasure: string;
        }> = [];
        
        for (const { item, supplierItem } of supplierItems) {
          const unitCost = supplierItem?.price ?? 10;
          const moq = supplierItem?.minimumOrderQuantity ?? 1;
          
          // Calculate recommended quantity (target 30 days coverage)
          const targetCoverageDays = 30;
          const avgDailyDemand = item.dailyUsage || 1;
          const recommendedQty = Math.max(
            Math.ceil(targetCoverageDays * avgDailyDemand - item.currentStock),
            moq
          );
          
          const lineTotal = recommendedQty * unitCost;
          subtotal += lineTotal;
          
          if (item.daysOfCover < earliestStockout) {
            earliestStockout = item.daysOfCover;
          }
          
          poLines.push({
            itemId: item.id,
            sku: item.sku || '',
            itemName: item.name,
            qtyOrdered: recommendedQty,
            unitCost,
            lineTotal,
            unitOfMeasure: 'EA',
          });
        }
        
        // Get lead time for expected date
        const maxLeadTime = Math.max(
          ...supplierItems.map(si => si.supplierItem?.leadTimeDays ?? 7)
        );
        const expectedDate = new Date();
        expectedDate.setDate(expectedDate.getDate() + maxLeadTime);
        
        // Create the Purchase Order in our system
        // PO Hildale-only routing: Components/raw materials always go to Hildale warehouse
        const poNumber = await storage.getNextPONumber();
        const po = await storage.createPurchaseOrder({
          poNumber,
          supplierId: supplier.id,
          supplierName: supplier.name,
          supplierEmail: supplier.email,
          supplierAddress: null,
          buyerCompanyName: 'Sticker Bud Roller',
          buyerAddress: null,
          shipToLocation: 'HILDALE',
          currency: 'USD',
          paymentTerms: 'Net 30',
          incoterms: null,
          expectedDate,
          subtotal,
          shippingCost: 0,
          taxes: 0,
          total: subtotal,
          status: 'DRAFT',
          notes: `Auto-generated from Stock Warning Banner on ${today}. Earliest stockout: ${Math.floor(earliestStockout)} days.`,
          internalNotes: `AI-recommended quantities based on 30-day coverage target. ${poLines.length} line items.`,
        });
        
        // Create PO lines
        for (const line of poLines) {
          await storage.createPurchaseOrderLine({
            purchaseOrderId: po.id,
            itemId: line.itemId,
            sku: line.sku,
            itemName: line.itemName,
            qtyOrdered: line.qtyOrdered,
            unitCost: line.unitCost,
            lineTotal: line.lineTotal,
            unitOfMeasure: line.unitOfMeasure,
          });
        }
        
        console.log(`[Fix in GHL] Created PO ${poNumber} for ${supplierName} with ${poLines.length} lines, total $${subtotal.toFixed(2)}`);
        
        // Try to create GHL opportunity if configured
        let ghlOpportunityId: string | undefined;
        let opportunityUrl: string | undefined;
        
        if (ghlClient) {
          const opportunityName = `${poNumber} – ${supplierName}`;
          const notes = `PURCHASE ORDER: ${poNumber}
Supplier: ${supplierName}
Generated: ${today}
Earliest Stockout: ${Math.floor(earliestStockout)} days
Est. Arrival: ${expectedDate.toISOString().split('T')[0]}

LINE ITEMS (${poLines.length}):
${poLines.map(l => `• ${l.sku} | ${l.itemName}: ${l.qtyOrdered} @ $${l.unitCost.toFixed(2)} = $${l.lineTotal.toFixed(2)}`).join('\n')}

TOTAL: $${subtotal.toFixed(2)}

⚠️ Review in Inventory App before approving.`;
          
          const result = await ghlClient.createOpportunity(
            pipelineId,
            stageDraftId,
            opportunityName,
            subtotal,
            notes,
            {
              poId: po.id,
              poNumber,
              supplierId,
              supplierName,
              earliestStockoutDays: Math.floor(earliestStockout),
              itemCount: poLines.length,
            }
          );
          
          if (result.success && result.opportunityId) {
            ghlOpportunityId = result.opportunityId;
            opportunityUrl = result.opportunityUrl;
            
            // Update PO with GHL opportunity ID
            await storage.updatePurchaseOrder(po.id, {
              ghlOpportunityId: result.opportunityId,
            });
            
            if (!primaryUrl && opportunityUrl) {
              primaryUrl = opportunityUrl;
            }
          } else {
            console.warn(`[Fix in GHL] Failed to create GHL opportunity for ${poNumber}:`, result.error);
          }
        }
        
        createdPOs.push({
          poId: po.id,
          poNumber,
          supplierId,
          supplierName,
          total: subtotal,
          ghlOpportunityId,
          opportunityUrl,
        });
      }
      
      // Build response message
      let message = `Created ${createdPOs.length} draft purchase order(s)`;
      if (ghlConfigured) {
        const withGhl = createdPOs.filter(po => po.ghlOpportunityId).length;
        if (withGhl > 0) {
          message += ` with ${withGhl} linked to GoHighLevel`;
        }
      } else {
        message += `. Configure GoHighLevel in Data Sources to enable approval workflow.`;
      }
      
      res.json({
        message,
        primaryGhlOpportunityUrl: primaryUrl,
        purchaseOrdersCreated: createdPOs.length,
        opportunitiesCreated: createdPOs.filter(po => po.ghlOpportunityId).length,
        purchaseOrders: createdPOs,
      });
    } catch (error: any) {
      console.error("[Fix in GHL] Error:", error);
      res.status(500).json({ 
        error: error.message || "Failed to create purchase orders",
        primaryGhlOpportunityUrl: null,
        purchaseOrdersCreated: 0,
        opportunitiesCreated: 0,
        purchaseOrders: [],
      });
    }
  });

  // ============================================================================
  // AI DECISION ENGINE
  // ============================================================================

  // GET /api/ai/insights - Get all SKU recommendations from the decision engine
  // V1 AI Decision Layer: When refresh=true, logs recommendations and anomalies to AI Logs
  app.get("/api/ai/insights", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const forceRefresh = req.query.refresh === "true";
      
      const result = await decisionEngine.computeRecommendations(userId, forceRefresh);
      
      // V1: Log recommendations and persist to DB when refreshing
      let logResult = { logged: 0, anomalies: [] as any[] };
      let persistResult = { persisted: 0, cleared: 0 };
      if (forceRefresh) {
        logResult = await decisionEngine.logRecommendationsToAudit(
          result.recommendations,
          result.rulesApplied
        );
        
        // Persist actionable recommendations to the database
        persistResult = await decisionEngine.persistRecommendations(
          result.recommendations,
          result.rulesApplied
        );
        
        console.log(`[AI Insights] Logged ${logResult.logged} events, detected ${logResult.anomalies.length} anomalies, persisted ${persistResult.persisted} recommendations`);
      }
      
      // V1: Only include anomalyCount in summary when refresh=true (otherwise it's meaningless)
      const summary: Record<string, number> = {
        total: result.recommendations.length,
        needOrder: result.recommendations.filter(r => r.riskLevel === "NEED_ORDER").length,
        high: result.recommendations.filter(r => r.riskLevel === "HIGH").length,
        medium: result.recommendations.filter(r => r.riskLevel === "MEDIUM").length,
        low: result.recommendations.filter(r => r.riskLevel === "LOW").length,
        unknown: result.recommendations.filter(r => r.riskLevel === "UNKNOWN").length,
        actionRequired: result.recommendations.filter(r => r.recommendedAction === "ORDER").length,
      };
      
      if (forceRefresh) {
        summary.anomalyCount = logResult.anomalies.length;
        summary.persisted = persistResult.persisted;
      }
      
      res.json({
        recommendations: result.recommendations,
        computedAt: result.computedAt,
        rulesApplied: result.rulesApplied,
        summary,
      });
    } catch (error: any) {
      console.error("[AI Insights] Error computing recommendations:", error);
      res.status(500).json({ error: error.message || "Failed to compute recommendations" });
    }
  });

  // GET /api/ai/recommendations - Get persisted actionable recommendations from DB
  app.get("/api/ai/recommendations", requireAuth, async (req: Request, res: Response) => {
    try {
      const statusFilter = req.query.status as string | undefined;
      
      let recommendations;
      if (!statusFilter || statusFilter === "active") {
        // Default or "active": get only active recommendations (NEW + ACCEPTED)
        recommendations = await storage.getActiveAIRecommendations();
      } else if (statusFilter === "all") {
        // "all": get all recommendations regardless of status
        recommendations = await storage.getAllAIRecommendations();
      } else {
        // Specific status: NEW, ACCEPTED, DISMISSED
        recommendations = await storage.getAIRecommendationsByStatus(statusFilter);
      }
      
      // Calculate summary counts
      const allRecs = await storage.getAllAIRecommendations();
      const summary = {
        total: allRecs.length,
        new: allRecs.filter(r => r.status === "NEW").length,
        accepted: allRecs.filter(r => r.status === "ACCEPTED").length,
        dismissed: allRecs.filter(r => r.status === "DISMISSED").length,
        highRisk: allRecs.filter(r => r.riskLevel === "HIGH" && r.status !== "DISMISSED").length,
        actionRequired: allRecs.filter(r => 
          (r.recommendationType === "REORDER" || r.recommendationType === "ADS_SPIKE") && 
          r.status === "NEW"
        ).length,
      };
      
      res.json({
        recommendations,
        summary,
        fetchedAt: new Date(),
      });
    } catch (error: any) {
      console.error("[AI Recommendations] Error fetching recommendations:", error);
      res.status(500).json({ error: error.message || "Failed to fetch recommendations" });
    }
  });

  // PATCH /api/ai/recommendations/:id - Update recommendation status
  app.patch("/api/ai/recommendations/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { status } = req.body;
      
      if (!status || !["NEW", "ACCEPTED", "DISMISSED"].includes(status)) {
        return res.status(400).json({ error: "Invalid status. Must be NEW, ACCEPTED, or DISMISSED" });
      }
      
      const existing = await storage.getAIRecommendation(id);
      if (!existing) {
        return res.status(404).json({ error: "Recommendation not found" });
      }
      
      // Update the status
      const updated = await storage.updateAIRecommendationStatus(id, status);
      
      // Log the status change to AI Logs
      const actionVerb = status === "ACCEPTED" ? "ACCEPTED" : status === "DISMISSED" ? "DISMISSED" : "reset to NEW";
      await AuditLogger.logEvent({
        source: "USER",
        eventType: "AI_DECISION",
        entityType: "ITEM",
        entityId: existing.itemId,
        entityLabel: existing.sku,
        status: "INFO",
        description: `User ${actionVerb} recommendation: ${existing.recommendationType} ${existing.recommendedQty} units of SKU ${existing.sku} (${existing.riskLevel} risk, ${existing.daysUntilStockout} days until stockout, ${existing.stockGapPercent?.toFixed(0) ?? 0}% off target)`,
        details: {
          recommendationId: id,
          sku: existing.sku,
          productName: existing.productName,
          recommendationType: existing.recommendationType,
          recommendedQty: existing.recommendedQty,
          riskLevel: existing.riskLevel,
          daysUntilStockout: existing.daysUntilStockout,
          stockGapPercent: existing.stockGapPercent,
          previousStatus: existing.status,
          newStatus: status,
        },
      });
      
      res.json(updated);
    } catch (error: any) {
      console.error("[AI Recommendations] Error updating recommendation:", error);
      res.status(500).json({ error: error.message || "Failed to update recommendation" });
    }
  });

  // GET /api/ai/insights/qb-demand-history - Get paginated QuickBooks demand history (new table with returns)
  app.get("/api/ai/insights/qb-demand-history", requireAuth, async (req: Request, res: Response) => {
    try {
      const search = req.query.search as string | undefined;
      const year = req.query.year ? parseInt(req.query.year as string, 10) : undefined;
      const month = req.query.month ? parseInt(req.query.month as string, 10) : undefined;
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const pageSize = req.query.pageSize ? parseInt(req.query.pageSize as string, 10) : 25;

      const result = await storage.getQuickbooksDemandHistoryItems({
        search,
        year,
        month,
        page,
        pageSize,
      });

      res.json({
        items: result.items,
        total: result.total,
        years: result.years,
        page,
        pageSize,
        totalPages: Math.ceil(result.total / pageSize),
      });
    } catch (error: any) {
      console.error("[QB Demand History] Error fetching demand history:", error);
      res.status(500).json({ error: error.message || "Failed to fetch demand history" });
    }
  });

  // GET /api/ai/recommendations/:id/linked-pos - Get POs linked to a recommendation
  app.get("/api/ai/recommendations/:id/linked-pos", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
      // Get PO lines that reference this recommendation
      const allPOs = await storage.getAllPurchaseOrders();
      const linkedPOs: Array<{
        poId: string;
        poNumber: string;
        status: string;
        orderDate: Date;
        qtyOrdered: number;
        qtyReceived: number;
        supplierName?: string;
      }> = [];
      
      for (const po of allPOs) {
        const lines = await storage.getPurchaseOrderLinesByPOId(po.id);
        for (const line of lines) {
          if (line.aiRecommendationId === id) {
            const supplier = await storage.getSupplier(po.supplierId);
            linkedPOs.push({
              poId: po.id,
              poNumber: po.poNumber,
              status: po.status,
              orderDate: po.orderDate,
              qtyOrdered: line.qtyOrdered,
              qtyReceived: line.qtyReceived,
              supplierName: supplier?.name,
            });
          }
        }
      }
      
      res.json({ linkedPOs });
    } catch (error: any) {
      console.error("[AI Recommendations] Error fetching linked POs:", error);
      res.status(500).json({ error: error.message || "Failed to fetch linked POs" });
    }
  });

  // GET /api/ai/at-risk - Get top at-risk items for dashboard widget
  app.get("/api/ai/at-risk", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const limit = parseInt(req.query.limit as string) || 5;
      
      const atRiskItems = await decisionEngine.getTopAtRiskItems(userId, limit);
      
      // Format for dashboard consumption
      const formatted = atRiskItems.map(item => ({
        id: item.itemId,
        name: item.productName,
        sku: item.sku,
        currentStock: item.metrics.onHand,
        dailyUsage: item.metrics.dailySalesVelocity,
        daysOfCover: Math.floor(item.metrics.projectedDaysUntilStockout),
        riskLevel: item.riskLevel,
        recommendedQty: item.recommendedQty,
        recommendedAction: item.recommendedAction,
        explanation: item.explanation,
      }));
      
      res.json(formatted);
    } catch (error: any) {
      console.error("[AI At-Risk] Error fetching at-risk items:", error);
      res.status(500).json({ error: error.message || "Failed to fetch at-risk items" });
    }
  });

  // GET /api/ai/rules - Get current AI rules configuration
  app.get("/api/ai/rules", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const settings = await storage.getSettings(userId);
      
      // Return current rules or defaults
      res.json({
        velocityLookbackDays: settings?.aiVelocityLookbackDays ?? 14,
        safetyStockDays: settings?.aiSafetyStockDays ?? 7,
        riskThresholdHighDays: settings?.aiRiskThresholdHighDays ?? 0,
        riskThresholdMediumDays: settings?.aiRiskThresholdMediumDays ?? 7,
        returnRateImpact: settings?.aiReturnRateImpact ?? 0.5,
        adDemandImpact: settings?.aiAdDemandImpact ?? 0.2,
        supplierDisputePenaltyDays: settings?.aiSupplierDisputePenaltyDays ?? 3,
        defaultLeadTimeDays: settings?.aiDefaultLeadTimeDays ?? 7,
        minOrderQuantity: settings?.aiMinOrderQuantity ?? 1,
      });
    } catch (error: any) {
      console.error("[AI Rules] Error fetching rules:", error);
      res.status(500).json({ error: error.message || "Failed to fetch AI rules" });
    }
  });

  // PATCH /api/ai/rules - Update AI rules configuration
  app.patch("/api/ai/rules", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      
      // Validate input
      const rulesSchema = z.object({
        velocityLookbackDays: z.number().int().min(1).max(90).optional(),
        safetyStockDays: z.number().int().min(0).max(30).optional(),
        riskThresholdHighDays: z.number().int().min(0).max(14).optional(),
        riskThresholdMediumDays: z.number().int().min(0).max(30).optional(),
        returnRateImpact: z.number().min(0).max(1).optional(),
        adDemandImpact: z.number().min(0).max(1).optional(),
        supplierDisputePenaltyDays: z.number().int().min(0).max(14).optional(),
        defaultLeadTimeDays: z.number().int().min(1).max(60).optional(),
        minOrderQuantity: z.number().int().min(1).max(1000).optional(),
      });
      
      const validated = rulesSchema.parse(req.body);
      
      // Map to settings field names
      const settingsUpdate: Record<string, any> = {};
      if (validated.velocityLookbackDays !== undefined) {
        settingsUpdate.aiVelocityLookbackDays = validated.velocityLookbackDays;
      }
      if (validated.safetyStockDays !== undefined) {
        settingsUpdate.aiSafetyStockDays = validated.safetyStockDays;
      }
      if (validated.riskThresholdHighDays !== undefined) {
        settingsUpdate.aiRiskThresholdHighDays = validated.riskThresholdHighDays;
      }
      if (validated.riskThresholdMediumDays !== undefined) {
        settingsUpdate.aiRiskThresholdMediumDays = validated.riskThresholdMediumDays;
      }
      if (validated.returnRateImpact !== undefined) {
        settingsUpdate.aiReturnRateImpact = validated.returnRateImpact;
      }
      if (validated.adDemandImpact !== undefined) {
        settingsUpdate.aiAdDemandImpact = validated.adDemandImpact;
      }
      if (validated.supplierDisputePenaltyDays !== undefined) {
        settingsUpdate.aiSupplierDisputePenaltyDays = validated.supplierDisputePenaltyDays;
      }
      if (validated.defaultLeadTimeDays !== undefined) {
        settingsUpdate.aiDefaultLeadTimeDays = validated.defaultLeadTimeDays;
      }
      if (validated.minOrderQuantity !== undefined) {
        settingsUpdate.aiMinOrderQuantity = validated.minOrderQuantity;
      }
      
      // Get existing settings for logging comparison
      const existingSettings = await storage.getSettings(userId);
      
      // Update settings
      const updated = await storage.updateSettings(userId, settingsUpdate);
      
      // Log AI rules update
      try {
        const user = await storage.getUser(userId);
        const changes: Record<string, { from: unknown; to: unknown }> = {};
        Object.keys(settingsUpdate).forEach(key => {
          if (existingSettings && (existingSettings as any)[key] !== (settingsUpdate as any)[key]) {
            changes[key] = { from: (existingSettings as any)[key], to: (settingsUpdate as any)[key] };
          }
        });
        if (Object.keys(changes).length > 0) {
          await AuditLogger.logAIRulesUpdated({
            changes,
            userId,
            userName: user?.email,
          });
        }
      } catch (logError) {
        console.warn('[AI Rules] Failed to log AI rules update:', logError);
      }
      
      // Clear the decision engine cache so next request uses new rules
      decisionEngine.clearCache();
      
      res.json({
        success: true,
        message: "AI rules updated successfully",
        rules: {
          velocityLookbackDays: updated?.aiVelocityLookbackDays ?? 14,
          safetyStockDays: updated?.aiSafetyStockDays ?? 7,
          riskThresholdHighDays: updated?.aiRiskThresholdHighDays ?? 0,
          riskThresholdMediumDays: updated?.aiRiskThresholdMediumDays ?? 7,
          returnRateImpact: updated?.aiReturnRateImpact ?? 0.5,
          adDemandImpact: updated?.aiAdDemandImpact ?? 0.2,
          supplierDisputePenaltyDays: updated?.aiSupplierDisputePenaltyDays ?? 3,
          defaultLeadTimeDays: updated?.aiDefaultLeadTimeDays ?? 7,
          minOrderQuantity: updated?.aiMinOrderQuantity ?? 1,
        },
      });
    } catch (error: any) {
      console.error("[AI Rules] Error updating rules:", error);
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: "Invalid rules configuration", details: error.errors });
      }
      res.status(500).json({ error: error.message || "Failed to update AI rules" });
    }
  });

  // GET /api/ai/logs - Get paginated audit logs for the AI Logs tab
  app.get("/api/ai/logs", requireAuth, async (req: Request, res: Response) => {
    try {
      const {
        page = '1',
        pageSize = '50',
        source,
        eventType,
        entityType,
        status,
        dateFrom,
        dateTo,
        search,
      } = req.query;

      const pageNum = Math.max(1, parseInt(page as string) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(pageSize as string) || 50));
      const offset = (pageNum - 1) * limit;

      const options: {
        limit: number;
        offset: number;
        source?: string;
        eventType?: string;
        entityType?: string;
        status?: string;
        dateFrom?: Date;
        dateTo?: Date;
        search?: string;
      } = {
        limit,
        offset,
      };

      if (source && typeof source === 'string') {
        options.source = source;
      }
      if (eventType && typeof eventType === 'string') {
        options.eventType = eventType;
      }
      if (entityType && typeof entityType === 'string') {
        options.entityType = entityType;
      }
      if (status && typeof status === 'string') {
        options.status = status;
      }
      if (dateFrom && typeof dateFrom === 'string') {
        const date = new Date(dateFrom);
        if (!isNaN(date.getTime())) {
          options.dateFrom = date;
        }
      }
      if (dateTo && typeof dateTo === 'string') {
        const date = new Date(dateTo);
        if (!isNaN(date.getTime())) {
          options.dateTo = date;
        }
      }
      if (search && typeof search === 'string' && search.trim()) {
        options.search = search.trim();
      }

      const { logs, total } = await storage.getAuditLogs(options);

      res.json({
        logs,
        pagination: {
          page: pageNum,
          pageSize: limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error: any) {
      console.error("[AI Logs] Error fetching logs:", error);
      res.status(500).json({ error: error.message || "Failed to fetch logs" });
    }
  });

  // GET /api/ai/logs/:id - Get a single audit log by ID
  app.get("/api/ai/logs/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { logs } = await storage.getAuditLogs({ limit: 1, offset: 0 });
      const log = logs.find(l => l.id === id);
      
      if (!log) {
        return res.status(404).json({ error: "Log not found" });
      }
      
      res.json(log);
    } catch (error: any) {
      console.error("[AI Logs] Error fetching log:", error);
      res.status(500).json({ error: error.message || "Failed to fetch log" });
    }
  });

  // ============================================================================
  // AI SYSTEM RECOMMENDATIONS (Weekly LLM Review)
  // ============================================================================
  
  // GET /api/ai/system-recommendations - List AI system recommendations with filters
  app.get("/api/ai/system-recommendations", requireAuth, async (req: Request, res: Response) => {
    try {
      const { status, category, severity, limit: limitParam } = req.query;
      
      const options: {
        status?: string;
        category?: string;
        severity?: string;
        limit?: number;
      } = {};
      
      if (status && typeof status === 'string') {
        options.status = status;
      }
      if (category && typeof category === 'string') {
        options.category = category;
      }
      if (severity && typeof severity === 'string') {
        options.severity = severity;
      }
      if (limitParam && typeof limitParam === 'string') {
        const parsed = parseInt(limitParam);
        if (!isNaN(parsed) && parsed > 0) {
          options.limit = Math.min(parsed, 100); // Cap at 100
        }
      }
      
      const result = await storage.getAiSystemRecommendations(options);
      const recommendations = result.recommendations;
      
      // Calculate summary counts (fetch all without limit)
      const allResult = await storage.getAiSystemRecommendations({});
      const allRecs = allResult.recommendations;
      const summary = {
        total: allResult.total,
        new: allRecs.filter(r => r.status === "NEW").length,
        acknowledged: allRecs.filter(r => r.status === "ACKNOWLEDGED").length,
        dismissed: allRecs.filter(r => r.status === "DISMISSED").length,
        bySeverity: {
          critical: allRecs.filter(r => r.severity === "CRITICAL" && r.status !== "DISMISSED").length,
          high: allRecs.filter(r => r.severity === "HIGH" && r.status !== "DISMISSED").length,
          medium: allRecs.filter(r => r.severity === "MEDIUM" && r.status !== "DISMISSED").length,
          low: allRecs.filter(r => r.severity === "LOW" && r.status !== "DISMISSED").length,
        },
        byCategory: {
          integration_issue: allRecs.filter(r => r.category === "INTEGRATION_ISSUE" && r.status !== "DISMISSED").length,
          inventory_pattern: allRecs.filter(r => r.category === "INVENTORY_PATTERN" && r.status !== "DISMISSED").length,
          process_improvement: allRecs.filter(r => r.category === "PROCESS_IMPROVEMENT" && r.status !== "DISMISSED").length,
          security_concern: allRecs.filter(r => r.category === "SECURITY_CONCERN" && r.status !== "DISMISSED").length,
          performance: allRecs.filter(r => r.category === "PERFORMANCE" && r.status !== "DISMISSED").length,
          data_quality: allRecs.filter(r => r.category === "DATA_QUALITY" && r.status !== "DISMISSED").length,
          other: allRecs.filter(r => r.category === "OTHER" && r.status !== "DISMISSED").length,
        },
      };
      
      res.json({
        recommendations,
        summary,
        fetchedAt: new Date(),
      });
    } catch (error: any) {
      console.error("[AI System Recommendations] Error fetching recommendations:", error);
      res.status(500).json({ error: error.message || "Failed to fetch system recommendations" });
    }
  });
  
  // POST /api/ai/system-recommendations/run-review - Manually trigger AI System Review
  app.post("/api/ai/system-recommendations/run-review", requireAuth, async (req: Request, res: Response) => {
    try {
      const { periodDays } = req.body;
      const userId = req.session.userId;
      
      // Import the trigger function
      const { triggerAISystemReview } = await import('./scheduler-service');
      
      // Calculate period dates
      const periodEnd = new Date();
      const periodStart = new Date();
      periodStart.setDate(periodStart.getDate() - (periodDays || 7)); // Default 7 days
      
      const result = await triggerAISystemReview({
        periodStart,
        periodEnd,
        userId,
      });
      
      if (result.success) {
        res.json({
          success: true,
          message: `AI System Review completed. Analyzed ${result.logsAnalyzed} logs and generated ${result.recommendationsGenerated} recommendations.`,
          logsAnalyzed: result.logsAnalyzed,
          recommendationsGenerated: result.recommendationsGenerated,
        });
      } else {
        res.status(500).json({
          success: false,
          error: result.error || "Review completed with errors",
          logsAnalyzed: result.logsAnalyzed,
          recommendationsGenerated: result.recommendationsGenerated,
        });
      }
    } catch (error: any) {
      console.error("[AI System Review] Error triggering manual review:", error);
      res.status(500).json({ error: error.message || "Failed to run AI System Review" });
    }
  });
  
  // PATCH /api/ai/system-recommendations/:id - Update recommendation status
  app.patch("/api/ai/system-recommendations/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { status, notes } = req.body;
      
      // Validate status
      const validStatuses = ['NEW', 'ACCEPTED', 'DISMISSED', 'IMPLEMENTED'];
      if (status && !validStatuses.includes(status)) {
        return res.status(400).json({ 
          error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` 
        });
      }
      
      const updates: { status?: string; notes?: string } = {};
      if (status) updates.status = status;
      if (notes !== undefined) updates.notes = notes;
      
      const recommendation = await storage.updateAiSystemRecommendation(id, updates);
      
      if (!recommendation) {
        return res.status(404).json({ error: "Recommendation not found" });
      }
      
      // Log the status change
      try {
        const user = await storage.getUser(req.session.userId!);
        await AuditLogger.logEvent({
          eventType: 'AI_RECOMMENDATION_ACKNOWLEDGED',
          source: 'USER',
          entityType: 'AI_RECOMMENDATION',
          entityId: id,
          entityLabel: recommendation.title,
          performedByUserId: req.session.userId,
          performedByName: user?.email,
          status: 'INFO',
          description: `AI System Recommendation "${recommendation.title}" status changed to ${status}`,
          details: {
            recommendationId: id,
            newStatus: status,
            category: recommendation.category,
            severity: recommendation.severity,
          },
        });
      } catch (logError) {
        console.warn('[AI System Recommendations] Failed to log status change:', logError);
      }
      
      res.json(recommendation);
    } catch (error: any) {
      console.error("[AI System Recommendations] Error updating recommendation:", error);
      res.status(500).json({ error: error.message || "Failed to update recommendation" });
    }
  });

  // ============================================================================
  // INTEGRATION HEALTH & KEY ROTATION
  // ============================================================================
  
  // GET /api/integration-health - Get health summary for all integrations
  app.get("/api/integration-health", requireAuth, async (req: Request, res: Response) => {
    try {
      const { integrationHealthService } = await import('./services/integration-health-service');
      const userId = req.session.userId!;
      
      const summary = await integrationHealthService.getHealthSummary(userId);
      res.json(summary);
    } catch (error: any) {
      console.error("[IntegrationHealth] Error fetching health summary:", error);
      res.status(500).json({ error: error.message || "Failed to fetch integration health" });
    }
  });
  
  // POST /api/integration-health/check - Run health check for all integrations
  app.post("/api/integration-health/check", requireAuth, async (req: Request, res: Response) => {
    try {
      const { integrationHealthService } = await import('./services/integration-health-service');
      const userId = req.session.userId!;
      
      const results = await integrationHealthService.checkAllForUser(userId);
      res.json({ 
        message: "Health check completed",
        results,
        alertsSent: results.filter(r => r.alertSent).length,
      });
    } catch (error: any) {
      console.error("[IntegrationHealth] Error running health check:", error);
      res.status(500).json({ error: error.message || "Failed to run health check" });
    }
  });

  // GET /api/integration-health/rotation - Get rotation metadata for all integrations
  app.get("/api/integration-health/rotation", requireAuth, async (req: Request, res: Response) => {
    try {
      const { integrationHealthService } = await import('./services/integration-health-service');
      const userId = req.session.userId!;
      
      const rotationData = await integrationHealthService.getRotationMetadata(userId);
      res.json(rotationData);
    } catch (error: any) {
      console.error("[IntegrationHealth] Error fetching rotation metadata:", error);
      res.status(500).json({ error: error.message || "Failed to fetch rotation metadata" });
    }
  });

  // POST /api/integration-health/rotate - Trigger token rotation for an integration
  app.post("/api/integration-health/rotate", requireAuth, async (req: Request, res: Response) => {
    try {
      const { integrationHealthService } = await import('./services/integration-health-service');
      const userId = req.session.userId!;
      
      const { provider, configId } = req.body;
      
      if (!provider) {
        return res.status(400).json({ error: "Provider is required" });
      }
      
      const result = await integrationHealthService.recordRotation(userId, provider, configId);
      res.json(result);
    } catch (error: any) {
      console.error("[IntegrationHealth] Error recording rotation:", error);
      res.status(500).json({ error: error.message || "Failed to record rotation" });
    }
  });
  
  // POST /api/stale-sync/check - Check for stale syncs and create GHL alerts
  app.post("/api/stale-sync/check", requireAuth, async (req: Request, res: Response) => {
    try {
      const { staleSyncAlertService } = await import('./services/stale-sync-alert-service');
      const userId = req.session.userId!;
      
      const alerts = await staleSyncAlertService.checkAndAlertStaleSync(userId);
      res.json({ 
        message: `Stale sync check completed`,
        staleCount: alerts.length,
        alerts,
        alertsCreated: alerts.filter(a => a.ghlOpportunityCreated).length,
      });
    } catch (error: any) {
      console.error("[StaleSyncCheck] Error running stale sync check:", error);
      res.status(500).json({ error: error.message || "Failed to run stale sync check" });
    }
  });
  
  // GET /api/stale-sync/status - Get current stale sync status without alerting
  app.get("/api/stale-sync/status", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const sources = ['SHOPIFY', 'AMAZON', 'EXTENSIV', 'GOHIGHLEVEL', 'QUICKBOOKS'];
      const now = new Date();
      const STALE_THRESHOLD_HOURS = 24;
      
      const statuses = [];
      for (const source of sources) {
        const config = await storage.getIntegrationConfig(userId, source);
        if (!config || !config.isEnabled) continue;
        
        const hoursSinceSync = config.lastSyncAt 
          ? (now.getTime() - new Date(config.lastSyncAt).getTime()) / (1000 * 60 * 60)
          : Infinity;
        
        const isStale = hoursSinceSync > STALE_THRESHOLD_HOURS || config.lastSyncStatus === 'FAILED';
        
        statuses.push({
          source,
          lastSyncAt: config.lastSyncAt,
          lastSyncStatus: config.lastSyncStatus,
          hoursSinceSync: Math.round(hoursSinceSync),
          isStale,
        });
      }
      
      res.json({
        statuses,
        staleCount: statuses.filter(s => s.isStale).length,
      });
    } catch (error: any) {
      console.error("[StaleSyncStatus] Error fetching stale sync status:", error);
      res.status(500).json({ error: error.message || "Failed to fetch stale sync status" });
    }
  });

  // ============================================================================
  // ITEMS
  // ============================================================================
  
  app.get("/api/items", requireAuth, async (req: Request, res: Response) => {
    try {
      const items = await storage.getItemsWithBOMCounts();
      
      // Clean API response: null out currentStock for finished products
      // Finished products use pivotQty, hildaleQty, and computed totalOwned
      const cleanedItems = items.map((item: any) => {
        if (item.type === 'finished_product') {
          const { currentStock, ...rest } = item;
          return { ...rest, currentStock: null };
        }
        return item;
      });
      
      res.json(cleanedItems);
    } catch (error: any) {
      console.error("[Items] Error fetching items:", error);
      res.status(500).json({ error: "Failed to fetch items" });
    }
  });

  // Get items sorted by criticality for PO creation
  app.get("/api/items/critical-order", requireAuth, async (req: Request, res: Response) => {
    try {
      const items = await storage.getAllItems();
      
      // Calculate days until stockout and sort by criticality
      const itemsWithCriticality = items.map(item => {
        // For finished products, use pivotQty; for components, use currentStock
        const stock = item.type === 'finished_product' 
          ? (item.pivotQty || 0)
          : item.currentStock;
        
        const daysUntilStockout = item.dailyUsage > 0 
          ? Math.floor(stock / item.dailyUsage)
          : 9999;
        
        return {
          ...item,
          daysUntilStockout,
        };
      });

      // Sort by days until stockout (most critical first), then alphabetically
      itemsWithCriticality.sort((a, b) => {
        if (a.daysUntilStockout !== b.daysUntilStockout) {
          return a.daysUntilStockout - b.daysUntilStockout;
        }
        return a.name.localeCompare(b.name);
      });

      res.json(itemsWithCriticality);
    } catch (error: any) {
      console.error("[Items] Error fetching items by criticality:", error);
      res.status(500).json({ error: "Failed to fetch items" });
    }
  });

  app.get("/api/items/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const item = await storage.getItem(req.params.id);
      if (!item) {
        return res.status(404).json({ error: "Item not found" });
      }
      
      // Clean API response: null out currentStock for finished products
      if (item.type === 'finished_product') {
        const { currentStock, ...rest } = item;
        res.json({ ...rest, currentStock: null });
      } else {
        res.json(item);
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch item" });
    }
  });

  app.post("/api/items", requireAuth, async (req: Request, res: Response) => {
    try {
      const validated = insertItemSchema.parse(req.body);
      
      // Extract initial quantities for finished products
      const initialHildaleQty = validated.hildaleQty || 0;
      const initialPivotQty = validated.pivotQty || 0;
      
      // Server-side guard: Prevent currentStock for finished products during creation
      // Finished products use only pivotQty and hildaleQty as sources of truth
      if (validated.type === 'finished_product' && 'currentStock' in validated) {
        delete validated.currentStock;
      }
      
      // For finished products, always create with zero quantities
      // Then use transactions to set initial stock (creates audit trail)
      if (validated.type === 'finished_product') {
        validated.hildaleQty = 0;
        validated.pivotQty = 0;
      }
      
      // Create the item
      const item = await storage.createItem(validated);
      
      // Log item creation
      try {
        const user = await storage.getUser(req.session.userId!);
        await AuditLogger.logItemCreated({
          itemId: item.id,
          sku: item.sku,
          name: item.name,
          type: item.type,
          userId: req.session.userId,
          userName: user?.email,
        });
      } catch (logError) {
        console.warn('[Items] Failed to log item creation:', logError);
      }
      
      // For finished products with initial stock, create RECEIVE transactions
      if (validated.type === 'finished_product') {
        const userId = req.session.userId || "system";
        
        if (initialHildaleQty > 0) {
          await transactionService.applyTransaction({
            itemId: item.id,
            itemType: "FINISHED",
            type: "RECEIVE",
            location: "HILDALE",
            quantity: initialHildaleQty,
            notes: "Initial stock at creation",
            createdBy: userId,
          });
        }
        
        if (initialPivotQty > 0) {
          await transactionService.applyTransaction({
            itemId: item.id,
            itemType: "FINISHED",
            type: "RECEIVE",
            location: "PIVOT",
            quantity: initialPivotQty,
            notes: "Initial stock at creation",
            createdBy: userId,
          });
        }
        
        // Fetch updated item to return with correct quantities
        const updatedItem = await storage.getItem(item.id);
        return res.status(201).json(updatedItem);
      }
      
      res.status(201).json(item);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Invalid item data" });
    }
  });

  app.patch("/api/items/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const validated = updateItemSchema.parse(req.body);
      
      // Validate supplierProductUrl if provided (SSRF prevention with DNS resolution)
      if (validated.supplierProductUrl) {
        const { AutoSuggestCostService } = await import("./services/auto-suggest-cost-service");
        const urlValidation = await AutoSuggestCostService.validateUrlWithDNS(validated.supplierProductUrl);
        if (!urlValidation.valid) {
          return res.status(400).json({ error: `Invalid supplier URL: ${urlValidation.reason}` });
        }
      }
      
      // Get the existing item to check its type
      const existingItem = await storage.getItem(req.params.id);
      if (!existingItem) {
        return res.status(404).json({ error: "Item not found" });
      }
      
      // Server-side guard: Prevent currentStock updates for finished products
      // Finished products use only pivotQty and hildaleQty as sources of truth
      if (existingItem.type === 'finished_product' && 'currentStock' in validated) {
        delete validated.currentStock;
      }
      
      // For finished products: Route hildaleQty/pivotQty changes through transaction system
      if (existingItem.type === 'finished_product') {
        const userId = req.session.userId || "system";
        let shouldRefetch = false;
        
        // Handle hildaleQty changes via ADJUST transaction
        if ('hildaleQty' in validated) {
          const newQty = Number(validated.hildaleQty);
          const oldQty = existingItem.hildaleQty ?? 0;
          const delta = newQty - oldQty;
          
          if (delta !== 0) {
            const result = await transactionService.applyTransaction({
              itemId: req.params.id,
              itemType: "FINISHED",
              type: "ADJUST",
              location: "HILDALE",
              quantity: delta,
              notes: `Manual adjustment via inline edit`,
              createdBy: userId,
            });
            
            if (!result.success) {
              return res.status(400).json({ error: result.error || "Failed to adjust Hildale quantity" });
            }
            shouldRefetch = true;
          }
          // Remove from updates - transaction service handles the change
          delete validated.hildaleQty;
        }
        
        // Handle pivotQty changes via ADJUST transaction
        if ('pivotQty' in validated) {
          const newQty = Number(validated.pivotQty);
          const oldQty = existingItem.pivotQty ?? 0;
          const delta = newQty - oldQty;
          
          if (delta !== 0) {
            const result = await transactionService.applyTransaction({
              itemId: req.params.id,
              itemType: "FINISHED",
              type: "ADJUST",
              location: "PIVOT",
              quantity: delta,
              notes: `Manual adjustment via inline edit`,
              createdBy: userId,
            });
            
            if (!result.success) {
              return res.status(400).json({ error: result.error || "Failed to adjust Pivot quantity" });
            }
            shouldRefetch = true;
          }
          // Remove from updates - transaction service handles the change
          delete validated.pivotQty;
        }
        
        // If quantities were adjusted via transactions, refetch the item
        if (shouldRefetch) {
          // Apply any remaining updates (non-quantity fields)
          if (Object.keys(validated).length > 0) {
            await storage.updateItem(req.params.id, validated);
          }
          const updatedItem = await storage.getItem(req.params.id);
          
          // Trigger Shopify push if two-way sync is enabled
          try {
            const userId = req.session.userId!;
            const settings = await storage.getAiAgentSettingsByUserId(userId);
            if (settings?.shopifyTwoWaySync && updatedItem?.shopifyVariantId) {
              const { shopifyInventorySync } = await import("./services/shopify-inventory-sync-service");
              const initialized = await shopifyInventorySync.initialize(userId);
              if (initialized) {
                // Push to appropriate location based on which field was adjusted
                shopifyInventorySync.syncItemById(req.params.id, userId).catch((err: Error) => {
                  console.error('[Shopify Sync] Background sync failed:', err);
                });
              }
            }
          } catch (syncErr: any) {
            console.error('[Shopify Sync] Error triggering sync after adjustment:', syncErr);
            // Don't fail the request - just log the error
          }
          
          return res.json(updatedItem);
        }
      }
      
      // For non-finished products or updates without quantity changes
      const item = await storage.updateItem(req.params.id, validated);
      if (!item) {
        return res.status(404).json({ error: "Item not found" });
      }
      res.json(item);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to update item" });
    }
  });

  app.delete("/api/items/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      // Get item info before deleting for logging
      const item = await storage.getItem(req.params.id);
      
      const success = await storage.deleteItem(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Item not found" });
      }
      
      // Log item deletion
      if (item) {
        try {
          const user = await storage.getUser(req.session.userId!);
          await AuditLogger.logItemDeleted({
            itemId: req.params.id,
            sku: item.sku,
            name: item.name,
            userId: req.session.userId,
            userName: user?.email,
          });
        } catch (logError) {
          console.warn('[Items] Failed to log item deletion:', logError);
        }
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete item" });
    }
  });

  // Auto-suggest purchase cost from supplier product page
  app.post("/api/items/:id/auto-suggest-cost", requireAuth, async (req: Request, res: Response) => {
    try {
      const { AutoSuggestCostService } = await import("./services/auto-suggest-cost-service");
      const result = await AutoSuggestCostService.autoSuggestPurchaseCost(req.params.id);
      res.json(result);
    } catch (error: any) {
      console.error("[Items] Auto-suggest cost error:", error);
      res.status(500).json({ 
        updated: false, 
        reason: error.message || "Unexpected error during price suggestion" 
      });
    }
  });

  // ============================================================================
  // INVENTORY SCANNING
  // ============================================================================
  
  app.post("/api/inventory/scan", requireAuth, async (req: Request, res: Response) => {
    try {
      const { barcodeValue, autoConfirm = false } = req.body;
      
      if (!barcodeValue) {
        return res.status(400).json({ error: "Barcode value is required" });
      }
      
      // Look up the barcode
      const barcode = await storage.getBarcodeByValue(barcodeValue);
      if (!barcode) {
        return res.status(404).json({ error: "Barcode not found" });
      }
      
      // For item and finished_product barcodes, update inventory
      if (barcode.purpose === "item" || barcode.purpose === "finished_product") {
        if (!barcode.referenceId) {
          return res.status(400).json({ error: "Barcode is not linked to an item" });
        }
        
        const item = await storage.getItem(barcode.referenceId);
        if (!item) {
          return res.status(404).json({ error: "Item not found" });
        }
        
        let updates: any;
        
        // For finished products, update pivotQty (ready-to-ship warehouse)
        // For components, update currentStock
        if (item.type === 'finished_product') {
          updates = {
            pivotQty: (item.pivotQty ?? 0) + 1,
          };
        } else {
          updates = {
            currentStock: item.currentStock + 1,
          };
        }
        
        const updatedItem = await storage.updateItem(barcode.referenceId, updates);
        
        return res.json({
          success: true,
          message: `Inventory updated for ${item.name}`,
          item: updatedItem,
          barcode,
          quantityAdded: 1,
        });
      }
      
      // For bin barcodes, return bin info and prompt for item selection
      if (barcode.purpose === "bin") {
        if (!barcode.referenceId) {
          return res.status(400).json({ error: "Barcode is not linked to a bin" });
        }
        
        const bin = await storage.getBin(barcode.referenceId);
        if (!bin) {
          return res.status(404).json({ error: "Bin not found" });
        }
        
        // Get items in this bin
        const allInventoryByBin = await storage.getAllInventoryByBin();
        const itemsInBin = allInventoryByBin.filter(inv => inv.binId === bin.id);
        
        return res.json({
          success: false,
          requiresItemSelection: true,
          bin,
          barcode,
          itemsInBin,
          message: `Scanned bin: ${bin.name}. Please select which item to update.`,
        });
      }
      
      return res.status(400).json({ error: "Invalid barcode type" });
    } catch (error: any) {
      console.error("Error scanning barcode:", error);
      res.status(500).json({ error: error.message || "Failed to scan barcode" });
    }
  });

  // ============================================================================
  // UNIFIED SCAN INGESTION (Products + Return Labels)
  // ============================================================================
  // This endpoint handles both product barcodes and Shippo return labels.
  // It first tries to match product barcodes, then falls back to Shippo labels.
  
  app.post("/api/scans/ingest", requireAuth, async (req: Request, res: Response) => {
    try {
      const { code, source } = req.body;
      
      if (!code || typeof code !== 'string') {
        return res.status(400).json({ error: "code is required" });
      }
      
      const scanSource = source || 'WAREHOUSE_SCANNER';
      
      // Step 1: Try to match against product barcodes first
      const barcode = await storage.getBarcodeByValue(code);
      if (barcode) {
        // Handle product barcode (existing behavior)
        if (barcode.purpose === "item" || barcode.purpose === "finished_product") {
          if (!barcode.referenceId) {
            return res.json({ status: "PRODUCT_MATCH", barcode, message: "Barcode not linked to item" });
          }
          
          const item = await storage.getItem(barcode.referenceId);
          if (!item) {
            return res.json({ status: "PRODUCT_MATCH", barcode, message: "Item not found" });
          }
          
          return res.json({
            status: "PRODUCT_MATCH",
            barcode,
            item: { id: item.id, sku: item.sku, name: item.name },
            message: `Matched product: ${item.name}`,
          });
        }
        
        if (barcode.purpose === "bin") {
          const bin = barcode.referenceId ? await storage.getBin(barcode.referenceId) : null;
          return res.json({
            status: "BIN_MATCH",
            barcode,
            bin,
            message: bin ? `Matched bin: ${bin.name}` : "Bin not found",
          });
        }
        
        return res.json({ status: "PRODUCT_MATCH", barcode });
      }
      
      // Step 2: Try to match against Shippo label logs
      const labelLog = await storage.getShippoLabelLogByScanCode(code);
      
      if (!labelLog) {
        // No match found - log the event
        try {
          await logService.log({
            type: 'SKU_MISMATCH', // Using existing type, could add SHIPPO_LABEL_NOT_FOUND
            severity: 'WARNING',
            message: `Scanned code "${code}" did not match any product or Shippo label`,
            details: { code, source: scanSource },
          });
        } catch (logErr) {
          console.warn('[Scan] Failed to log unknown code:', logErr);
        }
        
        return res.json({
          status: "UNKNOWN_CODE",
          message: "Code not recognized as product or return label",
        });
      }
      
      // Found a Shippo label - check if it's a return label
      if (labelLog.type !== 'RETURN' || !labelLog.returnRequestId) {
        return res.json({
          status: "LABEL_NOT_RETURN",
          labelLog: { id: labelLog.id, type: labelLog.type, trackingNumber: labelLog.trackingNumber },
          message: "Label is not a return label",
        });
      }
      
      // Load the return request
      const returnRequest = await storage.getReturnRequest(labelLog.returnRequestId);
      if (!returnRequest) {
        try {
          await logService.log({
            type: 'SKU_MISMATCH',
            severity: 'WARNING',
            message: `Label ${code} references missing return ${labelLog.returnRequestId}`,
            details: { code, labelLogId: labelLog.id, returnRequestId: labelLog.returnRequestId },
          });
        } catch (logErr) {
          console.warn('[Scan] Failed to log missing return:', logErr);
        }
        return res.json({ status: "UNKNOWN_CODE", message: "Return request not found" });
      }
      
      // Check if already received
      const receivedStatuses = ['RETURNED', 'RECEIVED_AT_WAREHOUSE', 'REFUND_ISSUE_PENDING', 'REFUNDED', 'CLOSED', 'COMPLETED'];
      if (receivedStatuses.includes(returnRequest.status)) {
        // Already received - don't double-adjust inventory
        try {
          await logService.log({
            type: 'SKU_MISMATCH', // Could use a dedicated DUPLICATE_LABEL_SCAN type
            severity: 'WARNING',
            message: `Duplicate scan: Return ${returnRequest.id} already received`,
            details: { code, returnRequestId: returnRequest.id, currentStatus: returnRequest.status },
          });
        } catch (logErr) {
          console.warn('[Scan] Failed to log duplicate scan:', logErr);
        }
        
        return res.json({
          status: "ALREADY_RECEIVED",
          returnRequestId: returnRequest.id,
          salesOrderId: returnRequest.salesOrderId,
          rmaNumber: returnRequest.rmaNumber,
          message: "This return was already received; no changes made",
        });
      }
      
      // Process the return - update status, inventory, and label log
      const now = new Date();
      const returnItems = await storage.getReturnItemsByRequestId(returnRequest.id);
      const affectedSkus: string[] = [];
      const inventoryUpdates: { sku: string; qty: number }[] = [];
      
      // Update return request status to RETURNED
      await storage.updateReturnRequest(returnRequest.id, {
        status: 'RETURNED',
        receivedAt: now,
      });
      
      // Update each return item and inventory
      for (const returnItem of returnItems) {
        // Mark item as received
        await storage.updateReturnItem(returnItem.id, {
          qtyReceived: returnItem.qtyApproved, // All approved qty is received
          condition: 'GOOD', // Default assumption; can be updated later
        });
        
        // Update inventory - returns go to Hildale warehouse
        if (returnItem.inventoryItemId) {
          const item = await storage.getItem(returnItem.inventoryItemId);
          if (item) {
            const newHildaleQty = (item.hildaleQty ?? 0) + returnItem.qtyApproved;
            await storage.updateItem(returnItem.inventoryItemId, {
              hildaleQty: newHildaleQty,
            });
            
            affectedSkus.push(item.sku);
            inventoryUpdates.push({ sku: item.sku, qty: returnItem.qtyApproved });
          }
        } else if (returnItem.sku) {
          // Try to find item by SKU
          const item = await storage.getItemBySku(returnItem.sku);
          if (item) {
            const newHildaleQty = (item.hildaleQty ?? 0) + returnItem.qtyApproved;
            await storage.updateItem(item.id, {
              hildaleQty: newHildaleQty,
            });
            
            affectedSkus.push(item.sku);
            inventoryUpdates.push({ sku: item.sku, qty: returnItem.qtyApproved });
          }
        }
        
        affectedSkus.push(returnItem.sku);
      }
      
      // Update the Shippo label log
      await storage.updateShippoLabelLog(labelLog.id, {
        status: 'SCANNED_RECEIVED',
        scannedAt: now,
        scannedBy: req.session.userId || undefined,
      });
      
      // Create return event for audit trail
      try {
        await storage.createReturnEvent({
          returnRequestId: returnRequest.id,
          type: 'WAREHOUSE_SCAN',
          fromStatus: returnRequest.status,
          toStatus: 'RETURNED',
          actor: `user:${req.session.userId || 'unknown'}`,
          message: `Return received via label scan (tracking: ${labelLog.trackingNumber})`,
          payload: { scanCode: code, source: scanSource, affectedSkus },
        });
      } catch (evtErr) {
        console.warn('[Scan] Failed to create return event:', evtErr);
      }
      
      // Log the success
      try {
        await logService.log({
          type: 'RETURN_EVENT' as any, // System log for return scanning
          severity: 'INFO',
          message: `Return ${returnRequest.rmaNumber || returnRequest.id} received via label scan`,
          details: { 
            code, 
            returnRequestId: returnRequest.id, 
            salesOrderId: returnRequest.salesOrderId,
            affectedSkus,
            inventoryUpdates,
          },
        });
      } catch (logErr) {
        console.warn('[Scan] Failed to log return receipt:', logErr);
      }
      
      return res.json({
        status: "RETURN_RECEIVED",
        returnRequestId: returnRequest.id,
        salesOrderId: returnRequest.salesOrderId,
        rmaNumber: returnRequest.rmaNumber,
        skus: affectedSkus,
        inventoryUpdates,
        message: `Return received and inventory updated for ${affectedSkus.length} item(s)`,
      });
      
    } catch (error: any) {
      console.error("[Scan] Error processing scan:", error);
      res.status(500).json({ error: error.message || "Failed to process scan" });
    }
  });

  // ============================================================================
  // SHIPPO LABEL LOGS
  // ============================================================================
  // Provides visibility into all Shippo-generated labels for returns/shipments.
  // Used by the Barcodes page to display a read-only table of labels.
  
  app.get("/api/shippo-label-logs", requireAuth, async (req: Request, res: Response) => {
    try {
      const { 
        search, 
        type, 
        status, 
        limit = '50', 
        offset = '0' 
      } = req.query;
      
      const filters: {
        search?: string;
        type?: string;
        status?: string;
        limit?: number;
        offset?: number;
      } = {
        limit: parseInt(limit as string) || 50,
        offset: parseInt(offset as string) || 0,
      };
      
      if (search && typeof search === 'string') {
        filters.search = search;
      }
      if (type && typeof type === 'string') {
        filters.type = type;
      }
      if (status && typeof status === 'string') {
        filters.status = status;
      }
      
      const result = await storage.getShippoLabelLogs(filters);
      res.json(result);
    } catch (error: any) {
      console.error("[ShippoLabels] Error fetching label logs:", error);
      res.status(500).json({ error: error.message || "Failed to fetch label logs" });
    }
  });
  
  app.get("/api/shippo-label-logs/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const labelLog = await storage.getShippoLabelLog(id);
      
      if (!labelLog) {
        return res.status(404).json({ error: "Label log not found" });
      }
      
      res.json(labelLog);
    } catch (error: any) {
      console.error("[ShippoLabels] Error fetching label log:", error);
      res.status(500).json({ error: error.message || "Failed to fetch label log" });
    }
  });

  // ============================================================================
  // PRODUCTS (Finished Products with BOM)
  // ============================================================================
  
  app.get("/api/products", requireAuth, async (req: Request, res: Response) => {
    try {
      const items = await storage.getAllItems();
      const products = items.filter(item => item.type === "finished_product");
      
      // Enrich with BOM count
      const enrichedProducts = await Promise.all(
        products.map(async (product) => {
          const bom = await storage.getBillOfMaterialsByProductId(product.id);
          return {
            ...product,
            componentsCount: bom.length,
          };
        })
      );
      
      res.json(enrichedProducts);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch products" });
    }
  });

  app.post("/api/products", requireAuth, async (req: Request, res: Response) => {
    try {
      const { bom, ...itemData } = req.body;
      
      // Create the finished product
      const validated = insertItemSchema.parse({ ...itemData, type: "finished_product" });
      const product = await storage.createItem(validated);
      
      // Create BOM entries
      if (bom && Array.isArray(bom)) {
        for (const bomItem of bom) {
          const bomValidated = insertBillOfMaterialsSchema.parse({
            finishedProductId: product.id,
            componentId: bomItem.componentId,
            quantityRequired: bomItem.quantity,
          });
          await storage.createBillOfMaterials(bomValidated);
        }
      }
      
      res.status(201).json(product);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Invalid product data" });
    }
  });

  // ============================================================================
  // BINS
  // ============================================================================
  
  app.get("/api/bins", requireAuth, async (req: Request, res: Response) => {
    try {
      const bins = await storage.getAllBins();
      res.json(bins);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch bins" });
    }
  });

  app.post("/api/bins", requireAuth, async (req: Request, res: Response) => {
    try {
      const validated = insertBinSchema.parse(req.body);
      const bin = await storage.createBin(validated);
      res.status(201).json(bin);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Invalid bin data" });
    }
  });

  app.patch("/api/bins/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const validated = updateBinSchema.parse(req.body);
      const bin = await storage.updateBin(req.params.id, validated);
      if (!bin) {
        return res.status(404).json({ error: "Bin not found" });
      }
      res.json(bin);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to update bin" });
    }
  });

  app.delete("/api/bins/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const success = await storage.deleteBin(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Bin not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete bin" });
    }
  });

  // ============================================================================
  // BARCODES
  // ============================================================================
  
  app.get("/api/barcodes", requireAuth, async (req: Request, res: Response) => {
    try {
      const barcodes = await storage.getAllBarcodes();
      res.json(barcodes);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch barcodes" });
    }
  });

  app.post("/api/barcodes", requireAuth, async (req: Request, res: Response) => {
    try {
      const validated = insertBarcodeSchema.parse(req.body);
      
      // Auto-generate barcode value if not provided
      if (!validated.value || validated.value.trim() === '') {
        const allBarcodes = await storage.getAllBarcodes();
        const samePurposeBarcodes = allBarcodes.filter(b => b.purpose === validated.purpose);
        const counter = samePurposeBarcodes.length + 1;
        validated.value = BarcodeService.generateBarcodeValue(validated.purpose, counter);
      }
      
      const barcode = await storage.createBarcode(validated);
      
      // Log barcode generation
      try {
        const user = await storage.getUser(req.session.userId!);
        let sku = '';
        if (barcode.referenceId) {
          const item = await storage.getItem(barcode.referenceId);
          sku = item?.sku || '';
        }
        await AuditLogger.logBarcodeGenerated({
          barcodeId: barcode.id,
          itemId: barcode.referenceId || '',
          sku,
          barcodeType: barcode.purpose,
          barcodeValue: barcode.value,
          userId: req.session.userId,
          userName: user?.email,
        });
      } catch (logError) {
        console.warn('[Barcodes] Failed to log barcode generation:', logError);
      }
      
      res.status(201).json(barcode);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Invalid barcode data" });
    }
  });

  app.get("/api/barcodes/:id/image", requireAuth, async (req: Request, res: Response) => {
    try {
      const barcode = await storage.getBarcode(req.params.id);
      if (!barcode) {
        return res.status(404).json({ error: "Barcode not found" });
      }
      
      const pngBuffer = await BarcodeService.generateBarcodeBuffer({ value: barcode.value });
      
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
      res.send(pngBuffer);
    } catch (error) {
      console.error('Error generating barcode image:', error);
      res.status(500).json({ error: "Failed to generate barcode image" });
    }
  });

  // Generate barcode image from value (on-the-fly generation)
  app.get("/api/generate-barcode/:value", requireAuth, async (req: Request, res: Response) => {
    try {
      const { value } = req.params;
      if (!value || value.trim() === '') {
        return res.status(400).json({ error: "Barcode value is required" });
      }
      
      const pngBuffer = await BarcodeService.generateBarcodeBuffer({ value });
      
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
      res.send(pngBuffer);
    } catch (error) {
      console.error('Error generating barcode image:', error);
      res.status(500).json({ error: "Failed to generate barcode image" });
    }
  });

  app.get("/api/barcodes/lookup/:value", requireAuth, async (req: Request, res: Response) => {
    try {
      const barcode = await storage.getBarcodeByValue(req.params.value);
      if (!barcode) {
        return res.status(404).json({ error: "Barcode not found" });
      }
      res.json(barcode);
    } catch (error) {
      res.status(500).json({ error: "Barcode lookup failed" });
    }
  });

  app.patch("/api/barcodes/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const validated = updateBarcodeSchema.parse(req.body);
      const barcode = await storage.updateBarcode(req.params.id, validated);
      if (!barcode) {
        return res.status(404).json({ error: "Barcode not found" });
      }
      res.json(barcode);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to update barcode" });
    }
  });

  app.delete("/api/barcodes/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const success = await storage.deleteBarcode(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Barcode not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete barcode" });
    }
  });

  // ============================================================================
  // SUPPLIERS
  // ============================================================================
  
  app.get("/api/suppliers", requireAuth, async (req: Request, res: Response) => {
    try {
      const suppliers = await storage.getAllSuppliers();
      res.json(suppliers);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch suppliers" });
    }
  });

  app.post("/api/suppliers", requireAuth, async (req: Request, res: Response) => {
    try {
      const validated = insertSupplierSchema.parse(req.body);
      const supplier = await storage.createSupplier(validated);
      
      // Log supplier creation
      try {
        const user = await storage.getUser(req.session.userId!);
        await AuditLogger.logSupplierCreated({
          supplierId: supplier.id,
          supplierName: supplier.name,
          email: supplier.email ?? undefined,
          phone: supplier.phone ?? undefined,
          userId: req.session.userId,
          userName: user?.email,
        });
      } catch (logError) {
        console.warn('[Suppliers] Failed to log supplier creation:', logError);
      }
      
      res.status(201).json(supplier);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Invalid supplier data" });
    }
  });

  app.patch("/api/suppliers/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const validated = updateSupplierSchema.parse(req.body);
      const existingSupplier = await storage.getSupplier(req.params.id);
      const supplier = await storage.updateSupplier(req.params.id, validated);
      if (!supplier) {
        return res.status(404).json({ error: "Supplier not found" });
      }
      
      // Log supplier update
      try {
        const user = await storage.getUser(req.session.userId!);
        const changes: Record<string, { from: unknown; to: unknown }> = {};
        if (existingSupplier) {
          Object.keys(validated).forEach(key => {
            if ((existingSupplier as any)[key] !== (validated as any)[key]) {
              changes[key] = { from: (existingSupplier as any)[key], to: (validated as any)[key] };
            }
          });
        }
        if (Object.keys(changes).length > 0) {
          await AuditLogger.logSupplierUpdated({
            supplierId: supplier.id,
            supplierName: supplier.name,
            changes,
            userId: req.session.userId,
            userName: user?.email,
          });
        }
      } catch (logError) {
        console.warn('[Suppliers] Failed to log supplier update:', logError);
      }
      
      res.json(supplier);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to update supplier" });
    }
  });

  app.delete("/api/suppliers/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      // Get supplier info before deleting for logging
      const supplier = await storage.getSupplier(req.params.id);
      
      const success = await storage.deleteSupplier(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Supplier not found" });
      }
      
      // Log supplier deletion
      if (supplier) {
        try {
          const user = await storage.getUser(req.session.userId!);
          await AuditLogger.logSupplierDeleted({
            supplierId: req.params.id,
            supplierName: supplier.name,
            userId: req.session.userId,
            userName: user?.email,
          });
        } catch (logError) {
          console.warn('[Suppliers] Failed to log supplier deletion:', logError);
        }
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete supplier" });
    }
  });

  // Supplier Items
  app.get("/api/supplier-items", requireAuth, async (req: Request, res: Response) => {
    try {
      const supplierItems = await storage.getAllSupplierItems();
      res.json(supplierItems);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch supplier items" });
    }
  });

  app.post("/api/supplier-items", requireAuth, async (req: Request, res: Response) => {
    try {
      const validated = insertSupplierItemSchema.parse(req.body);
      const supplierItem = await storage.createSupplierItem(validated);
      
      // Log supplier item linking
      try {
        const user = await storage.getUser(req.session.userId!);
        const supplier = await storage.getSupplier(validated.supplierId);
        const item = await storage.getItem(validated.itemId);
        if (supplier && item) {
          await AuditLogger.logSupplierItemLinked({
            supplierId: validated.supplierId,
            supplierName: supplier.name,
            itemId: validated.itemId,
            sku: item.sku,
            itemName: item.name,
            unitCost: validated.unitCost ?? undefined,
            leadTimeDays: validated.leadTimeDays ?? undefined,
            userId: req.session.userId,
            userName: user?.email,
          });
        }
      } catch (logError) {
        console.warn('[SupplierItems] Failed to log supplier item linking:', logError);
      }
      
      res.status(201).json(supplierItem);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Invalid supplier item data" });
    }
  });

  app.patch("/api/supplier-items/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const validated = updateSupplierItemSchema.parse(req.body);
      const supplierItem = await storage.updateSupplierItem(req.params.id, validated);
      if (!supplierItem) {
        return res.status(404).json({ error: "Supplier item not found" });
      }
      res.json(supplierItem);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to update supplier item" });
    }
  });

  app.delete("/api/supplier-items/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      // Get supplier item info before deleting for logging
      const supplierItems = await storage.getAllSupplierItems();
      const supplierItem = supplierItems.find(si => si.id === req.params.id);
      
      const success = await storage.deleteSupplierItem(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Supplier item not found" });
      }
      
      // Log supplier item unlinking
      if (supplierItem) {
        try {
          const user = await storage.getUser(req.session.userId!);
          const supplier = await storage.getSupplier(supplierItem.supplierId);
          const item = await storage.getItem(supplierItem.itemId);
          if (supplier && item) {
            await AuditLogger.logSupplierItemUnlinked({
              supplierId: supplierItem.supplierId,
              supplierName: supplier.name,
              itemId: supplierItem.itemId,
              sku: item.sku,
              itemName: item.name,
              userId: req.session.userId,
              userName: user?.email,
            });
          }
        } catch (logError) {
          console.warn('[SupplierItems] Failed to log supplier item unlinking:', logError);
        }
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete supplier item" });
    }
  });

  // Get designated supplier for an item
  app.get("/api/items/:itemId/designated-supplier", requireAuth, async (req: Request, res: Response) => {
    try {
      const { itemId } = req.params;
      const supplierItems = await storage.getAllSupplierItems();
      const designatedSupplierItem = supplierItems.find(
        si => si.itemId === itemId && si.isDesignatedSupplier
      );
      
      if (!designatedSupplierItem) {
        return res.json({ supplier: null });
      }
      
      const supplier = await storage.getSupplier(designatedSupplierItem.supplierId);
      res.json({ 
        supplier,
        supplierItem: designatedSupplierItem,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to get designated supplier" });
    }
  });

  // Bill of Materials
  app.get("/api/bom", requireAuth, async (req: Request, res: Response) => {
    try {
      const bom = await storage.getAllBillOfMaterials();
      res.json(bom);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch bill of materials" });
    }
  });

  app.post("/api/bom", requireAuth, async (req: Request, res: Response) => {
    try {
      const validated = insertBillOfMaterialsSchema.parse(req.body);
      const bom = await storage.createBillOfMaterials(validated);
      res.status(201).json(bom);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Invalid BOM data" });
    }
  });

  // Get BOM for a specific product
  app.get("/api/bom/:itemId", requireAuth, async (req: Request, res: Response) => {
    try {
      const bom = await storage.getBillOfMaterialsByProductId(req.params.itemId);
      res.json(bom);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch BOM for product" });
    }
  });

  // Save/Update BOM for a specific product
  app.post("/api/bom/:itemId", requireAuth, async (req: Request, res: Response) => {
    try {
      const { components } = req.body;
      if (!Array.isArray(components)) {
        return res.status(400).json({ error: "Components must be an array" });
      }

      // Get the product for logging
      const product = await storage.getItem(req.params.itemId);

      // Delete existing BOM entries for this product
      const existingBOM = await storage.getBillOfMaterialsByProductId(req.params.itemId);
      for (const entry of existingBOM) {
        await storage.deleteBillOfMaterials(entry.id);
      }

      // Create new BOM entries
      const newBOM = [];
      for (const component of components) {
        if (!component.componentId || !component.quantity) {
          continue; // Skip invalid entries
        }
        const entry = await storage.createBillOfMaterials({
          finishedProductId: req.params.itemId,
          componentId: component.componentId,
          quantityRequired: component.quantity,
        });
        newBOM.push(entry);
      }

      // Log BOM update
      try {
        const user = await storage.getUser(req.session.userId!);
        await AuditLogger.logBOMUpdated({
          productId: req.params.itemId,
          productName: product?.name || '',
          productSku: product?.sku || '',
          componentsCount: newBOM.length,
          previousComponentsCount: existingBOM.length,
          userId: req.session.userId,
          userName: user?.email,
        });
      } catch (logError) {
        console.warn('[BOM] Failed to log BOM update:', logError);
      }

      res.json(newBOM);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to update BOM" });
    }
  });

  app.delete("/api/bom/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const success = await storage.deleteBillOfMaterials(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "BOM entry not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete BOM entry" });
    }
  });

  // ============================================================================
  // SETTINGS
  // ============================================================================
  
  app.get("/api/settings", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      
      const settings = await storage.getSettings(userId);
      
      // Sanitize API keys - return masked values instead of actual keys
      if (settings) {
        const sanitized = { ...settings };
        const sensitiveFields = [
          'gohighlevelApiKey', 'shopifyApiKey', 'extensivApiKey', 
          'phantombusterApiKey', 'llmApiKey', 'quickbooksAccessToken',
          'quickbooksRefreshToken', 'metaAdsAccessToken', 'googleAdsRefreshToken'
        ];
        for (const field of sensitiveFields) {
          if ((sanitized as any)[field]) {
            (sanitized as any)[field] = "••••••••";
          }
        }
        res.json(sanitized);
      } else {
        res.json({});
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  app.patch("/api/settings", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      
      // Validate partial updates (only allowed fields, no userId)
      const validated = patchSettingsSchema.parse(req.body);
      
      // Normalize empty strings to null for all string fields
      const normalized = Object.fromEntries(
        Object.entries(validated).map(([key, value]) => [
          key,
          typeof value === 'string' && value.trim() === '' ? null : value
        ])
      );
      
      // Ensure settings exist, create with full defaults if needed
      let existing = await storage.getSettings(userId);
      if (!existing) {
        existing = await storage.createOrUpdateSettings({ 
          userId,
          gohighlevelApiKey: null,
          shopifyApiKey: null,
          extensivApiKey: null,
          phantombusterApiKey: null,
          llmProvider: null,
          llmApiKey: null,
          llmModel: null,
          llmCustomEndpoint: null,
          llmPromptTemplate: null,
          enableLlmOrderRecommendations: false,
          enableLlmSupplierRanking: false,
          enableLlmForecasting: false,
        });
      }
      
      // Apply validated partial updates (no id or userId in update)
      const updated = await storage.updateSettings(userId, normalized);
      
      if (!updated) {
        return res.status(500).json({ error: "Failed to update settings" });
      }
      
      // Log settings update
      try {
        const user = await storage.getUser(userId);
        // Build changes object - compare with existing settings
        const changes: Record<string, { from: unknown; to: unknown }> = {};
        Object.keys(normalized).forEach(key => {
          if (existing && (existing as any)[key] !== (normalized as any)[key]) {
            // Mask API keys in logs
            const isApiKey = key.toLowerCase().includes('apikey') || key.toLowerCase().includes('api_key');
            changes[key] = { 
              from: isApiKey ? '****' : (existing as any)[key], 
              to: isApiKey ? '****' : (normalized as any)[key] 
            };
          }
        });
        if (Object.keys(changes).length > 0) {
          // Determine setting type based on what was updated
          let settingType: 'LLM_CONFIG' | 'AI_RULES' | 'INTEGRATION' | 'GENERAL' = 'GENERAL';
          const llmFields = ['llmProvider', 'llmApiKey', 'llmModel', 'llmCustomEndpoint', 'llmPromptTemplate', 'enableLlmOrderRecommendations', 'enableLlmSupplierRanking', 'enableLlmForecasting'];
          const integrationFields = ['gohighlevelApiKey', 'shopifyApiKey', 'extensivApiKey', 'phantombusterApiKey'];
          if (Object.keys(normalized).some(k => llmFields.includes(k))) {
            settingType = 'LLM_CONFIG';
          } else if (Object.keys(normalized).some(k => integrationFields.includes(k))) {
            settingType = 'INTEGRATION';
          }
          
          await AuditLogger.logSettingsUpdated({
            settingType,
            settingName: Object.keys(normalized).join(', '),
            changes,
            userId,
            userName: user?.email,
          });
        }
      } catch (logError) {
        console.warn('[Settings] Failed to log settings update:', logError);
      }
      
      // Update integration health status to "pending_test" when API keys are changed
      const integrationKeyMap: Record<string, string> = {
        gohighlevelApiKey: "gohighlevel",
        extensivApiKey: "extensiv",
        phantombusterApiKey: "phantombuster",
        shopifyApiKey: "shopify",
      };
      
      for (const [apiKeyField, integrationName] of Object.entries(integrationKeyMap)) {
        if (apiKeyField in normalized) {
          const newValue = normalized[apiKeyField as keyof typeof normalized];
          const oldValue = existing?.[apiKeyField as keyof typeof existing];
          
          // If API key changed, update health status
          if (newValue !== oldValue) {
            if (newValue && typeof newValue === 'string' && newValue.trim()) {
              // New or changed API key - set to pending_test
              await storage.createOrUpdateIntegrationHealth({
                integrationName,
                lastStatus: "pending_test",
                lastAlertAt: null,
                errorMessage: null,
              });
            } else {
              // API key removed - set to pending_setup
              await storage.createOrUpdateIntegrationHealth({
                integrationName,
                lastStatus: "pending_setup",
                lastAlertAt: null,
                errorMessage: null,
              });
            }
          }
        }
      }
      
      // Sanitize settings response - mask API keys before returning
      const sensitiveFields = [
        'gohighlevelApiKey', 'shopifyApiKey', 'extensivApiKey', 
        'phantombusterApiKey', 'llmApiKey', 'quickbooksAccessToken',
        'quickbooksRefreshToken', 'metaAdsAccessToken', 'googleAdsRefreshToken'
      ];
      const sanitized = { ...updated };
      for (const field of sensitiveFields) {
        if ((sanitized as any)[field]) {
          (sanitized as any)[field] = "••••••••";
        }
      }
      res.json(sanitized);
    } catch (error: any) {
      console.error("Settings update error:", error);
      res.status(400).json({ error: error.message || "Invalid settings data" });
    }
  });

  // ============================================================================
  // INTEGRATION CONFIGS
  // ============================================================================
  
  // Helper to sanitize integration configs before sending to client
  const sanitizeIntegrationConfig = (config: any) => {
    if (!config) return config;
    
    const sanitized = { ...config };
    
    // Replace actual API key with boolean indicator (never send the real key)
    if (sanitized.apiKey) {
      sanitized.apiKey = "••••••••"; // Masked value - frontend checks for truthy
    }
    
    // Sanitize nested config object for sensitive fields
    if (sanitized.config) {
      const sensitiveFields = ['clientSecret', 'refreshToken', 'accessToken'];
      const sanitizedConfig = { ...sanitized.config };
      for (const field of sensitiveFields) {
        if (sanitizedConfig[field]) {
          sanitizedConfig[field] = "••••••••";
        }
      }
      sanitized.config = sanitizedConfig;
    }
    
    return sanitized;
  };

  // Get all integration configs for user
  app.get("/api/integration-configs", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const configs = await storage.getAllIntegrationConfigs(userId);
      // Sanitize all configs before sending to client
      const sanitizedConfigs = configs.map(sanitizeIntegrationConfig);
      res.json(sanitizedConfigs);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch integration configs" });
    }
  });

  // Get specific integration config
  app.get("/api/integration-configs/:provider", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const provider = req.params.provider.toUpperCase();
      console.log(`[IntegrationConfig] GET request - userId: ${userId}, provider: ${provider}`);
      
      let config = await storage.getIntegrationConfig(userId, provider);
      console.log(`[IntegrationConfig] Query result:`, config ? `found id=${config.id}` : 'not found');
      
      if (!config) {
        // Debug: check if any configs exist for this user
        const allConfigs = await storage.getAllIntegrationConfigs(userId);
        console.log(`[IntegrationConfig] All configs for user:`, allConfigs.map(c => c.provider));
        return res.status(404).json({ error: "Integration config not found" });
      }
      
      // Auto-populate missing rotation dates for existing configs with API keys
      if (config.apiKey && !config.tokenLastRotatedAt) {
        const now = new Date();
        const nextRotation = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
        const updated = await storage.updateIntegrationConfig(config.id, {
          tokenLastRotatedAt: now,
          tokenNextRotationAt: nextRotation,
        });
        if (updated) {
          config = updated;
          console.log(`[IntegrationConfig] Auto-populated rotation dates for ${provider}`);
        }
      }
      
      // Sanitize config before sending to client
      res.json(sanitizeIntegrationConfig(config));
    } catch (error: any) {
      console.error(`[IntegrationConfig] GET error:`, error);
      res.status(500).json({ error: error.message || "Failed to fetch integration config" });
    }
  });

  // Create or update integration config (upsert behavior)
  app.post("/api/integration-configs", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const { provider, accountName, apiKey, config } = req.body;

      if (!provider) {
        return res.status(400).json({ error: "Provider is required" });
      }

      const normalizedProvider = provider.toUpperCase();

      // Check if config already exists - if so, update it instead of creating
      const existing = await storage.getIntegrationConfig(userId, normalizedProvider);
      if (existing) {
        // Build update object
        const updateData: any = {
          accountName: accountName || existing.accountName,
          apiKey: apiKey || existing.apiKey,
          config: config || existing.config,
        };
        
        // For GHL and other API key integrations: set rotation dates if not already set or if API key is changing
        if ((normalizedProvider === 'GOHIGHLEVEL' || normalizedProvider === 'EXTENSIV' || 
             normalizedProvider === 'AMAZON' || normalizedProvider === 'SHOPIFY') && apiKey) {
          const now = new Date();
          // If tokenLastRotatedAt is not set, or API key is being changed, update it
          if (!existing.tokenLastRotatedAt || (apiKey && apiKey !== existing.apiKey)) {
            updateData.tokenLastRotatedAt = now;
            // Set next rotation to 90 days from now (standard security practice)
            const nextRotation = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
            updateData.tokenNextRotationAt = nextRotation;
          }
        }
        
        // Update the existing config
        const updated = await storage.updateIntegrationConfig(existing.id, updateData);

        // Log the update
        try {
          const user = await storage.getUser(userId);
          await AuditLogger.logIntegrationConfigUpdated({
            integrationType: normalizedProvider,
            integrationName: accountName || normalizedProvider,
            configured: true,
            userId,
            userName: user?.email,
          });
        } catch (logError) {
          console.warn('[IntegrationConfig] Failed to log config update:', logError);
        }

        return res.json(sanitizeIntegrationConfig(updated!));
      }

      // Calculate rotation dates for new configs
      const now = new Date();
      const nextRotation = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
      
      const newConfig = await storage.createIntegrationConfig({
        userId,
        provider: normalizedProvider,
        accountName: accountName || null,
        apiKey: apiKey || null,
        isEnabled: true,
        config: config || null,
        tokenLastRotatedAt: apiKey ? now : null,
        tokenNextRotationAt: apiKey ? nextRotation : null,
      });

      // Log integration config creation
      try {
        const user = await storage.getUser(userId);
        await AuditLogger.logIntegrationConfigUpdated({
          integrationType: normalizedProvider,
          integrationName: accountName || normalizedProvider,
          configured: true,
          userId,
          userName: user?.email,
        });
      } catch (logError) {
        console.warn('[IntegrationConfig] Failed to log config creation:', logError);
      }

      // Sanitize response before sending to client
      res.status(201).json(sanitizeIntegrationConfig(newConfig));
    } catch (error: any) {
      // Handle duplicate key error gracefully
      if (error.message?.includes('duplicate key') || error.code === '23505') {
        return res.status(409).json({ error: "Integration config already exists. Please refresh and try again." });
      }
      res.status(500).json({ error: error.message || "Failed to create integration config" });
    }
  });

  // Update integration config
  app.patch("/api/integration-configs/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const updates = req.body;
      const existingConfig = await storage.getIntegrationConfigById(req.params.id);
      const updated = await storage.updateIntegrationConfig(req.params.id, updates);

      if (!updated) {
        return res.status(404).json({ error: "Integration config not found" });
      }

      // Log integration config update
      try {
        const user = await storage.getUser(userId);
        await AuditLogger.logIntegrationConfigUpdated({
          integrationType: updated.provider,
          integrationName: updated.accountName || updated.provider,
          configured: updated.isEnabled,
          userId,
          userName: user?.email,
        });
      } catch (logError) {
        console.warn('[IntegrationConfig] Failed to log config update:', logError);
      }

      // Sanitize response before sending to client
      res.json(sanitizeIntegrationConfig(updated));
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to update integration config" });
    }
  });

  // Delete integration config
  app.delete("/api/integration-configs/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      // Get config info before deleting for logging
      const config = await storage.getIntegrationConfigById(req.params.id);
      
      const success = await storage.deleteIntegrationConfig(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Integration config not found" });
      }
      
      // Log integration config deletion
      if (config) {
        try {
          const user = await storage.getUser(userId);
          await AuditLogger.logIntegrationConfigUpdated({
            integrationType: config.provider,
            integrationName: config.accountName || config.provider,
            configured: false,
            userId,
            userName: user?.email,
          });
        } catch (logError) {
          console.warn('[IntegrationConfig] Failed to log config deletion:', logError);
        }
      }
      
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to delete integration config" });
    }
  });

  // ============================================================================
  // INTEGRATIONS
  // ============================================================================
  //
  // V1 SYSTEM OF RECORD RULES:
  // ==========================
  // 1. INVENTORY APP is the system of record for inventory quantities:
  //    - currentStock (raw materials), hildaleQty, pivotQty, availableForSaleQty
  //    - All quantity changes MUST go through InventoryMovement helper for audit trail
  //
  // 2. SHOPIFY + AMAZON are ORDER SOURCES ONLY in V1:
  //    - We import orders → SalesOrders table + InventoryMovement(SALES_ORDER_CREATED)
  //    - We do NOT push inventory quantities back to channels (no fake stock levels)
  //    - Stay compliant with channel policies
  //
  // 3. EXTENSIV/PIVOT is READ-ONLY in V1:
  //    - We pull inventory snapshots for 3PL reconciliation
  //    - Store Extensiv quantities in extensivOnHandSnapshot for variance display
  //    - EXTENSIV_SYNC updates pivotQty and adjusts availableForSaleQty by delta
  //    - We do NOT let Extensiv overwrite our main inventory fields automatically
  //
  // 4. QUICKBOOKS is FINANCIAL-ONLY in V1:
  //    - Store mapping IDs for products/customers if needed
  //    - We do NOT create SalesOrders or inventory movements from QuickBooks
  //    - This prevents double-counting orders that came from Shopify/Amazon
  //
  // 5. GOHIGHLEVEL is MESSAGING-ONLY in V1:
  //    - Used for PO contact creation + email/SMS sending
  //    - Does NOT drive inventory quantities
  //
  // IDEMPOTENCY: (channel, externalOrderId) is unique - no duplicate order imports
  // ==========================
  
  // Get integration health status
  app.get("/api/integrations/health", requireAuth, async (req: Request, res: Response) => {
    try {
      const health = await storage.getAllIntegrationHealth();
      res.json(health);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch integration health" });
    }
  });

  // Verify Channel SKUs - API-backed health check that confirms each channel's SKUs exist
  app.post("/api/integrations/verify-channel-skus", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const items = await storage.getAllItems();
      const finishedProducts = items.filter(i => i.type === 'finished_product');

      const results: any = {
        shopify: { ok: 0, missing: 0, unmapped: 0, missingItems: [], apiStatus: "not_configured" },
        amazon: { ok: 0, missing: 0, unmapped: 0, missingItems: [], apiStatus: "not_configured" },
        extensiv: { ok: 0, missing: 0, unmapped: 0, missingItems: [], apiStatus: "not_configured" },
        notes: "",
      };

      // Collect mapped SKUs per channel
      const shopifySkus: string[] = [];
      const amazonSkus: string[] = [];
      const extensivSkus: string[] = [];
      const skuToProduct: Record<string, any> = {};

      for (const product of finishedProducts) {
        if (product.shopifySku) {
          shopifySkus.push(product.shopifySku);
          skuToProduct[`shopify:${product.shopifySku}`] = product;
        } else {
          results.shopify.unmapped++;
        }

        if (product.amazonSku) {
          amazonSkus.push(product.amazonSku);
          skuToProduct[`amazon:${product.amazonSku}`] = product;
        } else {
          results.amazon.unmapped++;
        }

        if (product.extensivSku) {
          extensivSkus.push(product.extensivSku);
          skuToProduct[`extensiv:${product.extensivSku}`] = product;
        } else {
          results.extensiv.unmapped++;
        }
      }

      // Check integration configurations and perform API verification
      const shopifyConfig = await storage.getIntegrationConfig(userId, 'SHOPIFY');
      const amazonConfig = await storage.getIntegrationConfig(userId, 'AMAZON');
      const extensivConfig = await storage.getIntegrationConfig(userId, 'EXTENSIV');

      const integrationNotes: string[] = [];

      // Verify Shopify SKUs via API
      if (shopifyConfig?.apiKey && shopifyConfig?.shopDomain) {
        try {
          const { ShopifyClient } = await import("./services/shopify-client");
          const shopifyClient = new ShopifyClient(
            shopifyConfig.shopDomain,
            shopifyConfig.apiKey
          );
          
          if (shopifySkus.length > 0) {
            const verifyResult = await shopifyClient.verifySkus(shopifySkus);
            
            if (verifyResult.error) {
              results.shopify.apiStatus = "error";
              integrationNotes.push(`Shopify API error: ${verifyResult.error}`);
              results.shopify.ok = 0;
              results.shopify.missing = shopifySkus.length;
            } else {
              results.shopify.apiStatus = "verified";
              results.shopify.ok = verifyResult.found.length;
              results.shopify.missing = verifyResult.missing.length;
              results.shopify.missingItems = verifyResult.missing.map(sku => ({
                sku,
                name: skuToProduct[`shopify:${sku}`]?.name || sku
              }));
              integrationNotes.push(`Shopify: ${verifyResult.found.length} verified, ${verifyResult.missing.length} not found`);
            }
          } else {
            results.shopify.apiStatus = "verified";
            integrationNotes.push("Shopify: No SKUs to verify");
          }
        } catch (error: any) {
          results.shopify.apiStatus = "error";
          integrationNotes.push(`Shopify verification failed: ${error.message}`);
        }
      } else {
        integrationNotes.push("Shopify not configured");
      }

      // Amazon - Note: Full SP-API integration requires complex auth
      if (amazonConfig?.apiKey) {
        results.amazon.apiStatus = "mapping_only";
        results.amazon.ok = amazonSkus.length;
        integrationNotes.push(`Amazon: ${amazonSkus.length} mapped (API verification requires SP-API setup)`);
      } else {
        integrationNotes.push("Amazon not configured");
      }

      // Verify Extensiv SKUs via API
      if (extensivConfig?.apiKey) {
        try {
          const { ExtensivClient } = await import("./services/extensiv-client");
          const baseUrl = extensivConfig.baseUrl || 'https://api.skubana.com/v1';
          const extensivClient = new ExtensivClient(extensivConfig.apiKey, baseUrl);
          
          if (extensivSkus.length > 0) {
            const verifyResult = await extensivClient.verifySkus(extensivSkus);
            
            if (verifyResult.error) {
              results.extensiv.apiStatus = "error";
              integrationNotes.push(`Extensiv API error: ${verifyResult.error}`);
              results.extensiv.ok = 0;
              results.extensiv.missing = extensivSkus.length;
            } else {
              results.extensiv.apiStatus = "verified";
              results.extensiv.ok = verifyResult.found.length;
              results.extensiv.missing = verifyResult.missing.length;
              results.extensiv.missingItems = verifyResult.missing.map(sku => ({
                sku,
                name: skuToProduct[`extensiv:${sku}`]?.name || sku
              }));
              integrationNotes.push(`Extensiv: ${verifyResult.found.length} verified, ${verifyResult.missing.length} not found`);
            }
          } else {
            results.extensiv.apiStatus = "verified";
            integrationNotes.push("Extensiv: No SKUs to verify");
          }
        } catch (error: any) {
          results.extensiv.apiStatus = "error";
          integrationNotes.push(`Extensiv verification failed: ${error.message}`);
        }
      } else {
        integrationNotes.push("Extensiv not configured");
      }

      results.notes = integrationNotes.join(". ") + ".";

      res.json(results);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to verify channel SKUs" });
    }
  });
  
  // Extensiv - Test Connection
  app.post("/api/integrations/extensiv/test", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      
      // Get API key from integration config or environment variable
      const config = await storage.getIntegrationConfig(userId, 'EXTENSIV');
      const apiKey = config?.apiKey || process.env.EXTENSIV_API_KEY;
      
      if (!apiKey) {
        return res.status(400).json({ 
          success: false,
          message: "Extensiv API key not configured. Please add it in Settings or set EXTENSIV_API_KEY environment variable." 
        });
      }

      const client = new ExtensivClient(apiKey);
      const result = await client.testConnection();

      // Update integration config status
      if (config) {
        await storage.updateIntegrationConfig(config.id, {
          lastSyncAt: new Date(),
          lastSyncStatus: result.success ? 'SUCCESS' : 'FAILED',
          lastSyncMessage: result.message,
        });
      }

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ 
        success: false,
        message: error.message || "Failed to test Extensiv connection" 
      });
    }
  });

  // Extensiv/Pivot - Sync finished inventory
  // Mode: "compare" (just compare, log discrepancies) or "align" (apply adjustments to Pivot Qty)
  app.post("/api/integrations/extensiv/sync", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const { mode = "compare", zeroMissing = false } = req.body;
      const syncMode = mode === "align" ? "align" : "compare"; // Default to "compare" (safer)
      console.log(`[Extensiv] Starting sync in ${syncMode.toUpperCase()} mode${zeroMissing ? ' (zero missing enabled)' : ''}`);
      
      // Get API key from integration config or environment variable
      const config = await storage.getIntegrationConfig(userId, 'EXTENSIV');
      const apiKey = config?.apiKey || process.env.EXTENSIV_API_KEY;
      
      if (!apiKey) {
        const message = "Extensiv API key not configured";
        if (config) {
          await storage.updateIntegrationConfig(config.id, {
            lastSyncAt: new Date(),
            lastSyncStatus: 'FAILED',
            lastSyncMessage: message,
          });
        }
        return res.status(400).json({ success: false, message });
      }

      // Get Pivot warehouse ID from config or environment variable
      const pivotWarehouseId = (config?.config as any)?.pivotWarehouseId || process.env.PIVOT_WAREHOUSE_ID || '1';

      const client = new ExtensivClient(apiKey);
      
      // Set status to PENDING
      if (config) {
        await storage.updateIntegrationConfig(config.id, {
          lastSyncStatus: 'PENDING',
          lastSyncMessage: 'Sync in progress...',
        });
      }

      // Fetch all inventory from Extensiv for Pivot warehouse
      console.log(`[Extensiv] Fetching inventory for warehouse ${pivotWarehouseId}...`);
      const extensivItems = await client.getAllInventory(pivotWarehouseId);
      console.log(`[Extensiv] Fetched ${extensivItems.length} items from Extensiv`);

      let comparedCount = 0;
      let discrepancyCount = 0;
      let adjustmentsApplied = 0;
      let itemsFlagged = 0;
      const unmatchedSkus: string[] = [];
      const errors: string[] = [];
      const discrepancies: Array<{ sku: string; pivotQty: number; extensivQty: number; delta: number }> = [];

      // Track SKUs seen in Extensiv for zero-missing logic
      const extensivSkusSeen = new Set<string>();

      // Update Pivot quantities for matching SKUs using InventoryMovement for centralized updates
      const inventoryMovement = new InventoryMovement(storage);
      const user = await storage.getUser(userId);
      
      for (const extensivItem of extensivItems) {
        try {
          // Try to find product by internal/house SKU first, then fall back to Extensiv SKU mapping
          let item = await storage.getItemBySku(extensivItem.sku);
          
          if (!item) {
            // Fallback: try to find product by Extensiv SKU mapping
            item = await storage.findProductByExtensivSku(extensivItem.sku);
            
            if (item) {
              console.log(`[Extensiv] Matched SKU ${extensivItem.sku} to product ${item.sku} via extensivSku mapping`);
            }
          }
          
          if (!item) {
            unmatchedSkus.push(extensivItem.sku);
            
            // Log SKU mismatch for review (but don't block - Extensiv is read-only)
            try {
              const { logService } = await import('./services/log-service');
              await logService.logSkuMismatch({
                source: 'EXTENSIV',
                externalSku: extensivItem.sku,
                orderId: 'INVENTORY_SYNC',
                lineItemData: { 
                  sku: extensivItem.sku, 
                  quantity: extensivItem.quantity,
                  tip: 'Configure via BOM > SKU Mapping'
                }
              });
            } catch (logErr) {
              console.warn('[Extensiv] Failed to log SKU mismatch:', logErr);
            }
            
            continue;
          }

          // Track this SKU as seen in Extensiv
          extensivSkusSeen.add(item.sku);
          comparedCount++;

          const currentPivotQty = item.pivotQty ?? 0;
          const extensivQty = extensivItem.quantity;
          const delta = extensivQty - currentPivotQty;

          // V1: Always store Extensiv snapshot for variance display (read-only reconciliation)
          await storage.updateItem(item.id, {
            extensivOnHandSnapshot: extensivQty,
            extensivLastSyncAt: new Date(),
          });

          // Check for discrepancy
          if (delta !== 0) {
            discrepancyCount++;
            discrepancies.push({ sku: item.sku, pivotQty: currentPivotQty, extensivQty, delta });
            console.log(`[Extensiv] Discrepancy: ${item.sku} - Pivot: ${currentPivotQty}, Extensiv: ${extensivQty}, Delta: ${delta}`);
          }
          
          // In ALIGN mode, apply the adjustment
          if (syncMode === "align" && delta !== 0) {
            const result = await inventoryMovement.apply({
              eventType: "EXTENSIV_SYNC",
              itemId: item.id,
              quantity: extensivQty, // New authoritative quantity from Extensiv
              location: "PIVOT",
              source: "SYSTEM",
              userId: userId,
              userName: user?.email,
              notes: `Extensiv align sync: ${currentPivotQty} → ${extensivQty}`,
            });

            if (result.success) {
              adjustmentsApplied++;
            } else {
              errors.push(`${extensivItem.sku}: ${result.error}`);
            }
          }
        } catch (error: any) {
          errors.push(`${extensivItem.sku}: ${error.message}`);
          console.error(`[Extensiv] Failed to sync ${extensivItem.sku}:`, error);
        }
      }

      // In ALIGN mode with zeroMissing: zero out Pivot Qty for items not in Extensiv
      if (syncMode === "align" && zeroMissing) {
        console.log('[Extensiv] Align mode with zeroMissing: checking for items to zero out...');
        const allItems = await storage.getAllItems();
        for (const item of allItems) {
          // Only process finished products with non-zero Pivot Qty that weren't in Extensiv
          if (item.type === 'finished_product' && (item.pivotQty ?? 0) > 0 && !extensivSkusSeen.has(item.sku)) {
            try {
              const result = await inventoryMovement.apply({
                eventType: "EXTENSIV_SYNC",
                itemId: item.id,
                quantity: 0, // Zero out
                location: "PIVOT",
                source: "SYSTEM",
                userId: userId,
                userName: user?.email,
                notes: `Extensiv align sync: ${item.pivotQty} → 0 (not in Extensiv)`,
              });
              if (result.success) {
                itemsFlagged++;
                console.log(`[Extensiv] Zeroed out ${item.sku} (not in Extensiv)`);
              }
            } catch (zeroErr: any) {
              errors.push(`Failed to zero ${item.sku}: ${zeroErr.message}`);
            }
          }
        }
      }

      const summary = syncMode === "compare" 
        ? `Compared ${comparedCount} items. ${discrepancyCount} discrepancies found. ${unmatchedSkus.length} unmatched SKUs.`
        : `Applied ${adjustmentsApplied} adjustments${itemsFlagged > 0 ? `, ${itemsFlagged} items zeroed` : ''}. ${unmatchedSkus.length} unmatched SKUs${errors.length > 0 ? `, ${errors.length} errors` : ''}`;
      const hasErrors = errors.length > 0;
      
      // Update integration config status
      if (config) {
        await storage.updateIntegrationConfig(config.id, {
          lastSyncAt: new Date(),
          lastSyncStatus: hasErrors ? 'FAILED' : 'SUCCESS',
          lastSyncMessage: summary,
        });
      }

      // Log sync completion
      try {
        const { logService } = await import('./services/log-service');
        await logService.logIntegrationEvent({
          source: 'EXTENSIV',
          action: syncMode === "align" ? 'ALIGN_SYNC_COMPLETED' : 'COMPARE_SYNC_COMPLETED',
          status: hasErrors ? 'PARTIAL' : 'SUCCESS',
          message: summary,
          details: { mode: syncMode, comparedCount, discrepancyCount, adjustmentsApplied, itemsFlagged, zeroMissing }
        });
      } catch (logError) {
        console.warn('[Extensiv] Failed to log sync completion:', logError);
      }

      res.json({
        success: !hasErrors,
        mode: syncMode,
        itemsCompared: comparedCount,
        discrepancies: discrepancyCount,
        adjustmentsApplied,
        itemsFlagged,
        syncedItems: adjustmentsApplied, // backward compatibility
        unmatchedSkus,
        discrepancyDetails: discrepancies.slice(0, 20), // Limit to 20 for response size
        errors,
        message: summary,
      });
    } catch (error: any) {
      const userId = req.session.userId!;
      const config = await storage.getIntegrationConfig(userId, 'EXTENSIV');
      
      // Record failure in integration config
      if (config) {
        await storage.updateIntegrationConfig(config.id, {
          lastSyncAt: new Date(),
          lastSyncStatus: 'FAILED',
          lastSyncMessage: error.message || "Sync failed",
        });
      }
      
      res.status(500).json({ 
        success: false,
        message: error.message || "Integration sync failed" 
      });
    }
  });

  // Extensiv - Fetch products for SKU mapping
  app.get("/api/integrations/extensiv/products", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      
      // Get API key from integration config or environment variable
      const config = await storage.getIntegrationConfig(userId, 'EXTENSIV');
      const apiKey = config?.apiKey || process.env.EXTENSIV_API_KEY;
      const pivotWarehouseId = (config?.config as any)?.pivotWarehouseId || '1';
      const baseUrl = (config?.config as any)?.baseUrl || 'https://api.skubana.com/v1';
      
      if (!apiKey) {
        return res.status(400).json({ 
          success: false,
          message: "Extensiv API key not configured. Please add it in Settings or set EXTENSIV_API_KEY environment variable." 
        });
      }

      const client = new ExtensivClient(apiKey, baseUrl);
      const items = await client.getAllInventory(pivotWarehouseId);
      
      // Transform to consistent format for SKU mapping wizard
      const products = items.map(item => ({
        sku: item.sku,
        name: item.name || item.sku,
        quantity: item.quantity,
        upc: item.upc || null,
        warehouseId: pivotWarehouseId,
      }));

      res.json({
        success: true,
        products,
        totalProducts: products.length,
        warehouseId: pivotWarehouseId,
      });
    } catch (error: any) {
      console.error('[Extensiv] Error fetching products:', error);
      res.status(500).json({ 
        success: false,
        message: error.message || "Failed to fetch Extensiv products" 
      });
    }
  });

  // Shopify - Test Connection
  app.post("/api/integrations/shopify/test", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      
      // Get credentials from integration config or environment variables
      const config = await storage.getIntegrationConfig(userId, 'SHOPIFY');
      const shopDomain = (config?.config as any)?.shopDomain || process.env.SHOPIFY_SHOP_DOMAIN;
      const accessToken = config?.apiKey || process.env.SHOPIFY_ACCESS_TOKEN;
      const apiVersion = (config?.config as any)?.apiVersion || '2024-01';
      
      if (!shopDomain || !accessToken) {
        return res.status(400).json({ 
          success: false,
          message: "Shopify credentials not configured. Please add shop domain and access token in Settings." 
        });
      }

      const client = new ShopifyClient(shopDomain, accessToken, apiVersion);
      const result = await client.testConnection();

      // Update integration config status
      if (config) {
        await storage.updateIntegrationConfig(config.id, {
          lastSyncAt: new Date(),
          lastSyncStatus: result.success ? 'SUCCESS' : 'FAILED',
          lastSyncMessage: result.message,
        });
      }

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ 
        success: false,
        message: error.message || "Failed to test Shopify connection" 
      });
    }
  });

  // Shopify - Fetch products for SKU mapping
  app.get("/api/integrations/shopify/products", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      
      // Get credentials from integration config or environment variables
      const config = await storage.getIntegrationConfig(userId, 'SHOPIFY');
      const shopDomain = (config?.config as any)?.shopDomain || process.env.SHOPIFY_SHOP_DOMAIN;
      const accessToken = config?.apiKey || process.env.SHOPIFY_ACCESS_TOKEN;
      const apiVersion = (config?.config as any)?.apiVersion || '2024-01';
      
      if (!shopDomain || !accessToken) {
        return res.status(400).json({ 
          success: false,
          message: "Shopify credentials not configured. Please add shop domain and access token in Settings." 
        });
      }

      const client = new ShopifyClient(shopDomain, accessToken, apiVersion);
      const products = await client.fetchProductsForMapping();

      res.json({
        success: true,
        products,
        totalProducts: products.length,
        totalVariants: products.reduce((sum, p) => sum + p.variants.length, 0),
      });
    } catch (error: any) {
      console.error('[Shopify] Error fetching products:', error);
      res.status(500).json({ 
        success: false,
        message: error.message || "Failed to fetch Shopify products" 
      });
    }
  });

  // Shopify - Sync Recent Orders (with merge/replace mode support)
  app.post("/api/integrations/shopify/sync", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const { daysBack = 7, mode = "merge" } = req.body;
      const syncMode: "merge" | "replace" = mode === "replace" ? "replace" : "merge";
      
      // Get credentials from integration config or environment variables
      const config = await storage.getIntegrationConfig(userId, 'SHOPIFY');
      const shopDomain = (config?.config as any)?.shopDomain || process.env.SHOPIFY_SHOP_DOMAIN;
      const accessToken = config?.apiKey || process.env.SHOPIFY_ACCESS_TOKEN;
      const apiVersion = (config?.config as any)?.apiVersion || '2024-01';
      
      if (!shopDomain || !accessToken) {
        const message = "Shopify credentials not configured";
        if (config) {
          await storage.updateIntegrationConfig(config.id, {
            lastSyncAt: new Date(),
            lastSyncStatus: 'FAILED',
            lastSyncMessage: message,
          });
        }
        return res.status(400).json({ success: false, message });
      }

      const client = new ShopifyClient(shopDomain, accessToken, apiVersion);
      
      // Get ordersToFetch setting from AI Agent settings
      const aiAgentSettings = await storage.getAiAgentSettingsByUserId(userId);
      const ordersToFetch = aiAgentSettings?.ordersToFetch || 250;
      
      // Set status to PENDING
      if (config) {
        await storage.updateIntegrationConfig(config.id, {
          lastSyncStatus: 'PENDING',
          lastSyncMessage: `Sync in progress (${syncMode} mode)...`,
        });
      }

      // Log sync start
      console.log(`[Shopify] Starting ${syncMode.toUpperCase()} sync from last ${daysBack} days (max ${ordersToFetch} orders)...`);
      try {
        const { logService } = await import('./services/log-service');
        await logService.logIntegrationEvent({
          source: 'SHOPIFY',
          action: 'SYNC_STARTED',
          status: 'INFO',
          message: `Shopify ${syncMode} sync started`,
          details: { mode: syncMode, daysBack, ordersToFetch }
        });
      } catch (logErr) {
        console.warn('[Shopify] Failed to log sync start:', logErr);
      }

      // Fetch recent orders from Shopify
      console.log(`[Shopify] Syncing orders from last ${daysBack} days (max ${ordersToFetch})...`);
      const normalizedOrders = await client.syncRecentOrders(daysBack, ordersToFetch);
      console.log(`[Shopify] Fetched ${normalizedOrders.length} orders`);
      
      // Build a set of Shopify order IDs that we fetched
      const shopifyOrderIds = new Set(normalizedOrders.map(o => o.externalOrderId));

      let createdCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;
      const unmatchedSkus: string[] = [];
      const errors: string[] = [];
      const affectedProductIds = new Set<string>();
      
      // Track synced records for detailed logging
      const syncedRecords: Array<{
        id: string;
        orderNumber?: string;
        customerName?: string;
        status?: string;
        totalAmount?: number;
        currency?: string;
        itemCount?: number;
        syncAction?: 'created' | 'updated' | 'skipped';
        syncReason?: string;
      }> = [];

      // Process each order
      for (const orderData of normalizedOrders) {
        try {
          // Check for existing order by externalOrderId + channel (use efficient lookup)
          const existingOrders = await storage.getSalesOrdersByExternalId(orderData.channel, orderData.externalOrderId);
          const existingOrder = existingOrders[0];

          if (existingOrder) {
            // Update existing order with new fields
            await storage.updateSalesOrder(existingOrder.id, {
              status: orderData.status,
              customerName: orderData.customerName,
              customerEmail: orderData.customerEmail,
              customerPhone: orderData.customerPhone,
              externalCustomerId: orderData.externalCustomerId,
              expectedDeliveryDate: orderData.expectedDeliveryDate,
              sourceUrl: orderData.sourceUrl,
              totalAmount: orderData.totalAmount,
              currency: orderData.currency,
              rawPayload: orderData.rawPayload,
            });
            updatedCount++;
            
            // Track updated record
            syncedRecords.push({
              id: orderData.externalOrderId,
              orderNumber: orderData.externalOrderId,
              customerName: orderData.customerName,
              status: orderData.status,
              totalAmount: orderData.totalAmount,
              currency: orderData.currency,
              itemCount: orderData.lineItems.length,
              syncAction: 'updated',
            });
          } else {
            // Determine fulfillment source using FulfillmentDecisionService
            // This decides whether to ship from Hildale or Pivot/Extensiv based on inventory thresholds
            let fulfillmentSource: 'HILDALE' | 'PIVOT_EXTENSIV' = 'HILDALE';
            try {
              const { FulfillmentDecisionService } = await import('./services/fulfillment-decision-service');
              const fulfillmentService = new FulfillmentDecisionService();
              
              // Pre-scan line items to get product IDs for fulfillment decision
              const productIds: string[] = [];
              for (const lineItem of orderData.lineItems) {
                let product = await storage.getItemBySku(lineItem.sku);
                if (!product) {
                  product = await storage.findProductByShopifySku(lineItem.sku);
                }
                if (product && product.type === 'finished_product') {
                  productIds.push(product.id);
                }
              }
              
              if (productIds.length > 0 && req.user?.id) {
                const orderDecision = await fulfillmentService.decideOrderFulfillment(
                  productIds,
                  req.user.id
                );
                fulfillmentSource = orderDecision.source;
                console.log(`[Shopify] Fulfillment decision for order ${orderData.externalOrderId}: ${fulfillmentSource}`);
              }
            } catch (fulfillmentError) {
              console.warn('[Shopify] Fulfillment decision failed, defaulting to HILDALE:', fulfillmentError);
            }

            // Create new sales order with fulfillment source
            const salesOrder = await storage.createSalesOrder({
              externalOrderId: orderData.externalOrderId,
              externalCustomerId: orderData.externalCustomerId,
              channel: orderData.channel,
              customerName: orderData.customerName,
              customerEmail: orderData.customerEmail,
              customerPhone: orderData.customerPhone,
              status: orderData.status,
              orderDate: orderData.orderDate,
              expectedDeliveryDate: orderData.expectedDeliveryDate,
              sourceUrl: orderData.sourceUrl,
              totalAmount: orderData.totalAmount,
              currency: orderData.currency,
              rawPayload: orderData.rawPayload,
              fulfillmentSource,
            });

            // Create order lines
            for (const lineItem of orderData.lineItems) {
              try {
                // Try to find product by internal/house SKU first, then fall back to Shopify SKU mapping
                let product = await storage.getItemBySku(lineItem.sku);
                
                if (!product) {
                  // Fallback: try to find product by Shopify SKU mapping
                  product = await storage.findProductByShopifySku(lineItem.sku);
                  
                  if (product) {
                    console.log(`[Shopify] Matched SKU ${lineItem.sku} to product ${product.sku} via shopifySku mapping`);
                  }
                }
                
                if (!product) {
                  unmatchedSkus.push(lineItem.sku);
                  console.warn(`[Shopify] SKU not found: ${lineItem.sku} - order ${salesOrder.id} will be created without this line`);
                  
                  // Log SKU mismatch for review
                  try {
                    const { logService } = await import('./services/log-service');
                    await logService.logSkuMismatch({
                      source: 'SHOPIFY',
                      externalSku: lineItem.sku,
                      orderId: orderData.externalOrderId,
                      lineItemData: { 
                        sku: lineItem.sku, 
                        qtyOrdered: lineItem.qtyOrdered,
                        tip: 'Configure via BOM > SKU Mapping'
                      }
                    });
                  } catch (logErr) {
                    console.warn('[Shopify] Failed to log SKU mismatch:', logErr);
                  }
                  
                  continue;
                }

                if (product.type !== 'finished_product') {
                  console.warn(`[Shopify] SKU ${lineItem.sku} is not a finished product - skipping`);
                  continue;
                }

                // Track affected products for backorder refresh
                affectedProductIds.add(product.id);

                // Calculate backorder quantity (ordered - allocated)
                const qtyAllocated = Math.min(lineItem.qtyOrdered, product.pivotQty || 0);
                const backorderQty = lineItem.qtyOrdered - qtyAllocated;

                const createdLine = await storage.createSalesOrderLine({
                  salesOrderId: salesOrder.id,
                  productId: product.id,
                  sku: lineItem.sku,
                  qtyOrdered: lineItem.qtyOrdered,
                  qtyAllocated,
                  qtyShipped: 0,
                  backorderQty,
                  unitPrice: lineItem.unitPrice,
                });

                // V1: Apply InventoryMovement to decrement availableForSaleQty for Pivot-fulfilled orders
                // This ensures real-time sell-through visibility before Extensiv reflects the shipment
                const inventoryMovement = new InventoryMovement(storage);
                await inventoryMovement.apply({
                  eventType: "SALES_ORDER_CREATED",
                  itemId: product.id,
                  quantity: lineItem.qtyOrdered,
                  location: "PIVOT",
                  source: "SYSTEM",
                  orderId: salesOrder.id,
                  salesOrderLineId: createdLine.id,
                  channel: "SHOPIFY",
                  notes: `Shopify order ${orderData.externalOrderId}: ${lineItem.qtyOrdered} ${lineItem.sku} allocated`,
                });
              } catch (lineError: any) {
                errors.push(`${lineItem.sku} in order ${orderData.externalOrderId}: ${lineError.message}`);
                console.error(`[Shopify] Failed to create line for SKU ${lineItem.sku}:`, lineError);
              }
            }

            createdCount++;
            
            // Track created record
            syncedRecords.push({
              id: orderData.externalOrderId,
              orderNumber: orderData.externalOrderId,
              customerName: orderData.customerName,
              status: orderData.status,
              totalAmount: orderData.totalAmount,
              currency: orderData.currency,
              itemCount: orderData.lineItems.length,
              syncAction: 'created',
            });

            // Log sale import
            try {
              await AuditLogger.logSaleImported({
                orderId: salesOrder.id,
                orderNumber: orderData.externalOrderId,
                source: 'SHOPIFY',
                customerName: orderData.customerName,
                totalAmount: typeof orderData.totalAmount === 'string' ? parseFloat(orderData.totalAmount) : orderData.totalAmount,
                itemCount: orderData.lineItems.length,
              });
            } catch (logError) {
              console.warn('[Shopify] Failed to log sale import:', logError);
            }
          }
        } catch (error: any) {
          errors.push(`Order ${orderData.externalOrderId}: ${error.message}`);
          console.error(`[Shopify] Failed to process order ${orderData.externalOrderId}:`, error);
          
          // Track skipped/failed record
          syncedRecords.push({
            id: orderData.externalOrderId,
            orderNumber: orderData.externalOrderId,
            customerName: orderData.customerName,
            status: orderData.status,
            totalAmount: orderData.totalAmount,
            currency: orderData.currency,
            itemCount: orderData.lineItems.length,
            syncAction: 'skipped',
            syncReason: error.message,
          });
          skippedCount++;
        }
      }

      // Log sync completion with detailed records
      try {
        await AuditLogger.logIntegrationSync({
          source: 'SHOPIFY',
          integrationName: 'Shopify Orders',
          recordsProcessed: normalizedOrders.length,
          recordsCreated: createdCount,
          recordsUpdated: updatedCount,
          recordsSkipped: skippedCount,
          syncedRecords,
        });
      } catch (logError) {
        console.warn('[Shopify] Failed to log sync completion:', logError);
      }

      // Refresh backorder snapshots and forecast context for affected products
      console.log(`[Shopify] Refreshing backorder snapshots for ${affectedProductIds.size} products...`);
      for (const productId of Array.from(affectedProductIds)) {
        try {
          await storage.refreshBackorderSnapshot(productId);
          await storage.refreshProductForecastContext(productId);
        } catch (error: any) {
          console.warn(`[Shopify] Failed to refresh snapshot/forecast for product ${productId}:`, error);
        }
      }

      // REPLACE MODE: Archive/remove Shopify orders and clear inventory mappings that don't exist in Shopify
      let ordersArchived = 0;
      let inventoryMappingsCleared = 0;
      let inventoryUpdated = 0;
      
      if (syncMode === "replace") {
        console.log('[Shopify] REPLACE mode: Checking for local Shopify records to archive/remove...');
        
        // 1. Fetch ALL Shopify orders (use a very large window - 3 years) to get a complete picture
        // This is critical: we cannot use the limited daysBack scope for deletion decisions
        console.log('[Shopify] Fetching complete order list from Shopify for replace mode reconciliation...');
        let allShopifyOrderIds = new Set<string>();
        try {
          const allOrders = await client.syncRecentOrders(1095); // 3 years worth of orders
          allShopifyOrderIds = new Set(allOrders.map(o => o.externalOrderId));
          console.log(`[Shopify] Fetched ${allShopifyOrderIds.size} total Shopify orders for reconciliation`);
        } catch (fetchErr: any) {
          console.error('[Shopify] Failed to fetch complete order list for replace mode:', fetchErr);
          errors.push(`Replace mode order reconciliation skipped: ${fetchErr.message}`);
          // Don't proceed with archiving if we couldn't get a complete picture
        }
        
        // 2. Archive/soft-delete local Shopify orders that no longer exist in the complete Shopify order set
        if (allShopifyOrderIds.size > 0) {
          try {
            const localShopifyOrders = await storage.getSalesOrdersByChannel('SHOPIFY');
            for (const localOrder of localShopifyOrders) {
              // Skip already archived orders
              if (localOrder.status === 'ARCHIVED') continue;
              
              if (localOrder.externalOrderId && !allShopifyOrderIds.has(localOrder.externalOrderId)) {
                // This local Shopify order doesn't exist in Shopify anymore - archive it
                try {
                  await storage.updateSalesOrder(localOrder.id, { 
                    status: 'ARCHIVED',
                    notes: `Archived by Shopify Replace sync on ${new Date().toISOString()} - order no longer exists in Shopify`
                  });
                  ordersArchived++;
                  console.log(`[Shopify] Archived order ${localOrder.externalOrderId} (not in Shopify)`);
                } catch (archiveErr: any) {
                  errors.push(`Failed to archive order ${localOrder.externalOrderId}: ${archiveErr.message}`);
                }
              }
            }
            console.log(`[Shopify] Archived ${ordersArchived} orders that no longer exist in Shopify`);
          } catch (orderErr: any) {
            console.error('[Shopify] Error checking orders for archive:', orderErr);
            errors.push(`Failed to check orders for archiving: ${orderErr.message}`);
          }
        } else {
          console.log('[Shopify] Skipping order archival - could not fetch complete order list from Shopify');
        }
        
        // 3. Clear Shopify inventory mappings for products that no longer exist in Shopify
        try {
          // Fetch all Shopify products/variants to know what's valid
          console.log('[Shopify] Fetching complete product catalog from Shopify for mapping reconciliation...');
          const shopifyProducts = await client.fetchProductsForMapping();
          const validVariantIds = new Set<string>();
          const validShopifySkus = new Set<string>();
          
          for (const product of shopifyProducts) {
            for (const variant of product.variants) {
              validVariantIds.add(String(variant.id));
              if (variant.sku) {
                validShopifySkus.add(variant.sku);
              }
            }
          }
          
          console.log(`[Shopify] Fetched ${shopifyProducts.length} products with ${validVariantIds.size} variants for reconciliation`);
          
          // Safety check: only proceed if we got a reasonable catalog
          if (validVariantIds.size === 0) {
            console.warn('[Shopify] Skipping mapping cleanup - no products/variants returned from Shopify (catalog may be incomplete)');
            errors.push('Mapping cleanup skipped: Shopify product catalog appears empty');
          } else {
            // Get all items with Shopify mappings
            const allItems = await storage.getAllItems();
            for (const item of allItems) {
              let needsUpdate = false;
              const updates: any = {};
              
              // Check if the shopifyVariantId is still valid
              if (item.shopifyVariantId && !validVariantIds.has(item.shopifyVariantId)) {
                updates.shopifyVariantId = null;
                updates.shopifyInventoryItemId = null;
                needsUpdate = true;
                console.log(`[Shopify] Clearing variant mapping for ${item.sku} (variant ${item.shopifyVariantId} no longer exists)`);
              }
              
              // Check if the shopifySku is still valid
              if (item.shopifySku && !validShopifySkus.has(item.shopifySku)) {
                updates.shopifySku = null;
                needsUpdate = true;
                console.log(`[Shopify] Clearing SKU mapping for ${item.sku} (Shopify SKU ${item.shopifySku} no longer exists)`);
              }
              
              if (needsUpdate) {
                await storage.updateItem(item.id, updates);
                inventoryMappingsCleared++;
              }
            }
            console.log(`[Shopify] Cleared ${inventoryMappingsCleared} Shopify mappings that no longer exist`);
          }
        } catch (mappingErr: any) {
          console.error('[Shopify] Error clearing inventory mappings:', mappingErr);
          errors.push(`Failed to clear inventory mappings: ${mappingErr.message}`);
        }
        
        // Log replace mode completion
        try {
          const { logService } = await import('./services/log-service');
          await logService.logIntegrationEvent({
            source: 'SHOPIFY',
            action: 'REPLACE_SYNC_COMPLETED',
            status: 'SUCCESS',
            message: `Shopify replace sync completed: ${ordersArchived} orders archived, ${inventoryMappingsCleared} mappings cleared`,
            details: { mode: syncMode, ordersArchived, inventoryMappingsCleared }
          });
        } catch (logErr) {
          console.warn('[Shopify] Failed to log replace sync completion:', logErr);
        }
      }

      // =============== REFUNDS SYNC ===============
      // Sync Shopify refunds as return requests
      let refundsCreated = 0;
      let refundsSkipped = 0;
      
      try {
        console.log(`[Shopify] Syncing refunds from last ${daysBack} days...`);
        const refunds = await client.fetchRefunds(daysBack, ordersToFetch);
        
        for (const refund of refunds) {
          try {
            const refundId = String(refund.id);
            const orderId = String(refund.order_id);
            
            // Check if we already have a return for this refund (idempotency)
            const existingReturns = await storage.getReturnRequestByExternalOrderId(`SHOPIFY-REFUND-${refundId}`);
            if (existingReturns.length > 0) {
              refundsSkipped++;
              continue;
            }
            
            // Find linked sales order
            const existingOrders = await storage.getSalesOrdersByExternalId('SHOPIFY', orderId);
            const existingOrder = existingOrders[0];
            
            // Extract customer info
            const customerName = existingOrder?.customerName || 
              (refund.customer ? `${refund.customer.first_name || ''} ${refund.customer.last_name || ''}`.trim() : 'Shopify Customer') ||
              'Unknown Customer';
            const customerEmail = existingOrder?.customerEmail || refund.customer?.email || null;
            const customerPhone = existingOrder?.customerPhone || refund.customer?.phone || null;
            
            // Calculate total refund amount
            const totalRefundAmount = (refund.transactions || [])
              .filter((t: any) => t.kind === 'refund' && t.status === 'success')
              .reduce((sum: number, t: any) => sum + parseFloat(t.amount || 0), 0);
            
            // Generate RMA number
            const rmaNumber = await storage.getNextRMANumber();
            
            // Create the return request
            const returnRequest = await storage.createReturnRequest({
              rmaNumber,
              salesOrderId: existingOrder?.id || null,
              orderNumber: existingOrder?.externalOrderId || refund.order_name || orderId,
              externalOrderId: `SHOPIFY-REFUND-${refundId}`,
              salesChannel: 'SHOPIFY',
              source: 'SHOPIFY_SYNC',
              customerName,
              customerEmail,
              customerPhone,
              status: 'REFUNDED',
              resolutionRequested: 'REFUND',
              resolutionFinal: 'REFUND',
              resolutionNotes: `Refund synced from Shopify. Amount: $${totalRefundAmount.toFixed(2)}`,
              reason: refund.note || 'Refund from Shopify',
              requestedAt: new Date(refund.created_at || Date.now()),
              refundedAt: new Date(refund.processed_at || refund.created_at || Date.now()),
              isHistorical: true,
              archivedAt: new Date(),
            });
            
            // Create return items
            for (const refundLineItem of refund.refund_line_items || []) {
              const lineItem = refundLineItem.line_item || {};
              const sku = lineItem.sku || `SHOPIFY-LINE-${refundLineItem.line_item_id}`;
              const quantity = refundLineItem.quantity || 1;
              const unitPrice = parseFloat(lineItem.price) || 0;
              const productName = lineItem.title || lineItem.name || 'Unknown Product';
              
              const item = await storage.getItemBySku(sku);
              
              await storage.createReturnItem({
                returnRequestId: returnRequest.id,
                inventoryItemId: item?.id || null,
                sku,
                productName,
                unitPrice,
                qtyOrdered: lineItem.quantity || quantity,
                qtyRequested: quantity,
                qtyApproved: quantity,
                qtyReceived: refundLineItem.restock_type === 'return' ? quantity : 0,
                condition: refundLineItem.restock_type === 'return' ? 'GOOD' : null,
                disposition: refundLineItem.restock_type === 'return' ? 'RETURN_TO_STOCK' : null,
                itemReason: `Shopify refund (${refundLineItem.restock_type || 'no_restock'})`,
              });
            }
            
            refundsCreated++;
            console.log(`[Shopify] Created return ${rmaNumber} for refund ${refundId}`);
          } catch (refundErr: any) {
            console.warn(`[Shopify] Failed to process refund ${refund.id}:`, refundErr.message);
            errors.push(`Refund ${refund.id}: ${refundErr.message}`);
          }
        }
        
        console.log(`[Shopify] Refunds sync complete: ${refundsCreated} created, ${refundsSkipped} skipped (already exist)`);
      } catch (refundsErr: any) {
        console.error('[Shopify] Error syncing refunds:', refundsErr);
        errors.push(`Refunds sync failed: ${refundsErr.message}`);
      }

      const refundsSummary = refundsCreated > 0 ? `, ${refundsCreated} refunds synced` : '';
      const summary = syncMode === "replace"
        ? `Created ${createdCount}, updated ${updatedCount} orders. ${ordersArchived} archived, ${inventoryMappingsCleared} mappings cleared${refundsSummary}. ${unmatchedSkus.length} unmatched SKUs${errors.length > 0 ? `, ${errors.length} errors` : ''}`
        : `Created ${createdCount}, updated ${updatedCount} orders${refundsSummary}. ${unmatchedSkus.length} unmatched SKUs${errors.length > 0 ? `, ${errors.length} errors` : ''}`;
      const hasErrors = errors.length > 0;
      
      // Update integration config status
      if (config) {
        await storage.updateIntegrationConfig(config.id, {
          lastSyncAt: new Date(),
          lastSyncStatus: hasErrors ? 'FAILED' : 'SUCCESS',
          lastSyncMessage: summary,
        });
      }

      // Log sync completion
      try {
        const { logService } = await import('./services/log-service');
        await logService.logIntegrationEvent({
          source: 'SHOPIFY',
          action: 'SYNC_COMPLETED',
          status: hasErrors ? 'WARNING' : 'SUCCESS',
          message: summary,
          details: { 
            mode: syncMode, 
            createdOrders: createdCount, 
            updatedOrders: updatedCount,
            ordersArchived,
            inventoryMappingsCleared,
            inventoryUpdated,
            unmatchedSkus: unmatchedSkus.length,
            errors: errors.length 
          }
        });
      } catch (logErr) {
        console.warn('[Shopify] Failed to log sync completion:', logErr);
      }

      res.json({
        success: !hasErrors,
        mode: syncMode,
        createdOrders: createdCount,
        updatedOrders: updatedCount,
        ordersArchived,
        inventoryUpdated,
        inventoryMappingsCleared,
        refundsCreated,
        refundsSkipped,
        unmatchedSkus,
        errors,
        message: summary,
      });
    } catch (error: any) {
      const userId = req.session.userId!;
      const config = await storage.getIntegrationConfig(userId, 'SHOPIFY');
      
      // Record failure in integration config
      if (config) {
        await storage.updateIntegrationConfig(config.id, {
          lastSyncAt: new Date(),
          lastSyncStatus: 'FAILED',
          lastSyncMessage: error.message || "Sync failed",
        });
      }
      
      res.status(500).json({ 
        success: false,
        message: error.message || "Integration sync failed" 
      });
    }
  });

  // Amazon - Test Connection
  app.post("/api/integrations/amazon/test", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      
      // Get credentials from integration config or environment variables
      const config = await storage.getIntegrationConfig(userId, 'AMAZON');
      const configData = config?.config as Record<string, any> || {};
      const sellerId = configData.sellerId || process.env.AMAZON_SELLER_ID;
      const marketplaceIds = configData.marketplaceIds || [];
      const marketplaceId = marketplaceIds[0] || process.env.AMAZON_MARKETPLACE_ID || 'ATVPDKIKX0DER';
      const region = configData.region || 'NA';
      const refreshToken = config?.apiKey || process.env.AMAZON_REFRESH_TOKEN;
      const clientId = configData.clientId || process.env.AMAZON_CLIENT_ID;
      const clientSecret = configData.clientSecret || process.env.AMAZON_CLIENT_SECRET;
      
      if (!sellerId || !refreshToken || !clientId || !clientSecret) {
        return res.status(400).json({ 
          success: false,
          message: "Amazon SP-API credentials not configured. Please add seller ID, refresh token, client ID, and client secret in Settings." 
        });
      }

      const client = new AmazonClient(sellerId, marketplaceId, refreshToken, clientId, clientSecret, region);
      const result = await client.testConnection();

      // Update integration config status
      if (config) {
        await storage.updateIntegrationConfig(config.id, {
          lastSyncAt: new Date(),
          lastSyncStatus: result.success ? 'SUCCESS' : 'FAILED',
          lastSyncMessage: result.message,
        });
      }

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ 
        success: false,
        message: error.message || "Failed to test Amazon connection" 
      });
    }
  });

  // Amazon - Sync Recent Orders
  // Mode: "import" (import/update only) or "align" (import + archive removed + push inventory if 2-way)
  app.post("/api/integrations/amazon/sync", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const { daysBack = 7, mode = "import" } = req.body;
      const syncMode = mode === "align" ? "align" : "import"; // Default to "import" (safer)
      console.log(`[Amazon] Starting sync in ${syncMode.toUpperCase()} mode`);
      
      // Get credentials from integration config or environment variables
      const config = await storage.getIntegrationConfig(userId, 'AMAZON');
      const configData = config?.config as Record<string, any> || {};
      const sellerId = configData.sellerId || process.env.AMAZON_SELLER_ID;
      const marketplaceIds = configData.marketplaceIds || [];
      const marketplaceId = marketplaceIds[0] || process.env.AMAZON_MARKETPLACE_ID || 'ATVPDKIKX0DER';
      const region = configData.region || 'NA';
      const refreshToken = config?.apiKey || process.env.AMAZON_REFRESH_TOKEN;
      const clientId = configData.clientId || process.env.AMAZON_CLIENT_ID;
      const clientSecret = configData.clientSecret || process.env.AMAZON_CLIENT_SECRET;
      
      if (!sellerId || !refreshToken || !clientId || !clientSecret) {
        const message = "Amazon SP-API credentials not configured";
        if (config) {
          await storage.updateIntegrationConfig(config.id, {
            lastSyncAt: new Date(),
            lastSyncStatus: 'FAILED',
            lastSyncMessage: message,
          });
        }
        return res.status(400).json({ success: false, message });
      }

      const client = new AmazonClient(sellerId, marketplaceId, refreshToken, clientId, clientSecret, region);
      
      // Get ordersToFetch setting from AI Agent settings
      const aiAgentSettings = await storage.getAiAgentSettingsByUserId(userId);
      const ordersToFetch = aiAgentSettings?.ordersToFetch || 250;
      
      // Set status to PENDING
      if (config) {
        await storage.updateIntegrationConfig(config.id, {
          lastSyncStatus: 'PENDING',
          lastSyncMessage: 'Sync in progress...',
        });
      }

      // Fetch recent orders from Amazon
      console.log(`[Amazon] Syncing orders from last ${daysBack} days (max ${ordersToFetch})...`);
      const normalizedOrders = await client.syncRecentOrders(daysBack, ordersToFetch);
      console.log(`[Amazon] Fetched ${normalizedOrders.length} orders`);

      let createdCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;
      const unmatchedSkus: string[] = [];
      const errors: string[] = [];
      const affectedProductIds = new Set<string>();
      
      // Track synced records for detailed logging
      const syncedRecords: Array<{
        id: string;
        orderNumber?: string;
        customerName?: string;
        status?: string;
        totalAmount?: number;
        currency?: string;
        itemCount?: number;
        syncAction?: 'created' | 'updated' | 'skipped';
        syncReason?: string;
      }> = [];

      // Process each order
      for (const orderData of normalizedOrders) {
        try {
          // Check for existing order by externalOrderId + channel (use efficient lookup)
          const existingOrders = await storage.getSalesOrdersByExternalId(orderData.channel, orderData.externalOrderId);
          const existingOrder = existingOrders[0];

          if (existingOrder) {
            // Update existing order with new fields
            await storage.updateSalesOrder(existingOrder.id, {
              status: orderData.status,
              customerName: orderData.customerName,
              customerEmail: orderData.customerEmail,
              customerPhone: orderData.customerPhone,
              externalCustomerId: orderData.externalCustomerId,
              expectedDeliveryDate: orderData.expectedDeliveryDate,
              sourceUrl: orderData.sourceUrl,
              totalAmount: orderData.totalAmount,
              currency: orderData.currency,
              rawPayload: orderData.rawPayload,
            });
            updatedCount++;
            
            // Track updated record
            syncedRecords.push({
              id: orderData.externalOrderId,
              orderNumber: orderData.externalOrderId,
              customerName: orderData.customerName,
              status: orderData.status,
              totalAmount: orderData.totalAmount,
              currency: orderData.currency,
              itemCount: orderData.lineItems.length,
              syncAction: 'updated',
            });
          } else {
            // Determine fulfillment source using FulfillmentDecisionService
            // This decides whether to ship from Hildale or Pivot/Extensiv based on inventory thresholds
            let fulfillmentSource: 'HILDALE' | 'PIVOT_EXTENSIV' = 'HILDALE';
            try {
              const { FulfillmentDecisionService } = await import('./services/fulfillment-decision-service');
              const fulfillmentService = new FulfillmentDecisionService();
              
              // Pre-scan line items to get product IDs for fulfillment decision
              const productIds: string[] = [];
              for (const lineItem of orderData.lineItems) {
                let product = await storage.getItemBySku(lineItem.sku);
                if (!product) {
                  product = await storage.findProductByAmazonSku(lineItem.sku);
                }
                if (product && product.type === 'finished_product') {
                  productIds.push(product.id);
                }
              }
              
              if (productIds.length > 0 && req.user?.id) {
                const orderDecision = await fulfillmentService.decideOrderFulfillment(
                  productIds,
                  req.user.id
                );
                fulfillmentSource = orderDecision.source;
                console.log(`[Amazon] Fulfillment decision for order ${orderData.externalOrderId}: ${fulfillmentSource}`);
              }
            } catch (fulfillmentError) {
              console.warn('[Amazon] Fulfillment decision failed, defaulting to HILDALE:', fulfillmentError);
            }

            // Create new sales order with fulfillment source
            const salesOrder = await storage.createSalesOrder({
              externalOrderId: orderData.externalOrderId,
              externalCustomerId: orderData.externalCustomerId,
              channel: orderData.channel,
              customerName: orderData.customerName,
              customerEmail: orderData.customerEmail,
              customerPhone: orderData.customerPhone,
              status: orderData.status,
              orderDate: orderData.orderDate,
              expectedDeliveryDate: orderData.expectedDeliveryDate,
              sourceUrl: orderData.sourceUrl,
              totalAmount: orderData.totalAmount,
              currency: orderData.currency,
              rawPayload: orderData.rawPayload,
              fulfillmentSource,
            });

            // Create order lines
            for (const lineItem of orderData.lineItems) {
              try {
                // Try to find product by internal/house SKU first, then fall back to Amazon SKU mapping
                let product = await storage.getItemBySku(lineItem.sku);
                
                if (!product) {
                  // Fallback: try to find product by Amazon SKU mapping
                  product = await storage.findProductByAmazonSku(lineItem.sku);
                  
                  if (product) {
                    console.log(`[Amazon] Matched SKU ${lineItem.sku} to product ${product.sku} via amazonSku mapping`);
                  }
                }
                
                if (!product) {
                  unmatchedSkus.push(lineItem.sku);
                  console.warn(`[Amazon] SKU not found: ${lineItem.sku} - order ${salesOrder.id} will be created without this line`);
                  
                  // Log SKU mismatch for review
                  try {
                    const { logService } = await import('./services/log-service');
                    await logService.logSkuMismatch({
                      source: 'AMAZON',
                      externalSku: lineItem.sku,
                      orderId: orderData.externalOrderId,
                      lineItemData: { 
                        sku: lineItem.sku, 
                        qtyOrdered: lineItem.qtyOrdered,
                        tip: 'Configure via BOM > SKU Mapping'
                      }
                    });
                  } catch (logErr) {
                    console.warn('[Amazon] Failed to log SKU mismatch:', logErr);
                  }
                  
                  continue;
                }

                if (product.type !== 'finished_product') {
                  console.warn(`[Amazon] SKU ${lineItem.sku} is not a finished product - skipping`);
                  continue;
                }

                // Track affected products for backorder refresh
                affectedProductIds.add(product.id);

                // Calculate backorder quantity (ordered - allocated)
                const qtyAllocated = Math.min(lineItem.qtyOrdered, product.pivotQty || 0);
                const backorderQty = lineItem.qtyOrdered - qtyAllocated;

                const createdLine = await storage.createSalesOrderLine({
                  salesOrderId: salesOrder.id,
                  productId: product.id,
                  sku: lineItem.sku,
                  qtyOrdered: lineItem.qtyOrdered,
                  qtyAllocated,
                  qtyShipped: 0,
                  backorderQty,
                  unitPrice: lineItem.unitPrice,
                });

                // V1: Apply InventoryMovement to decrement availableForSaleQty for Pivot-fulfilled orders
                // This ensures real-time sell-through visibility before Extensiv reflects the shipment
                const inventoryMovement = new InventoryMovement(storage);
                await inventoryMovement.apply({
                  eventType: "SALES_ORDER_CREATED",
                  itemId: product.id,
                  quantity: lineItem.qtyOrdered,
                  location: "PIVOT",
                  source: "SYSTEM",
                  orderId: salesOrder.id,
                  salesOrderLineId: createdLine.id,
                  channel: "AMAZON",
                  notes: `Amazon order ${orderData.externalOrderId}: ${lineItem.qtyOrdered} ${lineItem.sku} allocated`,
                });
              } catch (lineError: any) {
                errors.push(`${lineItem.sku} in order ${orderData.externalOrderId}: ${lineError.message}`);
                console.error(`[Amazon] Failed to create line for SKU ${lineItem.sku}:`, lineError);
              }
            }

            createdCount++;
            
            // Track created record
            syncedRecords.push({
              id: orderData.externalOrderId,
              orderNumber: orderData.externalOrderId,
              customerName: orderData.customerName,
              status: orderData.status,
              totalAmount: orderData.totalAmount,
              currency: orderData.currency,
              itemCount: orderData.lineItems.length,
              syncAction: 'created',
            });

            // Log sale import
            try {
              await AuditLogger.logSaleImported({
                orderId: salesOrder.id,
                orderNumber: orderData.externalOrderId,
                source: 'AMAZON',
                customerName: orderData.customerName,
                totalAmount: typeof orderData.totalAmount === 'string' ? parseFloat(orderData.totalAmount) : orderData.totalAmount,
                itemCount: orderData.lineItems.length,
              });
            } catch (logError) {
              console.warn('[Amazon] Failed to log sale import:', logError);
            }
          }
        } catch (error: any) {
          errors.push(`Order ${orderData.externalOrderId}: ${error.message}`);
          console.error(`[Amazon] Failed to process order ${orderData.externalOrderId}:`, error);
          
          // Track skipped/failed record
          syncedRecords.push({
            id: orderData.externalOrderId,
            orderNumber: orderData.externalOrderId,
            customerName: orderData.customerName,
            status: orderData.status,
            totalAmount: orderData.totalAmount,
            currency: orderData.currency,
            itemCount: orderData.lineItems.length,
            syncAction: 'skipped',
            syncReason: error.message,
          });
          skippedCount++;
        }
      }

      // Log sync completion with detailed records
      try {
        await AuditLogger.logIntegrationSync({
          source: 'AMAZON',
          integrationName: 'Amazon Orders',
          recordsProcessed: normalizedOrders.length,
          recordsCreated: createdCount,
          recordsUpdated: updatedCount,
          recordsSkipped: skippedCount,
          syncedRecords,
        });
      } catch (logError) {
        console.warn('[Amazon] Failed to log sync completion:', logError);
      }

      // Refresh backorder snapshots and forecast context for affected products
      console.log(`[Amazon] Refreshing backorder snapshots for ${affectedProductIds.size} products...`);
      for (const productId of Array.from(affectedProductIds)) {
        try {
          await storage.refreshBackorderSnapshot(productId);
          await storage.refreshProductForecastContext(productId);
        } catch (error: any) {
          console.warn(`[Amazon] Failed to refresh snapshot/forecast for product ${productId}:`, error);
        }
      }

      // ALIGN MODE: Archive removed orders + push inventory if 2-way sync enabled
      let ordersArchived = 0;
      let inventoryPushed = 0;
      let alignFetchFailed = false;
      
      if (syncMode === "align") {
        console.log('[Amazon] Align mode: fetching complete order list for safe archival...');
        
        // CRITICAL: For align mode, we need a comprehensive fetch (3 years like Shopify)
        // to avoid incorrectly archiving valid older orders not in the short daysBack window
        // Use a very high limit to avoid capping older orders
        let allAmazonOrderIds = new Set<string>();
        const alignMaxOrders = 50000; // Very high limit for align mode to capture all historical orders
        
        try {
          // Fetch 3 years of orders with an unbounded limit for comprehensive archival comparison
          console.log('[Amazon] Fetching complete order list from Amazon for align mode reconciliation (up to 50k orders, 3 years)...');
          const allAmazonOrders = await client.syncRecentOrders(1095, alignMaxOrders);
          allAmazonOrderIds = new Set(allAmazonOrders.map(o => o.externalOrderId));
          console.log(`[Amazon] Fetched ${allAmazonOrderIds.size} total Amazon orders for archival comparison`);
          
          // Guardrail: If we hit the max limit, fail safe - skip archival to avoid false deletions
          if (allAmazonOrders.length >= alignMaxOrders) {
            console.warn(`[Amazon] WARNING: Fetched exactly ${alignMaxOrders} orders - order list may be truncated. Skipping archival to prevent false deletions.`);
            errors.push(`Archival skipped: Amazon order list truncated at ${alignMaxOrders} limit`);
            alignFetchFailed = true; // Treat as failed to skip archival
          }
        } catch (fetchErr: any) {
          console.error('[Amazon] Failed to fetch complete order list for align mode:', fetchErr);
          errors.push(`Failed to fetch complete Amazon order list: ${fetchErr.message}`);
          alignFetchFailed = true;
        }
        
        // Only proceed with archival if we successfully fetched the COMPLETE order list
        if (!alignFetchFailed && allAmazonOrderIds.size > 0) {
          console.log('[Amazon] Checking local orders against Amazon complete list...');
          try {
            const localAmazonOrders = await storage.getSalesOrdersByChannel('AMAZON');
            const activeLocalOrders = localAmazonOrders.filter(o => 
              o.status !== 'ARCHIVED' && o.status !== 'CANCELLED'
            );
            
            // Additional safeguard: Log comparison metrics to detect under-fetch scenarios
            console.log(`[Amazon] Align comparison: ${allAmazonOrderIds.size} Amazon orders vs ${activeLocalOrders.length} local active orders`);
            
            // CRITICAL GUARDRAIL: If we have significantly more local orders than fetched, skip archival
            // This indicates we didn't fetch the complete Amazon order history
            if (activeLocalOrders.length > allAmazonOrderIds.size * 1.5 && allAmazonOrderIds.size < 100) {
              console.warn(`[Amazon] ARCHIVAL SKIPPED: Local order count (${activeLocalOrders.length}) significantly exceeds fetched (${allAmazonOrderIds.size}). Fetch may be incomplete.`);
              errors.push(`Archival skipped: Local order count suggests incomplete Amazon fetch`);
            } else {
              // Safe to proceed with archival
              for (const localOrder of activeLocalOrders) {
                if (localOrder.externalOrderId && !allAmazonOrderIds.has(localOrder.externalOrderId)) {
                  try {
                    await storage.updateSalesOrder(localOrder.id, { 
                      status: 'ARCHIVED',
                      notes: `Archived by Amazon Align sync on ${new Date().toISOString()} - order no longer exists on Amazon`
                    });
                    ordersArchived++;
                    console.log(`[Amazon] Archived order ${localOrder.externalOrderId} (not in Amazon)`);
                  } catch (archiveErr: any) {
                    errors.push(`Failed to archive order ${localOrder.externalOrderId}: ${archiveErr.message}`);
                  }
                }
              }
              console.log(`[Amazon] Archived ${ordersArchived} orders that no longer exist on Amazon`);
            }
          } catch (archiveError: any) {
            console.error('[Amazon] Error archiving orders:', archiveError);
            errors.push(`Failed to check orders for archiving: ${archiveError.message}`);
          }
        } else if (alignFetchFailed) {
          console.log('[Amazon] Skipping order archival - could not fetch complete order list from Amazon');
        }
        
        // Check if Amazon 2-way sync is enabled and push inventory
        try {
          const { AIAgentRulesService } = await import('./services/ai-agent-rules-service');
          const rulesService = new AIAgentRulesService();
          const rules = await rulesService.getRules(userId) || {};
          
          if (rules.amazonTwoWayInventorySync) {
            console.log('[Amazon] 2-way sync enabled: pushing inventory to Amazon...');
            // This would call the inventory push logic
            // For now, log that it would happen
            console.log('[Amazon] Inventory push to Amazon (placeholder - requires inventory API implementation)');
            // inventoryPushed = await pushInventoryToAmazon(client, storage);
          }
        } catch (ruleError: any) {
          console.warn('[Amazon] Failed to check 2-way sync rules:', ruleError);
        }
      }

      const summary = `Created ${createdCount}, updated ${updatedCount} orders${syncMode === "align" ? `, ${ordersArchived} archived` : ''}. ${unmatchedSkus.length} unmatched SKUs${errors.length > 0 ? `, ${errors.length} errors` : ''}`;
      const hasErrors = errors.length > 0;
      
      // Update integration config status
      if (config) {
        await storage.updateIntegrationConfig(config.id, {
          lastSyncAt: new Date(),
          lastSyncStatus: hasErrors ? 'FAILED' : 'SUCCESS',
          lastSyncMessage: summary,
        });
      }

      // Log sync completion with mode
      try {
        const { logService } = await import('./services/log-service');
        await logService.logIntegrationEvent({
          source: 'AMAZON',
          action: syncMode === "align" ? 'ALIGN_SYNC_COMPLETED' : 'IMPORT_SYNC_COMPLETED',
          status: hasErrors ? 'PARTIAL' : 'SUCCESS',
          message: summary,
          details: { mode: syncMode, createdCount, updatedCount, ordersArchived, inventoryPushed }
        });
      } catch (logError) {
        console.warn('[Amazon] Failed to log sync completion:', logError);
      }

      res.json({
        success: !hasErrors,
        mode: syncMode,
        ordersImported: createdCount,
        ordersUpdated: updatedCount,
        ordersArchived,
        inventoryPushed,
        inventoryRecords: affectedProductIds.size,
        createdOrders: createdCount,
        updatedOrders: updatedCount,
        unmatchedSkus,
        errors,
        message: summary,
      });
    } catch (error: any) {
      const userId = req.session.userId!;
      const config = await storage.getIntegrationConfig(userId, 'AMAZON');
      
      // Record failure in integration config
      if (config) {
        await storage.updateIntegrationConfig(config.id, {
          lastSyncAt: new Date(),
          lastSyncStatus: 'FAILED',
          lastSyncMessage: error.message || "Sync failed",
        });
      }
      
      res.status(500).json({ 
        success: false,
        message: error.message || "Integration sync failed" 
      });
    }
  });

  // Amazon - Fetch Listings for SKU Mapping
  app.get("/api/integrations/amazon/products", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      
      const config = await storage.getIntegrationConfig(userId, 'AMAZON');
      const configData = config?.config as Record<string, any> || {};
      const sellerId = configData.sellerId;
      const marketplaceIds = configData.marketplaceIds || [];
      const marketplaceId = marketplaceIds[0];
      const region = configData.region || 'NA';
      const refreshToken = config?.apiKey;
      const clientId = configData.clientId;
      const clientSecret = configData.clientSecret;
      
      if (!sellerId || !marketplaceId || !refreshToken || !clientId) {
        return res.status(400).json({ 
          success: false,
          message: "Amazon SP-API credentials not configured",
          products: [] 
        });
      }

      const client = new AmazonClient(
        sellerId, 
        marketplaceId, 
        refreshToken, 
        clientId, 
        clientSecret || '',
        region
      );
      
      const listings = await client.fetchListingsForMapping();
      
      console.log(`[Amazon] Fetched ${listings.length} listings for SKU mapping`);
      
      res.json({
        success: true,
        products: listings.map(listing => ({
          sellerSku: listing.sellerSku,
          asin: listing.asin,
          title: listing.title,
          gtin: listing.gtin,
          fnSku: listing.fnSku,
          fulfillmentChannel: listing.fulfillmentChannel,
          status: listing.status,
          quantity: listing.quantity,
        })),
      });
    } catch (error: any) {
      console.error('[Amazon] Failed to fetch listings:', error);
      res.status(500).json({ 
        success: false,
        message: error.message || "Failed to fetch Amazon listings",
        products: [] 
      });
    }
  });

  // Amazon - Sync Inventory to Amazon (Two-Way)
  app.post("/api/amazon/sync-inventory", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const { itemId } = req.body;

      const { amazonInventorySyncService } = await import('./services/amazon-inventory-sync-service');
      
      const initialized = await amazonInventorySyncService.initialize(userId);
      if (!initialized) {
        return res.status(400).json({
          success: false,
          message: 'Amazon integration not configured',
        });
      }

      if (itemId) {
        const item = await storage.getItem(itemId);
        if (!item) {
          return res.status(404).json({
            success: false,
            message: 'Item not found',
          });
        }

        const result = await amazonInventorySyncService.syncItemInventory(item);
        return res.json({
          success: result.synced,
          dryRun: result.dryRun,
          message: result.message,
        });
      } else {
        const result = await amazonInventorySyncService.syncAllInventory();
        return res.json({
          success: true,
          ...result,
        });
      }
    } catch (error: any) {
      console.error('[Amazon] Inventory sync error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to sync inventory to Amazon',
      });
    }
  });

  // Amazon - Get Sync Status
  app.get("/api/amazon/sync-status", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      
      const config = await storage.getIntegrationConfig(userId, 'AMAZON');
      const configData = config?.config as Record<string, any> || {};
      
      const aiAgentSettings = await storage.getAiAgentSettingsByUserId(userId);
      const amazonTwoWaySync = aiAgentSettings?.amazonTwoWaySync ?? false;
      const amazonSafetyBuffer = aiAgentSettings?.amazonSafetyBuffer ?? 0;
      const pushInventory = configData.pushInventory ?? false;
      
      // Get mapped item count from items
      const allItems = await storage.getAllItems();
      const mappedCount = allItems.filter(item => 
        item.type === 'finished_product' && item.amazonSku
      ).length;
      
      res.json({
        configured: !!config?.apiKey,
        amazonTwoWaySync,
        amazonSafetyBuffer,
        pushInventory,
        mappedItemCount: mappedCount,
        lastSyncAt: config?.lastSyncAt,
        lastSyncStatus: config?.lastSyncStatus,
        lastSyncMessage: config?.lastSyncMessage,
        syncMode: amazonTwoWaySync 
          ? (pushInventory ? '2-Way (Inventory Push Enabled)' : '2-Way (Push Off)')
          : '1-Way (Inbound Only)',
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to get Amazon sync status',
      });
    }
  });

  // GoHighLevel - Status (check if configured and connected)
  app.get("/api/integrations/gohighlevel/status", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const config = await storage.getIntegrationConfig(userId, 'GOHIGHLEVEL');
      
      if (!config) {
        return res.json({
          configured: false,
          isConnected: false,
          message: 'GoHighLevel not configured',
        });
      }
      
      const apiKey = config.apiKey;
      const locationId = (config.config as any)?.locationId;
      
      if (!apiKey || !locationId) {
        return res.json({
          configured: false,
          isConnected: false,
          message: 'Missing API key or Location ID',
          hasApiKey: !!apiKey,
          hasLocationId: !!locationId,
        });
      }
      
      return res.json({
        configured: true,
        isConnected: config.lastSyncStatus === 'SUCCESS',
        isEnabled: config.isEnabled,
        lastSyncAt: config.lastSyncAt,
        lastSyncStatus: config.lastSyncStatus,
        lastSyncMessage: config.lastSyncMessage,
        hasApiKey: true,
        hasLocationId: true,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to get GoHighLevel status" });
    }
  });

  // GoHighLevel - Test Connection
  app.post("/api/integrations/gohighlevel/test", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      
      // Get credentials from integration config
      const config = await storage.getIntegrationConfig(userId, 'GOHIGHLEVEL');
      // V2 API uses a different base URL
      const baseUrl = 'https://services.leadconnectorhq.com';
      // Check environment variable first, then fall back to stored config
      const apiKey = process.env.GOHIGHLEVEL_API_KEY || config?.apiKey;
      const locationId = (config?.config as any)?.locationId;
      
      // Return specific error codes for missing credentials
      if (!apiKey && !locationId) {
        return res.status(400).json({ 
          success: false,
          message: "GoHighLevel credentials not configured. Please add API key and Location ID.",
          errorCode: 'NOT_CONFIGURED',
        });
      }
      
      if (!apiKey) {
        return res.status(400).json({ 
          success: false,
          message: "API key is required. Please add your GoHighLevel API key.",
          errorCode: 'MISSING_API_KEY',
        });
      }
      
      if (!locationId) {
        return res.status(400).json({ 
          success: false,
          message: "Location ID is required. Please add your GoHighLevel Location ID.",
          errorCode: 'MISSING_LOCATION_ID',
        });
      }

      const client = new GoHighLevelClient(baseUrl, apiKey, locationId);
      const result = await client.testConnection();

      // Update integration config status
      if (config) {
        await storage.updateIntegrationConfig(config.id, {
          lastSyncAt: new Date(),
          lastSyncStatus: result.success ? 'SUCCESS' : 'FAILED',
          lastSyncMessage: result.message,
        });
      }

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ 
        success: false,
        message: error.message || "Failed to test GoHighLevel connection",
        errorCode: 'UNKNOWN',
      });
    }
  });

  // GoHighLevel - Validate Pipeline (check if pipeline and stages exist)
  app.post("/api/integrations/gohighlevel/validate-pipeline", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const { pipelineId, stageIds } = req.body;
      
      // Validate required input
      if (!pipelineId) {
        return res.status(400).json({ 
          success: false,
          message: "Pipeline ID is required.",
          errorCode: 'MISSING_PIPELINE_ID',
        });
      }
      
      // Get credentials from integration config
      const config = await storage.getIntegrationConfig(userId, 'GOHIGHLEVEL');
      const baseUrl = 'https://services.leadconnectorhq.com';
      const apiKey = process.env.GOHIGHLEVEL_API_KEY || config?.apiKey;
      const locationId = (config?.config as any)?.locationId;
      
      if (!apiKey || !locationId) {
        return res.status(400).json({ 
          success: false,
          message: "GoHighLevel credentials not configured. Configure API key and Location ID first.",
          errorCode: 'NOT_CONFIGURED',
        });
      }

      const client = new GoHighLevelClient(baseUrl, apiKey, locationId);
      
      // Validate pipeline exists
      const pipelineResult = await client.validatePipeline(pipelineId);
      if (!pipelineResult.success) {
        // Return appropriate HTTP status based on error type
        const statusCode = pipelineResult.errorCode === 'INVALID_PIPELINE' ? 404 
          : pipelineResult.errorCode === 'ACCESS_DENIED' ? 403 
          : 400;
        return res.status(statusCode).json({
          success: false,
          message: pipelineResult.error,
          errorCode: pipelineResult.errorCode,
        });
      }

      // Validate stage IDs if provided, otherwise return empty object
      const stageValidation: Record<string, { valid: boolean; name?: string; error?: string }> = {};
      if (stageIds && Array.isArray(stageIds)) {
        for (const stageId of stageIds) {
          const stage = pipelineResult.stages?.find(s => s.id === stageId);
          if (stage) {
            stageValidation[stageId] = { valid: true, name: stage.name };
          } else {
            stageValidation[stageId] = { 
              valid: false, 
              error: `Stage ID "${stageId}" not found in pipeline` 
            };
          }
        }
      }

      res.json({
        success: true,
        pipelineName: pipelineResult.pipelineName,
        stages: pipelineResult.stages,
        stageValidation, // Always included for predictable response shape
      });
    } catch (error: any) {
      res.status(500).json({ 
        success: false,
        message: error.message || "Failed to validate pipeline",
        errorCode: 'UNKNOWN',
      });
    }
  });

  // GoHighLevel - Comprehensive Sync (pushes all data to GHL)
  // Mode: "update" (push new/changed, skip orphan removal) or "align" (push + cleanup orphans)
  app.post("/api/integrations/gohighlevel/sync", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const syncMode = req.body.mode === "align" ? "align" : "update"; // Default to "update" (safer)
      console.log(`[GHL Sync] Starting sync in ${syncMode.toUpperCase()} mode`);
      
      // Get credentials from integration config
      const config = await storage.getIntegrationConfig(userId, 'GOHIGHLEVEL');
      // V2 API uses a different base URL
      const baseUrl = 'https://services.leadconnectorhq.com';
      // Check environment variable first, then fall back to stored config
      const apiKey = process.env.GOHIGHLEVEL_API_KEY || config?.apiKey;
      const locationId = (config?.config as any)?.locationId;
      
      if (!apiKey || !locationId) {
        const message = "GoHighLevel credentials not configured";
        if (config) {
          await storage.updateIntegrationConfig(config.id, {
            lastSyncAt: new Date(),
            lastSyncStatus: 'FAILED',
            lastSyncMessage: message,
          });
        }
        return res.status(400).json({ success: false, message });
      }

      const client = new GoHighLevelClient(baseUrl, apiKey, locationId);
      
      // Set status to PENDING
      if (config) {
        await storage.updateIntegrationConfig(config.id, {
          lastSyncStatus: 'PENDING',
          lastSyncMessage: 'Sync in progress...',
        });
      }

      // Import GHL config for pipeline stages
      const { GHL_CONFIG } = await import("./config/ghl-config");
      const pipelineId = (config?.config as any)?.purchasePipelineId || GHL_CONFIG.pipelineId;
      
      // Track sync results
      const syncResults = {
        salesOrders: { synced: 0, failed: 0, errors: [] as string[] },
        returns: { synced: 0, failed: 0, errors: [] as string[] },
        stockWarnings: { synced: 0, failed: 0, errors: [] as string[] },
        purchaseOrders: { synced: 0, failed: 0, errors: [] as string[] },
      };

      // ========== 0. CREATE SYSTEM CONTACT FOR NON-CUSTOMER ITEMS ==========
      // Stock warnings and other system items need a contact in V2 API
      // Use a valid email domain that GHL will accept
      console.log('[GHL Sync] Creating/finding system contact...');
      let systemContactId: string | undefined;
      try {
        // Use a real, valid email format for the system contact
        const systemContactResult = await client.createOrFindContact(
          'Inventory System',
          'inventory@stickerburrroller.com',
          undefined
        );
        if (systemContactResult.success && systemContactResult.contactId) {
          systemContactId = systemContactResult.contactId;
          console.log(`[GHL Sync] System contact ID: ${systemContactId}`);
        } else {
          console.error('[GHL Sync] Failed to create system contact:', systemContactResult.error);
        }
      } catch (e: any) {
        console.error('[GHL Sync] Exception creating system contact:', e.message);
      }

      // If we couldn't create a system contact, we can't sync stock warnings or POs
      if (!systemContactId) {
        console.warn('[GHL Sync] No system contact available - stock warnings and POs will fail');
        syncResults.stockWarnings.errors.push('No system contact available');
        syncResults.purchaseOrders.errors.push('No system contact available');
      }

      // ========== 1. SYNC SALES ORDERS ==========
      console.log('[GHL Sync] Starting sales orders sync...');
      const allSalesOrders = await storage.getAllSalesOrders();
      // In Align mode, only sync Live items (isHistorical = false)
      // In Update mode, sync all items
      const salesOrders = syncMode === "align" 
        ? allSalesOrders.filter(so => !so.isHistorical)
        : allSalesOrders;
      const historicalSalesOrderIds = new Set(
        allSalesOrders.filter(so => so.isHistorical).map(so => so.orderNumber || so.externalOrderId || so.id)
      );
      console.log(`[GHL Sync] Sales orders: ${salesOrders.length} to sync (${historicalSalesOrderIds.size} historical will be cleaned up in align mode)`);
      
      for (const order of salesOrders) {
        try {
          // Create or find contact for the customer (required for V2 API)
          let contactId: string | undefined;
          const customerName = order.customerName || 'Unknown Customer';
          
          const contactResult = await client.createOrFindContact(
            customerName,
            order.customerEmail || undefined,
            order.customerPhone || undefined
          );
          
          if (contactResult.success && contactResult.contactId) {
            contactId = contactResult.contactId;
            console.log(`[GHL Sync] Contact for ${customerName}: ${contactId}`);
          } else {
            // Use system contact as fallback
            contactId = systemContactId;
            console.log(`[GHL Sync] Using system contact for ${customerName}`);
          }

          if (!contactId) {
            syncResults.salesOrders.failed++;
            syncResults.salesOrders.errors.push(`Order ${order.orderNumber}: No contact available`);
            continue;
          }

          // Create opportunity for the sales order
          const orderTotal = order.totalAmount ? Number(order.totalAmount) : 0;
          const notes = `
Order: ${order.orderNumber || order.externalOrderId || order.id}
Channel: ${order.channel || 'Unknown'}
Status: ${order.status || 'Unknown'}
Customer: ${order.customerName || 'Unknown'}
${order.customerEmail ? `Email: ${order.customerEmail}` : ''}
${order.customerPhone ? `Phone: ${order.customerPhone}` : ''}
Order Date: ${order.orderDate ? new Date(order.orderDate).toLocaleDateString() : 'N/A'}
Total: $${orderTotal.toFixed(2)}
          `.trim();

          const orderName = `Order ${order.orderNumber || order.externalOrderId || order.id} - ${order.customerName || 'Customer'}`;
          const opportunityResult = await client.createOrUpdateOpportunity(
            pipelineId,
            GHL_CONFIG.stages.SALES_ORDERS,
            orderName,
            orderTotal,
            notes,
            {
              orderId: order.id,
              orderNumber: order.orderNumber || order.externalOrderId,
              channel: order.channel,
              status: order.status,
            },
            contactId, // Pass contactId (required for V2)
            order.orderNumber || order.externalOrderId || order.id // Unique identifier for search
          );

          if (opportunityResult.success) {
            syncResults.salesOrders.synced++;
            console.log(`[GHL Sync] Sales order ${order.orderNumber}: ${opportunityResult.action || 'synced'}`);
          } else {
            syncResults.salesOrders.failed++;
            syncResults.salesOrders.errors.push(`Order ${order.orderNumber}: ${opportunityResult.error}`);
            console.error(`[GHL Sync] Sales order ${order.orderNumber} failed: ${opportunityResult.error}`);
          }
        } catch (error: any) {
          syncResults.salesOrders.failed++;
          syncResults.salesOrders.errors.push(`Order ${order.orderNumber}: ${error.message}`);
        }
      }
      console.log(`[GHL Sync] Sales orders: ${syncResults.salesOrders.synced} synced, ${syncResults.salesOrders.failed} failed`);

      // ========== 2. SYNC RETURNS ==========
      console.log('[GHL Sync] Starting returns sync...');
      const allReturns = await storage.getAllReturnRequests();
      // In Align mode, only sync Live items (isHistorical = false)
      // In Update mode, sync all items
      const returns = syncMode === "align"
        ? allReturns.filter(r => !r.isHistorical)
        : allReturns;
      const historicalReturnIds = new Set(
        allReturns.filter(r => r.isHistorical).map(r => r.rmaNumber || r.id)
      );
      console.log(`[GHL Sync] Returns: ${returns.length} to sync (${historicalReturnIds.size} historical will be cleaned up in align mode)`);
      
      for (const returnRequest of returns) {
        try {
          // Get return items
          const returnItems = await storage.getReturnItemsByRequestId(returnRequest.id);
          const itemsList = returnItems.map(item => 
            `- ${item.sku}: ${item.qtyRequested} units (Reason: ${item.itemReason || 'Not specified'})`
          ).join('\n');

          // Use correct field names from schema: rmaNumber, customerName, etc.
          const rmaDisplay = returnRequest.rmaNumber || returnRequest.id;
          const customerName = returnRequest.customerName || 'Unknown';
          
          const description = `
Return Request: ${rmaDisplay}
Order: ${returnRequest.orderNumber || returnRequest.externalOrderId || 'N/A'}
Customer: ${customerName}
${returnRequest.customerEmail ? `Email: ${returnRequest.customerEmail}` : ''}
${returnRequest.customerPhone ? `Phone: ${returnRequest.customerPhone}` : ''}
Channel: ${returnRequest.salesChannel || 'Unknown'}
Status: ${returnRequest.status}
Resolution Requested: ${returnRequest.resolutionRequested || 'N/A'}
Reason: ${returnRequest.reason || 'Not specified'}

Items:
${itemsList || 'No items'}

Notes: ${returnRequest.resolutionNotes || 'None'}
          `.trim();

          const title = `Return ${rmaDisplay} - ${customerName}`;

          // Create or find contact for the return (required for V2 API)
          let contactId: string | undefined;
          console.log(`[GHL Sync] Processing return ${rmaDisplay} for ${customerName}`);
          
          if (customerName && customerName !== 'Unknown') {
            const contactResult = await client.createOrFindContact(
              customerName,
              returnRequest.customerEmail || undefined,
              returnRequest.customerPhone || undefined
            );
            if (contactResult.success && contactResult.contactId) {
              contactId = contactResult.contactId;
              console.log(`[GHL Sync] Return ${rmaDisplay}: contact ${contactId}`);
            } else {
              console.log(`[GHL Sync] Return ${rmaDisplay}: contact creation failed - ${contactResult.error}`);
            }
          }
          
          // Use system contact as fallback
          if (!contactId) {
            contactId = systemContactId;
            console.log(`[GHL Sync] Return ${rmaDisplay}: using system contact ${contactId}`);
          }

          if (!contactId) {
            syncResults.returns.failed++;
            syncResults.returns.errors.push(`Return ${rmaDisplay}: No contact available`);
            console.error(`[GHL Sync] Return ${rmaDisplay}: No contact available`);
            continue;
          }

          // Determine stage based on return status
          // OPEN, LABEL_ISSUED → REFUND_PROCESSING (still in progress)
          // RECEIVED, REFUNDED, CLOSED → REFUNDED (completed)
          let stageId = GHL_CONFIG.stages.REFUND_PROCESSING;
          if (returnRequest.status === 'RECEIVED' || returnRequest.status === 'REFUNDED' || returnRequest.status === 'CLOSED') {
            stageId = GHL_CONFIG.stages.REFUNDED;
          }

          // Create or update opportunity for return (idempotent)
          const opportunityResult = await client.createOrUpdateOpportunity(
            pipelineId,
            stageId,
            title,
            0, // Returns don't have monetary value
            description,
            {
              returnId: returnRequest.id,
              rmaNumber: returnRequest.rmaNumber,
              status: returnRequest.status,
            },
            contactId, // Pass contactId (required for V2)
            rmaDisplay // Unique identifier for search
          );

          if (opportunityResult.success) {
            syncResults.returns.synced++;
            console.log(`[GHL Sync] Return ${rmaDisplay}: ${opportunityResult.action || 'synced'}`);
          } else {
            syncResults.returns.failed++;
            syncResults.returns.errors.push(`Return ${rmaDisplay}: ${opportunityResult.error}`);
            console.error(`[GHL Sync] Return ${rmaDisplay} failed: ${opportunityResult.error}`);
          }
        } catch (error: any) {
          syncResults.returns.failed++;
          syncResults.returns.errors.push(`Return ${returnRequest.rmaNumber || returnRequest.id}: ${error.message}`);
        }
      }
      console.log(`[GHL Sync] Returns: ${syncResults.returns.synced} synced, ${syncResults.returns.failed} failed`);

      // ========== 3. SYNC STOCK WARNINGS ==========
      console.log('[GHL Sync] Starting stock warnings sync...');
      
      // Stock warnings require a contact - use system contact
      if (!systemContactId) {
        console.error('[GHL Sync] Cannot sync stock warnings: no system contact available');
        syncResults.stockWarnings.errors.push('No system contact available for stock warnings');
      } else {
        const items = await storage.getAllItems();
        const atRiskItems = items
          .map(item => {
            const stock = item.type === "finished_product" 
              ? (item.pivotQty ?? 0) + (item.hildaleQty ?? 0)
              : item.currentStock;
            const daysOfCover = item.dailyUsage > 0 ? stock / item.dailyUsage : Infinity;
            return { ...item, daysOfCover, currentStock: stock };
          })
          .filter(item => item.daysOfCover <= 30 && item.daysOfCover !== Infinity)
          .sort((a, b) => a.daysOfCover - b.daysOfCover);

        for (const item of atRiskItems) {
          try {
            // Determine stage based on days of cover
            let stageId: string;
            let priority: string;
            if (item.daysOfCover <= 7) {
              stageId = GHL_CONFIG.stages.STOCK_ORDER_NOW;
              priority = 'CRITICAL';
            } else if (item.daysOfCover <= 14) {
              stageId = GHL_CONFIG.stages.STOCK_14_21;
              priority = 'HIGH';
            } else {
              stageId = GHL_CONFIG.stages.STOCK_21_30;
              priority = 'MEDIUM';
            }

            const notes = `
Stock Warning: ${item.name}
SKU: ${item.sku}
Current Stock: ${item.currentStock}
Days of Cover: ${Math.round(item.daysOfCover)} days
Daily Usage: ${item.dailyUsage}
Priority: ${priority}
Reorder Point: ${item.reorderPoint || 'Not set'}
            `.trim();

            // Use item name for matching (both old format and new format contain this)
            // Format: "Stock Alert: Name (X days)" - consistent format for deduplication
            const stockAlertName = `Stock Alert: ${item.name} (${Math.round(item.daysOfCover)} days)`;
            const opportunityResult = await client.createOrUpdateOpportunity(
              pipelineId,
              stageId,
              stockAlertName,
              0,
              notes,
              {
                itemId: item.id,
                sku: item.sku,
                daysOfCover: item.daysOfCover,
                priority,
              },
              systemContactId!, // Use system contact for stock warnings (required for V2)
              item.name // Search by item name since that's what's in existing opportunity names
            );

            if (opportunityResult.success) {
              syncResults.stockWarnings.synced++;
              console.log(`[GHL Sync] Stock warning ${item.sku}: ${opportunityResult.action || 'synced'}`);
            } else {
              syncResults.stockWarnings.failed++;
              syncResults.stockWarnings.errors.push(`Item ${item.sku}: ${opportunityResult.error}`);
              console.error(`[GHL Sync] Stock warning ${item.sku} failed: ${opportunityResult.error}`);
            }
          } catch (error: any) {
            syncResults.stockWarnings.failed++;
            syncResults.stockWarnings.errors.push(`Item ${item.sku}: ${error.message}`);
          }
        }
      }
      console.log(`[GHL Sync] Stock warnings: ${syncResults.stockWarnings.synced} synced, ${syncResults.stockWarnings.failed} failed`);

      // ========== 4. SYNC PURCHASE ORDERS ==========
      console.log('[GHL Sync] Starting purchase orders sync...');
      
      // POs require a contact - use system contact or supplier contact
      if (!systemContactId) {
        console.error('[GHL Sync] Cannot sync purchase orders: no system contact available');
        syncResults.purchaseOrders.errors.push('No system contact available for purchase orders');
      } else {
        const allPurchaseOrders = await storage.getAllPurchaseOrders();
        // In Align mode, only sync Live items (isHistorical = false)
        // In Update mode, sync all items
        const purchaseOrders = syncMode === "align"
          ? allPurchaseOrders.filter(po => !po.isHistorical)
          : allPurchaseOrders;
        const historicalPONumbers = new Set(
          allPurchaseOrders.filter(po => po.isHistorical).map(po => po.poNumber)
        );
        console.log(`[GHL Sync] Purchase orders: ${purchaseOrders.length} to sync (${historicalPONumbers.size} historical will be cleaned up in align mode)`);
        
        for (const po of purchaseOrders) {
          try {
            // Get PO lines to calculate receipt quantities for derived display status
            const poLines = await storage.getPurchaseOrderLinesByPOId(po.id);
            const totalQtyOrdered = poLines.reduce((sum, l) => sum + (l.qtyOrdered || 0), 0);
            const totalQtyReceived = poLines.reduce((sum, l) => sum + (l.qtyReceived || 0), 0);
            
            // Use the same display status derivation as the frontend
            const displayStatus = derivePoDisplayStatus(
              {
                status: po.status,
                lastEmailStatus: po.lastEmailStatus,
                lastEmailSentAt: po.lastEmailSentAt,
                acknowledgementStatus: po.acknowledgementStatus,
              },
              totalQtyOrdered,
              totalQtyReceived
            );
            
            console.log(`[GHL Sync] Processing PO ${po.poNumber} - DB status: ${po.status}, Display status: ${displayStatus}`);
            
            // Determine stage based on derived displayStatus (matches what user sees in app)
            let stageId: string;
            if (displayStatus === 'RECEIVED' || displayStatus === 'CLOSED') {
              stageId = GHL_CONFIG.stages.PO_DELIVERED;
            } else if (displayStatus === 'PARTIAL' || displayStatus === 'PARTIAL_RECEIVED') {
              stageId = GHL_CONFIG.stages.PO_PAID; // Treat partial as in-transit/paid
            } else if (displayStatus === 'SENT' || displayStatus === 'ACCEPTED') {
              stageId = GHL_CONFIG.stages.PO_SENT;
            } else {
              // DRAFT, APPROVAL_PENDING, APPROVED - skip syncing these for now
              console.log(`[GHL Sync] Skipping PO ${po.poNumber} with displayStatus ${displayStatus}`);
              continue;
            }

            // Get supplier name for display
            let supplierName = 'Unknown Supplier';
            if (po.supplierId) {
              const supplier = await storage.getSupplier(po.supplierId);
              if (supplier) {
                supplierName = supplier.name;
              }
            }

            // Build items list for description
            const itemsList = poLines.map(line => 
              `- ${line.itemName || line.sku}: ${line.quantity} units @ $${Number(line.unitCost || 0).toFixed(2)}`
            ).join('\n');

            const poTotal = Number(po.totalAmount || 0);
            const description = `
Purchase Order: ${po.poNumber}
Supplier: ${supplierName}
Status: ${displayStatus}
Receipt Progress: ${totalQtyReceived}/${totalQtyOrdered} units
Total: $${poTotal.toFixed(2)}
Order Date: ${po.orderDate ? new Date(po.orderDate).toLocaleDateString() : 'N/A'}
Expected Delivery: ${po.expectedDeliveryDate ? new Date(po.expectedDeliveryDate).toLocaleDateString() : 'N/A'}

Items:
${itemsList || 'No items'}

Notes: ${po.notes || 'None'}
            `.trim();

            const title = `PO ${po.poNumber} - ${supplierName}`;

            // Create or update opportunity for PO (idempotent)
            const opportunityResult = await client.createOrUpdateOpportunity(
              pipelineId,
              stageId,
              title,
              poTotal,
              description,
              {
                poId: po.id,
                poNumber: po.poNumber,
                status: po.status,
                supplierId: po.supplierId,
              },
              systemContactId!, // Use system contact for POs (required for V2)
              po.poNumber // Unique identifier for search
            );

            if (opportunityResult.success) {
              syncResults.purchaseOrders.synced++;
              console.log(`[GHL Sync] PO ${po.poNumber}: ${opportunityResult.action || 'synced'}`);
            } else {
              syncResults.purchaseOrders.failed++;
              syncResults.purchaseOrders.errors.push(`PO ${po.poNumber}: ${opportunityResult.error}`);
              console.error(`[GHL Sync] PO ${po.poNumber} failed: ${opportunityResult.error}`);
            }
          } catch (error: any) {
            syncResults.purchaseOrders.failed++;
            const errorMsg = error.message || String(error);
            syncResults.purchaseOrders.errors.push(`PO ${po.poNumber}: ${errorMsg}`);
            console.error(`[GHL Sync] PO ${po.poNumber} exception:`, errorMsg, error.stack);
          }
        }
      }
      console.log(`[GHL Sync] Purchase orders: ${syncResults.purchaseOrders.synced} synced, ${syncResults.purchaseOrders.failed} failed`);
      if (syncResults.purchaseOrders.errors.length > 0) {
        console.log(`[GHL Sync] PO errors: ${syncResults.purchaseOrders.errors.join('; ')}`);
      }

      // ========== 5. CLEANUP: DEDUPLICATION + ORPHAN/HISTORICAL REMOVAL ==========
      // In "update" mode: only deduplication, no orphan removal
      // In "align" mode: deduplication + orphan removal + historical items removal
      console.log(`[GHL Sync] Starting cleanup (deduplication${syncMode === "align" ? " + orphan/historical removal" : " only"})...`);
      let cleanupCount = 0;
      let orphanCount = 0;
      let historicalCount = 0;
      const deletedItems: string[] = [];
      
      // Get user info for logging
      const syncUser = await storage.getUser(req.session.userId!);
      
      try {
        // Fetch data needed for cleanup (re-fetch since previous variables are scoped)
        const allItemsForCleanup = await storage.getAllItems();
        const allPOsForCleanup = await storage.getAllPurchaseOrders();
        
        // Get all opportunities in the pipeline
        const allOppsResult = await client.getAllOpportunitiesInPipeline(pipelineId);
        
        if (allOppsResult.success && allOppsResult.opportunities) {
          const allOpps = allOppsResult.opportunities;
          console.log(`[GHL Sync] Found ${allOpps.length} total opportunities in pipeline`);
          
          // Build sets of valid identifiers from LIVE app data only (non-historical)
          // These are items that SHOULD exist in GHL after align
          const validSalesOrderIds = new Set(salesOrders.map(so => so.orderNumber));
          const validReturnIds = new Set(returns.map(r => r.rmaNumber || r.id));
          const validStockAlertNames = new Set(
            allItemsForCleanup
              .filter(item => {
                const stock = item.type === "finished_product" 
                  ? (item.pivotQty ?? 0) + (item.hildaleQty ?? 0)
                  : item.currentStock;
                const daysOfCover = item.dailyUsage > 0 ? stock / item.dailyUsage : Infinity;
                return daysOfCover <= 30 && daysOfCover !== Infinity;
              })
              .map(item => item.name)
          );
          // Only include Live POs (not historical) - purchaseOrders is already filtered in align mode
          const validPONumbers = new Set(
            purchaseOrders
              .filter(po => !['DRAFT', 'APPROVAL_PENDING', 'APPROVED', 'CANCELLED'].includes(po.status))
              .map(po => po.poNumber)
          );
          
          console.log(`[GHL Cleanup] Valid counts - Sales: ${validSalesOrderIds.size}, Returns: ${validReturnIds.size}, Stock: ${validStockAlertNames.size}, POs: ${validPONumbers.size}`);
          
          // ===== STEP A: DEDUPLICATION =====
          // Group opportunities by their entity key to find duplicates
          const oppsByKey: Record<string, Array<{ id: string; name: string; createdAt?: string }>> = {};
          
          for (const opp of allOpps) {
            const name = opp.name || '';
            let key: string | null = null;
            
            // Extract unique key based on opportunity type
            if (name.startsWith('Stock Alert:')) {
              // Key by item name extracted from "Stock Alert: Name (X days)"
              const match = name.match(/Stock Alert:\s*(?:\[[^\]]+\]\s*)?(.+?)\s*\(\d+\s*days?\)/i);
              if (match) {
                key = `stock:${match[1].trim()}`;
              }
            } else if (name.startsWith('Return ') || name.includes('Return ')) {
              // Key by return ID - extract from name like "Return b007..." or "Return RMA-..."
              const returnMatch = name.match(/Return\s+([a-zA-Z0-9-]+)/);
              if (returnMatch) {
                key = `return:${returnMatch[1]}`;
              }
            } else if (name.startsWith('PO ') || name.startsWith('PO-')) {
              // Key by full PO number (e.g., "PO-2025-0003" from "PO PO-2025-0003 - Acme Corp")
              const poMatch = name.match(/PO[- ]?(PO-\d+-\d+|\d+-\d+)/i);
              if (poMatch) {
                key = `po:${poMatch[1]}`;
              }
            } else if (name.startsWith('Order ') || name.includes('Order ')) {
              // Key by order number
              const orderMatch = name.match(/Order\s+([A-Z]+-\d+-[A-Za-z0-9]+|\S+)/);
              if (orderMatch) {
                key = `order:${orderMatch[1]}`;
              }
            }
            
            if (key && opp.id) {
              if (!oppsByKey[key]) {
                oppsByKey[key] = [];
              }
              oppsByKey[key].push({ id: opp.id, name, createdAt: opp.createdAt || opp.dateAdded });
            }
          }
          
          // Delete duplicates, keeping only the first (or oldest) one
          for (const [key, opps] of Object.entries(oppsByKey)) {
            if (opps.length > 1) {
              console.log(`[GHL Cleanup] Found ${opps.length} duplicates for ${key}`);
              
              // Sort by createdAt (oldest first) or keep first in array
              const sorted = opps.sort((a, b) => {
                if (a.createdAt && b.createdAt) {
                  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
                }
                return 0;
              });
              
              // Keep the first one, delete the rest
              for (let i = 1; i < sorted.length; i++) {
                const dupe = sorted[i];
                const deleteResult = await client.deleteOpportunity(dupe.id);
                if (deleteResult.success) {
                  cleanupCount++;
                  deletedItems.push(`[DUPLICATE] ${dupe.name}`);
                  console.log(`[GHL Cleanup] Deleted duplicate: "${dupe.name}" (${dupe.id})`);
                } else {
                  console.error(`[GHL Cleanup] Failed to delete duplicate "${dupe.name}": ${deleteResult.error}`);
                }
              }
            }
          }
          
          // ===== STEP B: ORPHAN + HISTORICAL REMOVAL (only in "align" mode) =====
          if (syncMode === "align") {
            console.log('[GHL Cleanup] Align mode: proceeding with orphan + historical removal...');
            console.log(`[GHL Cleanup] Historical counts - Sales: ${historicalSalesOrderIds.size}, Returns: ${historicalReturnIds.size}, POs: ${historicalPONumbers.size}`);
            
            // Re-fetch opportunities after deduplication for orphan check
            const refreshedOppsResult = await client.getAllOpportunitiesInPipeline(pipelineId);
            const refreshedOpps = refreshedOppsResult.success && refreshedOppsResult.opportunities 
              ? refreshedOppsResult.opportunities 
              : [];
            
            for (const opp of refreshedOpps) {
              const name = opp.name || '';
              let shouldDelete = false;
              let isHistorical = false;
              let deleteReason = '';
              
              // Determine category by name prefix and check if orphaned or historical
              if (name.startsWith('Stock Alert:')) {
                // Extract item name from "Stock Alert: Name (X days)" format
                const match = name.match(/Stock Alert:\s*(?:\[[^\]]+\]\s*)?(.+?)\s*\(\d+\s*days?\)/i);
                const itemName = match ? match[1].trim() : null;
                if (!itemName || !validStockAlertNames.has(itemName)) {
                  shouldDelete = true;
                  deleteReason = 'item not in at-risk list';
                }
              } else if (name.startsWith('Return ') || name.includes('Return ')) {
                // Check if return RMA or ID is in the name
                const hasValidReturn = Array.from(validReturnIds).some(id => name.includes(String(id)));
                const hasHistoricalReturn = Array.from(historicalReturnIds).some(id => name.includes(String(id)));
                if (hasHistoricalReturn) {
                  shouldDelete = true;
                  isHistorical = true;
                  deleteReason = 'historical/archived return';
                } else if (!hasValidReturn) {
                  shouldDelete = true;
                  deleteReason = 'orphaned (no matching app record)';
                }
              } else if (name.startsWith('PO ') || name.startsWith('PO-')) {
                // Check if PO number is in the name
                const hasValidPO = Array.from(validPONumbers).some(poNum => name.includes(poNum));
                const hasHistoricalPO = Array.from(historicalPONumbers).some(poNum => name.includes(poNum));
                if (hasHistoricalPO) {
                  shouldDelete = true;
                  isHistorical = true;
                  deleteReason = 'historical/archived PO';
                } else if (!hasValidPO) {
                  shouldDelete = true;
                  deleteReason = 'orphaned (no matching app record)';
                }
              } else if (name.startsWith('Order ') || name.includes('Order ')) {
                // Check if order number is in the name
                const hasValidOrder = Array.from(validSalesOrderIds).some(orderId => orderId && name.includes(orderId));
                const hasHistoricalOrder = Array.from(historicalSalesOrderIds).some(orderId => orderId && name.includes(String(orderId)));
                if (hasHistoricalOrder) {
                  shouldDelete = true;
                  isHistorical = true;
                  deleteReason = 'historical/archived sales order';
                } else if (!hasValidOrder) {
                  shouldDelete = true;
                  deleteReason = 'orphaned (no matching app record)';
                }
              }
              
              // Delete opportunity if it should be removed
              if (shouldDelete && opp.id) {
                const deleteResult = await client.deleteOpportunity(opp.id);
                if (deleteResult.success) {
                  cleanupCount++;
                  if (isHistorical) {
                    historicalCount++;
                    deletedItems.push(`[HISTORICAL] ${name}`);
                    console.log(`[GHL Cleanup] Deleted historical: "${name}" - ${deleteReason}`);
                  } else {
                    orphanCount++;
                    deletedItems.push(`[ORPHAN] ${name}`);
                    console.log(`[GHL Cleanup] Deleted orphan: "${name}" - ${deleteReason}`);
                  }
                } else {
                  console.error(`[GHL Cleanup] Failed to delete "${name}": ${deleteResult.error}`);
                }
              }
            }
          } else {
            console.log('[GHL Cleanup] Update mode: skipping orphan/historical removal');
          }
        }
      } catch (cleanupError: any) {
        console.error('[GHL Sync] Cleanup error:', cleanupError.message);
        // Don't fail the sync if cleanup fails
      }
      
      console.log(`[GHL Sync] Cleanup complete: ${cleanupCount} opportunities deleted (${orphanCount} orphans, ${historicalCount} historical)`);
      
      // Log cleanup action if any items were deleted
      if (cleanupCount > 0) {
        await logService.logGhlCleanup({
          deletedCount: cleanupCount,
          deletedItems,
          triggeredBy: 'USER',
          userId: req.session.userId!,
          userName: syncUser?.email,
        });
      }
      
      // Log overall sync summary
      await logService.logGhlSync({
        action: 'SYNC',
        category: 'ALL',
        count: syncResults.salesOrders.synced + syncResults.returns.synced + syncResults.stockWarnings.synced + syncResults.purchaseOrders.synced,
        triggeredBy: 'USER',
        userId: req.session.userId!,
        userName: syncUser?.email,
        details: {
          mode: syncMode,
          salesOrders: syncResults.salesOrders.synced,
          returns: syncResults.returns.synced,
          stockWarnings: syncResults.stockWarnings.synced,
          purchaseOrders: syncResults.purchaseOrders.synced,
          duplicatesRemoved: cleanupCount - orphanCount - historicalCount,
          orphansArchived: orphanCount,
          historicalDeleted: historicalCount,
        },
      });

      // Build summary message
      const totalSynced = syncResults.salesOrders.synced + syncResults.returns.synced + syncResults.stockWarnings.synced + syncResults.purchaseOrders.synced;
      const totalFailed = syncResults.salesOrders.failed + syncResults.returns.failed + syncResults.stockWarnings.failed + syncResults.purchaseOrders.failed;
      
      // Build cleanup summary based on what was actually removed
      let cleanupSummary = '';
      if (cleanupCount > 0) {
        const parts = [];
        if (historicalCount > 0) parts.push(`${historicalCount} historical`);
        if (orphanCount > 0) parts.push(`${orphanCount} orphaned`);
        const dupCount = cleanupCount - orphanCount - historicalCount;
        if (dupCount > 0) parts.push(`${dupCount} duplicates`);
        cleanupSummary = `. Cleaned up ${cleanupCount} entries (${parts.join(', ')})`;
      }
      
      const summaryMessage = `Synced ${totalSynced} Live items to GoHighLevel: ` +
        `${syncResults.salesOrders.synced} sales orders, ` +
        `${syncResults.returns.synced} returns, ` +
        `${syncResults.stockWarnings.synced} stock warnings, ` +
        `${syncResults.purchaseOrders.synced} purchase orders` +
        cleanupSummary +
        (totalFailed > 0 ? ` (${totalFailed} failed)` : '');

      // Update integration config status
      if (config) {
        await storage.updateIntegrationConfig(config.id, {
          lastSyncAt: new Date(),
          lastSyncStatus: totalFailed === 0 ? 'SUCCESS' : 'PARTIAL',
          lastSyncMessage: summaryMessage,
        });
      }

      // Update integration health
      await storage.createOrUpdateIntegrationHealth({
        integrationName: "gohighlevel",
        lastSuccessAt: new Date(),
        lastStatus: totalFailed === 0 ? "connected" : "partial",
        lastAlertAt: null,
        errorMessage: totalFailed > 0 ? `${totalFailed} items failed to sync` : null,
      });

      res.json({
        success: true,
        message: summaryMessage,
        details: syncResults,
        mode: syncMode,
        opportunitiesCreated: syncResults.salesOrders.synced + syncResults.returns.synced + syncResults.stockWarnings.synced + syncResults.purchaseOrders.synced,
        opportunitiesUpdated: 0, // Currently not tracked separately
        opportunitiesArchived: orphanCount,
        historicalDeleted: historicalCount,
        statusesPulled: 0, // Future enhancement: track pulled status changes
        cleanedUp: cleanupCount,
      });
    } catch (error: any) {
      console.error('[GHL Sync] Error:', error);
      const userId = req.session.userId!;
      const config = await storage.getIntegrationConfig(userId, 'GOHIGHLEVEL');
      
      // Record failure in integration config
      if (config) {
        await storage.updateIntegrationConfig(config.id, {
          lastSyncAt: new Date(),
          lastSyncStatus: 'FAILED',
          lastSyncMessage: error.message || "Sync failed",
        });
      }
      
      res.status(500).json({ 
        success: false,
        message: error.message || "Integration sync failed" 
      });
    }
  });

  // ============================================================================
  // GHL RETURNS API - Public endpoints for GHL bot to create/query returns
  // ============================================================================

  // Helper middleware to validate GHL API key from stored config
  const validateGhlApiKey = async (req: Request, res: Response): Promise<{ valid: boolean; userId?: string }> => {
    const providedKey = req.headers['x-ghl-api-key'] as string;
    
    if (!providedKey) {
      res.status(401).json({ error: "Unauthorized: Missing X-GHL-API-Key header" });
      return { valid: false };
    }

    // Find user with matching GHL config
    const users = await storage.getAllUsers();
    for (const user of users) {
      const config = await storage.getIntegrationConfig(user.id, 'GOHIGHLEVEL');
      if (config?.apiKey) {
        // Timing-safe comparison
        const expectedBuffer = Buffer.from(config.apiKey, 'utf-8');
        const providedBuffer = Buffer.from(providedKey, 'utf-8');
        
        if (expectedBuffer.length === providedBuffer.length) {
          const isValid = crypto.timingSafeEqual(expectedBuffer, providedBuffer);
          if (isValid) {
            return { valid: true, userId: user.id };
          }
        }
      }
    }

    res.status(401).json({ error: "Unauthorized: Invalid API key" });
    return { valid: false };
  };

  // POST /api/integrations/ghl/returns/create
  // Create a return from GHL bot - Public endpoint authenticated via API key
  // Headers: X-GHL-API-Key: <stored GHL API key>
  // Body: { 
  //   channel: "SHOPIFY" | "AMAZON" | "DIRECT" | "OTHER",
  //   externalOrderId: string,
  //   customer: { name, email?, phone? },
  //   resolutionRequested: "REFUND" | "REPLACEMENT" | "STORE_CREDIT",
  //   returnReason?: string,
  //   shippingAddress?: object,
  //   items: [{ sku: string, quantityToReturn: number }]
  // }
  app.post("/api/integrations/ghl/returns/create", async (req: Request, res: Response) => {
    try {
      // Validate API key FIRST
      const authResult = await validateGhlApiKey(req, res);
      if (!authResult.valid) return; // Response already sent

      const userId = authResult.userId!;

      // Validate request body
      if (!req.body || typeof req.body !== 'object') {
        return res.status(400).json({ error: "Invalid request body" });
      }

      const { items: itemsData, customer, ...requestData } = req.body;
      
      // Validate required fields
      if (!requestData.channel) {
        return res.status(400).json({ error: "channel is required" });
      }
      if (!requestData.externalOrderId) {
        return res.status(400).json({ error: "externalOrderId is required" });
      }
      if (!customer?.name) {
        return res.status(400).json({ error: "customer.name is required" });
      }
      if (!requestData.resolutionRequested) {
        return res.status(400).json({ error: "resolutionRequested is required" });
      }
      if (!itemsData || !Array.isArray(itemsData) || itemsData.length === 0) {
        return res.status(400).json({ error: "At least one item is required" });
      }

      // Look up SalesOrder by channel + externalOrderId
      const salesOrders = await storage.getAllSalesOrders();
      const salesOrder = salesOrders.find(
        so => so.externalOrderId === requestData.externalOrderId && 
              so.channel === requestData.channel
      );

      if (!salesOrder) {
        return res.status(404).json({ 
          error: "Order not found",
          details: `No order found with ID ${requestData.externalOrderId} on ${requestData.channel} channel`
        });
      }

      // Get sales order lines to validate item quantities
      const orderLines = await storage.getSalesOrderLines(salesOrder.id);
      
      // Validate items and quantities
      const validationErrors: string[] = [];
      for (const item of itemsData) {
        if (!item.sku) {
          validationErrors.push("Each item must have a sku");
          continue;
        }
        if (!item.quantityToReturn || item.quantityToReturn <= 0) {
          validationErrors.push(`Invalid quantityToReturn for SKU ${item.sku}`);
          continue;
        }

        // Find matching order line
        const orderLine = orderLines.find(line => line.sku === item.sku);
        if (!orderLine) {
          validationErrors.push(`SKU ${item.sku} not found in order ${requestData.externalOrderId}`);
          continue;
        }

        // Check if quantity is eligible (must be fulfilled)
        if (item.quantityToReturn > orderLine.qtyFulfilled) {
          validationErrors.push(
            `Cannot return ${item.quantityToReturn} units of ${item.sku} - only ${orderLine.qtyFulfilled} units were fulfilled`
          );
        }
      }

      if (validationErrors.length > 0) {
        return res.status(400).json({ 
          error: "Validation failed", 
          details: validationErrors 
        });
      }

      // Create return request
      const validatedRequest = insertReturnRequestSchema.parse({
        salesOrderId: salesOrder.id,
        orderNumber: salesOrder.orderNumber,
        externalOrderId: requestData.externalOrderId,
        salesChannel: requestData.channel,
        source: 'GHL',
        customerName: customer.name,
        customerEmail: customer.email || null,
        customerPhone: customer.phone || null,
        shippingAddress: requestData.shippingAddress || null,
        ghlContactId: requestData.ghlContactId || null,
        resolutionRequested: requestData.resolutionRequested,
        reason: requestData.returnReason || 'GHL bot return',
        initiatedVia: 'GHL_BOT',
        labelProvider: 'SHIPPO',
        status: 'OPEN',
      });

      const returnRequest = await storage.createReturnRequest(validatedRequest);
      const returnItems: ReturnItem[] = [];

      // Create return items
      for (const itemData of itemsData) {
        const inventoryItem = await storage.getItemBySku(itemData.sku);
        if (!inventoryItem) {
          throw new Error(`Item not found: ${itemData.sku}`);
        }

        // Find matching sales order line
        const orderLine = orderLines.find(line => line.sku === itemData.sku);

        const returnItem = await storage.createReturnItem({
          returnRequestId: returnRequest.id,
          salesOrderLineId: orderLine?.id || null,
          inventoryItemId: inventoryItem.id,
          sku: inventoryItem.sku,
          qtyOrdered: orderLine?.qtyOrdered || itemData.quantityToReturn,
          qtyRequested: itemData.quantityToReturn,
          qtyApproved: itemData.quantityToReturn,
          itemReason: itemData.reason || null,
          disposition: itemData.disposition || null,
        });

        returnItems.push(returnItem);
      }

      // Automatically generate shipping label if address is provided
      let labelUrl = null;
      let trackingNumber = null;
      let carrier = null;
      let labelStatus = 'PENDING';

      if (requestData.shippingAddress) {
        try {
          const itemsForLabel = returnItems.map(ri => ({
            sku: ri.sku,
            name: ri.sku,
            quantity: ri.qtyApproved,
          }));

          const labelResponse = await labelService.generateLabel({
            customerName: returnRequest.customerName,
            customerAddress: requestData.shippingAddress,
            items: itemsForLabel,
          });

          // Create shipment record
          await storage.createReturnShipment({
            returnRequestId: returnRequest.id,
            carrier: labelResponse.carrier,
            trackingNumber: labelResponse.trackingNumber,
            labelUrl: labelResponse.labelUrl,
          });

          // Update return request status
          await storage.updateReturnRequest(returnRequest.id, {
            status: 'LABEL_CREATED',
            labelProvider: 'SHIPPO',
          });

          labelUrl = labelResponse.labelUrl;
          trackingNumber = labelResponse.trackingNumber;
          carrier = labelResponse.carrier;
          labelStatus = 'CREATED';

          console.log(`[GHL Returns] Label generated for return ${returnRequest.id}:`, {
            trackingNumber,
            carrier,
          });
        } catch (labelError: any) {
          console.error("[GHL Returns] Failed to generate label:", labelError);
          labelStatus = 'FAILED';
          // Continue without label - return is still created
        }
      }

      console.log(`[GHL Returns] Return created: ${returnRequest.id} for order ${salesOrder.orderNumber}`);

      res.status(201).json({ 
        success: true,
        returnId: returnRequest.id,
        returnNumber: returnRequest.id,
        orderId: salesOrder.id,
        orderNumber: salesOrder.orderNumber,
        status: returnRequest.status,
        resolution: returnRequest.resolutionRequested,
        trackingNumber,
        carrier,
        labelUrl,
        labelStatus,
        items: returnItems.map(ri => ({
          sku: ri.sku,
          quantityApproved: ri.qtyApproved,
        })),
        createdAt: returnRequest.createdAt,
      });
    } catch (error: any) {
      console.error("[GHL Returns] Error creating return:", error);
      
      // Return appropriate error code
      if (error.name === 'ZodError') {
        return res.status(400).json({ 
          error: "Validation failed", 
          details: error.errors 
        });
      }
      
      res.status(500).json({ 
        error: error.message || "Failed to create return" 
      });
    }
  });

  // GET /api/integrations/ghl/returns/status
  // Get return status - Public endpoint authenticated via API key
  // Headers: X-GHL-API-Key: <stored GHL API key>
  // Query: returnId=... OR orderId=...
  app.get("/api/integrations/ghl/returns/status", async (req: Request, res: Response) => {
    try {
      // Validate API key FIRST
      const authResult = await validateGhlApiKey(req, res);
      if (!authResult.valid) return; // Response already sent

      const { returnId, orderId } = req.query;

      if (!returnId && !orderId) {
        return res.status(400).json({ 
          error: "Either returnId or orderId query parameter is required" 
        });
      }

      let returnRequests: ReturnRequest[] = [];

      if (returnId) {
        const returnRequest = await storage.getReturnRequest(returnId as string);
        if (returnRequest) {
          returnRequests = [returnRequest];
        }
      } else if (orderId) {
        const allReturns = await storage.getAllReturnRequests();
        returnRequests = allReturns.filter(r => 
          r.salesOrderId === orderId || 
          r.externalOrderId === orderId
        );
      }

      if (returnRequests.length === 0) {
        return res.status(404).json({ 
          error: "No returns found",
          query: { returnId, orderId }
        });
      }

      // Get shipment info for each return
      const returnsWithDetails = await Promise.all(
        returnRequests.map(async (returnRequest) => {
          const shipments = await storage.getReturnShipmentsByRequestId(returnRequest.id);
          const items = await storage.getReturnItemsByRequestId(returnRequest.id);
          
          const shipment = shipments[0]; // Most recent shipment

          return {
            returnId: returnRequest.id,
            orderId: returnRequest.salesOrderId,
            orderNumber: returnRequest.orderNumber,
            externalOrderId: returnRequest.externalOrderId,
            status: returnRequest.status,
            resolution: returnRequest.resolutionRequested,
            resolutionFinal: returnRequest.resolutionFinal,
            createdAt: returnRequest.createdAt,
            updatedAt: returnRequest.updatedAt,
            trackingNumber: shipment?.trackingNumber || null,
            carrier: shipment?.carrier || null,
            labelUrl: shipment?.labelUrl || null,
            labelStatus: shipment ? 'CREATED' : 'NONE',
            deliveryState: shipment?.trackingStatus || 'UNKNOWN',
            customerName: returnRequest.customerName,
            customerEmail: returnRequest.customerEmail,
            customerPhone: returnRequest.customerPhone,
            items: items.map(item => ({
              sku: item.sku,
              qtyRequested: item.qtyRequested,
              qtyApproved: item.qtyApproved,
              qtyReceived: item.qtyReceived,
              reason: item.itemReason,
              disposition: item.disposition,
            })),
            restocked: returnRequest.status === 'COMPLETED',
          };
        })
      );

      // Return single object if querying by returnId, array if by orderId
      const response = returnId 
        ? returnsWithDetails[0] 
        : { returns: returnsWithDetails, count: returnsWithDetails.length };

      res.json(response);
    } catch (error: any) {
      console.error("[GHL Returns] Error fetching return status:", error);
      res.status(500).json({ 
        error: error.message || "Failed to fetch return status" 
      });
    }
  });

  // PhantomBuster - Test Connection (V2 placeholder - disabled in V1)
  app.post("/api/integrations/phantombuster/test", requireAuth, async (_req: Request, res: Response) => {
    // PhantomBuster integration is planned for V2 - return informational message
    res.json({ 
      success: false,
      message: "PhantomBuster integration is planned for V2. Not available in this version." 
    });
  });

  // PhantomBuster - Sync (V2 placeholder - disabled in V1)
  app.post("/api/integrations/phantombuster/sync", requireAuth, async (_req: Request, res: Response) => {
    // PhantomBuster integration is planned for V2 - return informational message
    res.json({ 
      success: false,
      message: "PhantomBuster integration is planned for V2. Not available in this version." 
    });
  });

  // ============================================================================
  // SHIPPO INTEGRATION
  // ============================================================================

  // Shippo - Test Connection
  app.post("/api/integrations/shippo/test", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.json({
          success: false,
          message: "Not authenticated"
        });
      }

      const config = await storage.getIntegrationConfig(userId, "SHIPPO");
      
      if (!config || !config.apiKey) {
        return res.json({
          success: false,
          message: "Shippo not configured. Please add your API key first."
        });
      }

      // Test the API key by making a simple request to Shippo
      const response = await fetch("https://api.goshippo.com/addresses/", {
        method: "GET",
        headers: {
          "Authorization": `ShippoToken ${config.apiKey}`,
          "Content-Type": "application/json",
        },
      });

      if (response.ok) {
        return res.json({
          success: true,
          message: "Successfully connected to Shippo API"
        });
      } else {
        const errorData = await response.json().catch(() => ({}));
        return res.json({
          success: false,
          message: `Shippo API error: ${errorData.detail || response.statusText}`
        });
      }
    } catch (error: any) {
      console.error("[Shippo Test] Error:", error);
      return res.json({
        success: false,
        message: error.message || "Failed to test Shippo connection"
      });
    }
  });

  // Shippo - Sync (placeholder - Shippo is event-driven via return labels)
  app.post("/api/integrations/shippo/sync", requireAuth, async (_req: Request, res: Response) => {
    res.json({ 
      success: true,
      message: "Shippo integration is event-driven. Labels are created on-demand when processing returns." 
    });
  });

  // ============================================================================
  // AD PLATFORMS (Meta Ads, Google Ads)
  // ============================================================================
  
  // Import ad platform services
  const { metaAdsClient } = await import("./services/meta-ads-client");
  const { googleAdsClient } = await import("./services/google-ads-client");
  const { adMetricsSyncService } = await import("./services/ad-metrics-sync");

  // Meta Ads - Get Auth URL
  app.get("/api/ads/meta/auth-url", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!metaAdsClient.isConfigured()) {
        return res.status(400).json({ 
          error: "Meta Ads not configured. Set META_APP_ID and META_APP_SECRET environment variables." 
        });
      }

      const state = crypto.randomBytes(16).toString('hex');
      req.session.oauthState = state;
      
      const authUrl = metaAdsClient.getAuthUrl(state);
      res.json({ authUrl });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to generate auth URL" });
    }
  });

  // Meta Ads - OAuth Callback
  app.get("/api/ads/meta/callback", async (req: Request, res: Response) => {
    try {
      const { code, state } = req.query;
      const userId = req.session.userId;
      
      if (!userId) {
        return res.redirect("/settings?error=not_authenticated");
      }
      
      if (!code || typeof code !== 'string') {
        return res.redirect("/settings?error=no_auth_code");
      }
      
      // Verify state if stored
      if (req.session.oauthState && state !== req.session.oauthState) {
        return res.redirect("/settings?error=invalid_state");
      }
      
      // Exchange code for token
      const tokenResponse = await metaAdsClient.exchangeCodeForToken(code);
      
      // Get long-lived token
      const longLivedToken = await metaAdsClient.getLongLivedToken(tokenResponse.access_token);
      
      // Set token and get accounts
      metaAdsClient.setAccessToken(longLivedToken.access_token);
      const accounts = await metaAdsClient.listAdAccounts();
      
      if (accounts.length === 0) {
        return res.redirect("/settings?error=no_ad_accounts");
      }
      
      // Use first account (or could show selection UI)
      const account = accounts[0];
      
      // Store in database
      let config = await storage.getAdPlatformConfig(userId, 'META');
      
      if (config) {
        await storage.updateAdPlatformConfig(config.id, {
          accountId: account.id,
          accountName: account.name,
          accessToken: longLivedToken.access_token,
          accessTokenExpiresAt: longLivedToken.expires_in 
            ? new Date(Date.now() + longLivedToken.expires_in * 1000) 
            : null,
          isConnected: true,
        });
      } else {
        await storage.createAdPlatformConfig({
          userId,
          platform: 'META',
          accountId: account.id,
          accountName: account.name,
          accessToken: longLivedToken.access_token,
          accessTokenExpiresAt: longLivedToken.expires_in 
            ? new Date(Date.now() + longLivedToken.expires_in * 1000) 
            : null,
          isConnected: true,
        });
      }

      // Log connection
      await AuditLogger.logAdPlatformConnected({
        platform: 'META',
        accountId: account.id,
        accountName: account.name,
        userId,
      });

      res.redirect("/settings?meta_connected=true");
    } catch (error: any) {
      console.error("[Meta Ads] OAuth callback error:", error);
      res.redirect(`/settings?error=${encodeURIComponent(error.message || 'oauth_failed')}`);
    }
  });

  // Meta Ads - Disconnect
  app.post("/api/ads/meta/disconnect", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const config = await storage.getAdPlatformConfig(userId, 'META');
      
      if (config) {
        await storage.updateAdPlatformConfig(config.id, {
          isConnected: false,
          accessToken: null,
          refreshToken: null,
        });

        await AuditLogger.logAdPlatformDisconnected({
          platform: 'META',
          accountId: config.accountId || 'unknown',
          accountName: config.accountName || undefined,
          userId,
        });
      }

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to disconnect" });
    }
  });

  // Meta Ads - Test Connection
  app.post("/api/ads/meta/test", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const config = await storage.getAdPlatformConfig(userId, 'META');
      
      if (!config?.accessToken) {
        return res.status(400).json({ success: false, message: "Meta Ads not connected" });
      }

      metaAdsClient.setAccessToken(config.accessToken);
      const result = await metaAdsClient.testConnection();

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Meta Ads - Get Config (for status display with rotation tracking)
  app.get("/api/ads/meta/config", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const config = await storage.getAdPlatformConfig(userId, 'META');
      
      if (!config) {
        return res.json({ isConnected: false });
      }

      res.json({
        isConnected: config.isConnected,
        accountId: config.accountId,
        accountName: config.accountName,
        lastSyncAt: config.lastSyncAt,
        tokenLastRotatedAt: config.tokenLastRotatedAt,
        tokenNextRotationAt: config.tokenNextRotationAt,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to get Meta Ads config" });
    }
  });

  // Google Ads - Get Auth URL
  app.get("/api/ads/google/auth-url", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!googleAdsClient.isConfigured()) {
        return res.status(400).json({ 
          error: "Google Ads not configured. Set GOOGLE_ADS_CLIENT_ID and GOOGLE_ADS_CLIENT_SECRET environment variables." 
        });
      }

      const state = crypto.randomBytes(16).toString('hex');
      req.session.oauthState = state;
      
      const authUrl = googleAdsClient.getAuthUrl(state);
      res.json({ authUrl });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to generate auth URL" });
    }
  });

  // Google Ads - OAuth Callback
  app.get("/api/ads/google/callback", async (req: Request, res: Response) => {
    try {
      const { code, state } = req.query;
      const userId = req.session.userId;
      
      if (!userId) {
        return res.redirect("/settings?error=not_authenticated");
      }
      
      if (!code || typeof code !== 'string') {
        return res.redirect("/settings?error=no_auth_code");
      }
      
      // Verify state if stored
      if (req.session.oauthState && state !== req.session.oauthState) {
        return res.redirect("/settings?error=invalid_state");
      }
      
      // Exchange code for token
      const tokenResponse = await googleAdsClient.exchangeCodeForToken(code);
      
      // Set tokens and get customers
      googleAdsClient.setAccessToken(tokenResponse.access_token);
      if (tokenResponse.refresh_token) {
        googleAdsClient.setRefreshToken(tokenResponse.refresh_token);
      }
      
      const customers = await googleAdsClient.listAccessibleCustomers();
      
      if (customers.length === 0) {
        return res.redirect("/settings?error=no_ad_accounts");
      }
      
      // Use first customer (or could show selection UI)
      const customer = customers[0];
      
      // Store in database
      let config = await storage.getAdPlatformConfig(userId, 'GOOGLE');
      
      if (config) {
        await storage.updateAdPlatformConfig(config.id, {
          accountId: customer.customerId,
          accountName: customer.descriptiveName,
          accessToken: tokenResponse.access_token,
          refreshToken: tokenResponse.refresh_token,
          accessTokenExpiresAt: new Date(Date.now() + tokenResponse.expires_in * 1000),
          isConnected: true,
        });
      } else {
        await storage.createAdPlatformConfig({
          userId,
          platform: 'GOOGLE',
          accountId: customer.customerId,
          accountName: customer.descriptiveName,
          accessToken: tokenResponse.access_token,
          refreshToken: tokenResponse.refresh_token,
          accessTokenExpiresAt: new Date(Date.now() + tokenResponse.expires_in * 1000),
          isConnected: true,
        });
      }

      // Log connection
      await AuditLogger.logAdPlatformConnected({
        platform: 'GOOGLE',
        accountId: customer.customerId,
        accountName: customer.descriptiveName,
        userId,
      });

      res.redirect("/settings?google_connected=true");
    } catch (error: any) {
      console.error("[Google Ads] OAuth callback error:", error);
      res.redirect(`/settings?error=${encodeURIComponent(error.message || 'oauth_failed')}`);
    }
  });

  // Google Ads - Disconnect
  app.post("/api/ads/google/disconnect", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const config = await storage.getAdPlatformConfig(userId, 'GOOGLE');
      
      if (config) {
        await storage.updateAdPlatformConfig(config.id, {
          isConnected: false,
          accessToken: null,
          refreshToken: null,
        });

        await AuditLogger.logAdPlatformDisconnected({
          platform: 'GOOGLE',
          accountId: config.accountId || 'unknown',
          accountName: config.accountName || undefined,
          userId,
        });
      }

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to disconnect" });
    }
  });

  // Google Ads - Test Connection
  app.post("/api/ads/google/test", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const config = await storage.getAdPlatformConfig(userId, 'GOOGLE');
      
      if (!config?.accessToken) {
        return res.status(400).json({ success: false, message: "Google Ads not connected" });
      }

      googleAdsClient.setAccessToken(config.accessToken);
      if (config.refreshToken) {
        googleAdsClient.setRefreshToken(config.refreshToken);
      }
      
      const result = await googleAdsClient.testConnection();

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Google Ads - Get Config (for status display with rotation tracking)
  app.get("/api/ads/google/config", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const config = await storage.getAdPlatformConfig(userId, 'GOOGLE');
      
      if (!config) {
        return res.json({ isConnected: false });
      }

      res.json({
        isConnected: config.isConnected,
        accountId: config.accountId,
        accountName: config.accountName,
        lastSyncAt: config.lastSyncAt,
        tokenLastRotatedAt: config.tokenLastRotatedAt,
        tokenNextRotationAt: config.tokenNextRotationAt,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to get Google Ads config" });
    }
  });

  // Google Ads - Sync Demand Signals for AI Recommendations
  app.post("/api/ads/google/sync-demand", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      
      const { googleAdsDemandService } = await import('./services/google-ads-demand-service');
      
      const initialized = await googleAdsDemandService.initialize(userId);
      if (!initialized) {
        return res.status(400).json({
          success: false,
          message: 'Google Ads not configured or not enabled',
        });
      }
      
      const result = await googleAdsDemandService.syncDemandSignals();
      
      res.json({
        success: result.success,
        itemsProcessed: result.itemsProcessed,
        itemsWithData: result.itemsWithData,
        errors: result.errors,
        message: result.success 
          ? `Updated demand signals for ${result.itemsProcessed} recommendations (${result.itemsWithData} with Google Ads data)`
          : 'Failed to sync demand signals',
      });
    } catch (error: any) {
      console.error('[Google Ads] Demand sync error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to sync Google Ads demand signals',
      });
    }
  });

  // Meta Ads - Sync Demand Signals for AI Recommendations
  app.post("/api/ads/meta/sync-demand", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      
      const { metaAdsDemandService } = await import('./services/meta-ads-demand-service');
      
      const initialized = await metaAdsDemandService.initialize(userId);
      if (!initialized) {
        return res.status(400).json({
          success: false,
          message: 'Meta Ads not configured or not connected',
        });
      }
      
      const result = await metaAdsDemandService.syncDemandSignals();
      
      res.json({
        success: result.success,
        itemsProcessed: result.itemsProcessed,
        itemsWithData: result.itemsWithData,
        rowsStored: result.rowsStored,
        errors: result.errors,
        message: result.success 
          ? `Updated demand signals for ${result.itemsProcessed} recommendations (${result.itemsWithData} with Meta Ads data, ${result.rowsStored} rows stored)`
          : 'Failed to sync Meta Ads demand signals',
      });
    } catch (error: any) {
      console.error('[Meta Ads] Demand sync error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to sync Meta Ads demand signals',
      });
    }
  });

  // Meta Ads - Sync Performance Data only (without updating AI recommendations)
  app.post("/api/ads/meta/sync-performance", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      
      const { metaAdsDemandService } = await import('./services/meta-ads-demand-service');
      
      const initialized = await metaAdsDemandService.initialize(userId);
      if (!initialized) {
        return res.status(400).json({
          success: false,
          message: 'Meta Ads not configured or not connected',
        });
      }
      
      const result = await metaAdsDemandService.syncPerformanceData();
      
      res.json({
        success: result.success,
        rowsStored: result.rowsStored,
        rowsMapped: result.rowsMapped,
        rowsUnmapped: result.rowsUnmapped,
        errors: result.errors,
        message: result.success 
          ? `Synced ${result.rowsStored} rows (${result.rowsMapped} mapped, ${result.rowsUnmapped} unmapped)`
          : 'Failed to sync Meta Ads performance data',
      });
    } catch (error: any) {
      console.error('[Meta Ads] Performance sync error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to sync Meta Ads performance data',
      });
    }
  });

  // Ad Metrics - Sync All
  app.post("/api/ads/sync", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const { daysToSync = 7 } = req.body;
      
      const results = await adMetricsSyncService.syncAllForUser(userId, daysToSync);
      
      res.json({
        success: results.every(r => r.success),
        results,
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Ad Metrics - Get Sync Status
  app.get("/api/ads/status", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const status = await adMetricsSyncService.getSyncStatus(userId);
      res.json(status);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Ad SKU Mappings - List
  app.get("/api/ads/sku-mappings", requireAuth, async (req: Request, res: Response) => {
    try {
      const { platform } = req.query;
      const mappings = platform 
        ? await storage.getAdSkuMappingsByPlatform(platform as string)
        : await storage.getAdSkuMappingsByPlatform('META').then(async m => 
            [...m, ...await storage.getAdSkuMappingsByPlatform('GOOGLE')]
          );
      res.json(mappings);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Ad SKU Mappings - Create
  app.post("/api/ads/sku-mappings", requireAuth, async (req: Request, res: Response) => {
    try {
      const mapping = await storage.createAdSkuMapping(req.body);
      res.status(201).json(mapping);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Ad SKU Mappings - Delete
  app.delete("/api/ads/sku-mappings/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const success = await storage.deleteAdSkuMapping(req.params.id);
      if (success) {
        res.json({ success: true });
      } else {
        res.status(404).json({ error: "Mapping not found" });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Ad Metrics - Get Recent Metrics for SKU
  app.get("/api/ads/metrics/:sku", requireAuth, async (req: Request, res: Response) => {
    try {
      const { sku } = req.params;
      const { days = 30 } = req.query;
      
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - Number(days));
      
      const metrics = await storage.getAdMetricsBySkuAndDateRange(
        sku, 
        startDate.toISOString().split('T')[0], 
        endDate.toISOString().split('T')[0]
      );
      
      res.json(metrics);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================================================
  // LLM
  // ============================================================================
  
  app.post("/api/llm/health-check", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const settings = await storage.getSettings(userId);
      
      if (!settings?.llmProvider) {
        return res.status(400).json({ 
          success: false, 
          error: "No LLM provider configured" 
        });
      }
      
      const hasApiKey = settings.llmApiKey && settings.llmApiKey.trim();
      const hasCustomEndpoint = settings.llmProvider === "custom" && settings.llmCustomEndpoint;
      
      if (!hasApiKey && !hasCustomEndpoint) {
        return res.status(400).json({ 
          success: false, 
          error: "No API key or custom endpoint configured" 
        });
      }
      
      const normalizedProvider = settings.llmProvider?.toLowerCase().replace(/\s+/g, "_") === "custom_endpoint" 
        ? "custom" 
        : settings.llmProvider!;
      
      const testResult = await LLMService.askLLM({
        provider: normalizedProvider as LLMProvider,
        apiKey: settings.llmApiKey || undefined,
        customEndpoint: settings.llmCustomEndpoint || undefined,
        taskType: 'HEALTH_CHECK',
        payload: { test: true },
      });
      
      await storage.logSystemEvent({
        eventType: 'LLM_HEALTH_CHECK',
        status: 'success',
        details: {
          provider: normalizedProvider,
          model: settings.llmModel,
          responseLength: testResult?.text?.length || 0,
        },
      });
      
      res.json({ 
        success: true, 
        provider: normalizedProvider,
        model: settings.llmModel,
        message: "LLM connection verified successfully"
      });
    } catch (error: any) {
      const userId = req.session.userId;
      const settings = userId ? await storage.getSettings(userId) : null;
      
      await storage.logSystemEvent({
        eventType: 'LLM_HEALTH_CHECK',
        status: 'error',
        details: {
          provider: settings?.llmProvider,
          error: error.message,
        },
      });
      
      res.status(500).json({ 
        success: false, 
        error: error.message || "LLM health check failed" 
      });
    }
  });

  app.post("/api/llm/ask", requireAuth, async (req: Request, res: Response) => {
    try {
      const { provider, apiKey, customEndpoint, taskType, payload } = req.body;
      
      const result = await LLMService.askLLM({
        provider,
        apiKey,
        customEndpoint,
        taskType,
        payload,
      });
      
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "LLM request failed" });
    }
  });

  // Smart Reorder Recommendations
  app.get("/api/llm/reorder-recommendations", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const settings = await storage.getSettings(userId);
      
      const canUseLLM = settings?.llmProvider && (
        settings.llmApiKey || 
        (settings.llmProvider === "custom" && settings.llmCustomEndpoint)
      );
      
      if (canUseLLM) {
        // Normalize provider name (handle "Custom Endpoint" → "custom")
        const normalizedProvider = settings.llmProvider?.toLowerCase().replace(/\s+/g, "_") === "custom_endpoint" 
          ? "custom" 
          : settings.llmProvider!;
        
        const recommendations = await LLMService.generateLLMReorderRecommendations(
          normalizedProvider as any,
          settings.llmApiKey || undefined,
          settings.llmCustomEndpoint || undefined
        );
        res.json(recommendations);
      } else {
        const recommendations = await LLMService.generateReorderRecommendations();
        res.json(recommendations);
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to generate reorder recommendations" });
    }
  });

  // Supplier Ranking for specific item
  app.get("/api/llm/supplier-ranking/:itemId", requireAuth, async (req: Request, res: Response) => {
    try {
      const { itemId } = req.params;
      const rankings = await LLMService.rankSuppliers(itemId);
      res.json(rankings);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to rank suppliers" });
    }
  });

  // Demand Forecasting with confidence intervals
  app.get("/api/llm/demand-forecast", requireAuth, async (req: Request, res: Response) => {
    try {
      const forecasts = await LLMService.generateDemandForecast();
      res.json(forecasts);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to generate demand forecast" });
    }
  });

  // Batch forecast job: Process all dirty items
  app.post("/api/llm/batch-forecast", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const settings = await storage.getSettings(userId);
      
      // Check if LLM is configured
      const canUseLLM = settings?.llmProvider && (
        settings.llmProvider === "custom" && settings.llmCustomEndpoint ||
        settings.llmApiKey
      );
      
      if (!canUseLLM) {
        return res.status(400).json({ 
          error: "LLM provider not configured. Please configure API key or custom endpoint in Settings." 
        });
      }
      
      // Get all items marked as forecastDirty
      const allItems = await storage.getAllItems();
      const dirtyItems = allItems.filter(item => item.forecastDirty === true);
      
      if (dirtyItems.length === 0) {
        return res.json({
          success: true,
          processedCount: 0,
          totalDirty: 0,
          message: "No dirty items to process",
        });
      }
      
      // Normalize provider name (handle "Custom Endpoint" → "custom")
      const normalizedProvider = settings.llmProvider?.toLowerCase().replace(/\s+/g, "_") === "custom_endpoint" 
        ? "custom" 
        : settings.llmProvider!;
      
      // Generate forecasts for dirty items only (efficient batch processing)
      let allRecommendations: any[] = [];
      try {
        allRecommendations = await LLMService.generateLLMReorderRecommendations(
          normalizedProvider as any,
          settings.llmApiKey || undefined,
          settings.llmCustomEndpoint || undefined,
          dirtyItems // Pass only dirty items to LLM service
        );
      } catch (error: any) {
        return res.status(500).json({ 
          error: `Failed to generate forecasts: ${error.message}` 
        });
      }
      
      // Create a map of recommendations by itemId for fast lookup
      const recommendationMap = new Map(
        allRecommendations.map(rec => [rec.itemId, rec])
      );
      
      let successCount = 0;
      let noDataCount = 0;
      const failures: Array<{ itemId: string; itemName: string; error: string }> = [];
      
      // Process each dirty item and store its forecast
      for (const item of dirtyItems) {
        try {
          const recommendation = recommendationMap.get(item.id);
          
          if (recommendation) {
            // Store forecast data and mark as clean ONLY on success
            await storage.updateItem(item.id, {
              forecastData: recommendation as any,
              forecastDirty: false,
              lastForecastAt: new Date(),
            });
            successCount++;
          } else {
            // No recommendation generated (insufficient data)
            // KEEP item dirty - it still needs review/attention
            // Do not mark clean - absence of forecast is not a success
            noDataCount++;
          }
        } catch (error: any) {
          // Storage failure - keep item dirty for retry
          failures.push({
            itemId: item.id,
            itemName: item.name,
            error: error.message || "Failed to store forecast",
          });
        }
      }
      
      res.json({
        success: true,
        totalDirty: dirtyItems.length,
        successCount,
        noDataCount,
        failureCount: failures.length,
        failures: failures.length > 0 ? failures : undefined,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to run batch forecast job" });
    }
  });

  // Vision API: Identify item from image
  app.post("/api/vision/identify", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const { imageDataUrl } = req.body;

      if (!imageDataUrl) {
        return res.status(400).json({ error: "Image data is required" });
      }

      // Validate base64 image size (limit to 10MB to prevent DoS)
      const maxSizeBytes = 10 * 1024 * 1024; // 10MB
      const base64Data = imageDataUrl.split(',')[1] || imageDataUrl;
      const sizeBytes = Math.ceil((base64Data.length * 3) / 4);
      
      if (sizeBytes > maxSizeBytes) {
        return res.status(413).json({ error: "Image too large. Maximum size is 10MB." });
      }

      // Get user's vision settings
      const settings = await storage.getSettings(userId);
      
      if (!settings?.enableVisionCapture) {
        return res.status(403).json({ error: "Vision capture is not enabled. Please enable it in Settings." });
      }

      const visionProvider = settings.visionProvider || "gpt-4-vision";
      const visionModel = settings.visionModel || "gpt-4o";
      
      // Determine which API key to use based on provider
      let apiKey = "";
      if (visionProvider === "gpt-4-vision") {
        apiKey = settings.llmApiKey || "";
        if (!apiKey) {
          return res.status(400).json({ error: "OpenAI API key is required for GPT-4 Vision. Please configure it in Settings." });
        }
      } else if (visionProvider === "claude-vision") {
        apiKey = settings.llmApiKey || "";
        if (!apiKey) {
          return res.status(400).json({ error: "Anthropic API key is required for Claude Vision. Please configure it in Settings." });
        }
      }

      const result = await LLMService.identifyItemFromImage({
        provider: visionProvider as any,
        apiKey,
        model: visionModel,
        imageDataUrl,
      });

      res.json(result);
    } catch (error: any) {
      console.error("[Vision API] Error:", error);
      res.status(500).json({ error: error.message || "Failed to identify item from image" });
    }
  });

  // ============================================================================
  // BARCODE SETTINGS
  // ============================================================================

  app.get("/api/barcode-settings", requireAuth, async (req: Request, res: Response) => {
    try {
      const settings = await storage.getBarcodeSettings();
      res.json(settings || {
        gs1Prefix: null,
        itemRefDigits: 6,
        nextItemRef: 1,
        nextInternalCode: 1000,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch barcode settings" });
    }
  });

  app.patch("/api/barcode-settings", requireAuth, async (req: Request, res: Response) => {
    try {
      const validated = updateBarcodeSettingsSchema.parse(req.body);
      const settings = await storage.createOrUpdateBarcodeSettings(validated);
      res.json(settings);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Invalid barcode settings" });
    }
  });

  // ============================================================================
  // LABEL FORMATS (Custom label sizes)
  // ============================================================================

  app.get("/api/label-formats", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      const formats = await storage.getLabelFormatsByUserId(userId);
      res.json(formats);
    } catch (error) {
      console.error("[Label Formats] Error fetching formats:", error);
      res.status(500).json({ error: "Failed to fetch label formats" });
    }
  });

  app.get("/api/label-formats/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const format = await storage.getLabelFormat(req.params.id);
      if (!format) {
        return res.status(404).json({ error: "Label format not found" });
      }
      res.json(format);
    } catch (error) {
      console.error("[Label Formats] Error fetching format:", error);
      res.status(500).json({ error: "Failed to fetch label format" });
    }
  });

  app.post("/api/label-formats", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      const { name, layoutType, labelWidth, labelHeight, pageWidth, pageHeight, columns, rows, marginTop, marginLeft, gapX, gapY, isDefault } = req.body;
      
      if (!name || !layoutType || labelWidth === undefined || labelHeight === undefined) {
        return res.status(400).json({ error: "Missing required fields: name, layoutType, labelWidth, labelHeight" });
      }

      const format = await storage.createLabelFormat({
        userId,
        name,
        layoutType,
        labelWidth: Number(labelWidth),
        labelHeight: Number(labelHeight),
        pageWidth: pageWidth !== undefined ? Number(pageWidth) : 8.5,
        pageHeight: pageHeight !== undefined ? Number(pageHeight) : 11,
        columns: columns !== undefined ? Number(columns) : 1,
        rows: rows !== undefined ? Number(rows) : 1,
        marginTop: marginTop !== undefined ? Number(marginTop) : 0,
        marginLeft: marginLeft !== undefined ? Number(marginLeft) : 0,
        gapX: gapX !== undefined ? Number(gapX) : 0,
        gapY: gapY !== undefined ? Number(gapY) : 0,
        isDefault: isDefault || false,
      });
      res.status(201).json(format);
    } catch (error: any) {
      console.error("[Label Formats] Error creating format:", error);
      res.status(400).json({ error: error.message || "Failed to create label format" });
    }
  });

  app.patch("/api/label-formats/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const format = await storage.updateLabelFormat(req.params.id, req.body);
      if (!format) {
        return res.status(404).json({ error: "Label format not found" });
      }
      res.json(format);
    } catch (error: any) {
      console.error("[Label Formats] Error updating format:", error);
      res.status(400).json({ error: error.message || "Failed to update label format" });
    }
  });

  app.delete("/api/label-formats/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const success = await storage.deleteLabelFormat(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Label format not found" });
      }
      res.status(204).send();
    } catch (error) {
      console.error("[Label Formats] Error deleting format:", error);
      res.status(500).json({ error: "Failed to delete label format" });
    }
  });

  app.post("/api/label-formats/:id/set-default", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      await storage.setDefaultLabelFormat(userId, req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("[Label Formats] Error setting default:", error);
      res.status(500).json({ error: "Failed to set default label format" });
    }
  });

  // ============================================================================
  // BARCODE GENERATION
  // ============================================================================

  app.post("/api/barcodes/generate-gs1", requireAuth, async (req: Request, res: Response) => {
    try {
      const generator = new BarcodeGenerator(storage);
      const result = await generator.generateGS1Barcode();

      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      res.json({ barcodeValue: result.barcodeValue });
    } catch (error: any) {
      console.error("[Barcode Generation] Error generating GS1 barcode:", error);
      res.status(500).json({ error: error.message || "Failed to generate GS1 barcode" });
    }
  });

  app.post("/api/barcodes/generate-internal", requireAuth, async (req: Request, res: Response) => {
    try {
      const generator = new BarcodeGenerator(storage);
      const result = await generator.generateInternalCode();

      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      res.json({ barcodeValue: result.barcodeValue });
    } catch (error: any) {
      console.error("[Barcode Generation] Error generating internal code:", error);
      res.status(500).json({ error: error.message || "Failed to generate internal code" });
    }
  });

  // ============================================================================
  // IMPORT PROFILES
  // ============================================================================

  app.get("/api/import-profiles", requireAuth, async (req: Request, res: Response) => {
    try {
      const profiles = await storage.getAllImportProfiles();
      res.json(profiles);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch import profiles" });
    }
  });

  app.get("/api/import-profiles/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const profile = await storage.getImportProfile(req.params.id);
      if (!profile) {
        return res.status(404).json({ error: "Import profile not found" });
      }
      res.json(profile);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch import profile" });
    }
  });

  app.post("/api/import-profiles", requireAuth, async (req: Request, res: Response) => {
    try {
      const validated = insertImportProfileSchema.parse(req.body);
      const profile = await storage.createImportProfile(validated);
      res.status(201).json(profile);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Invalid import profile data" });
    }
  });

  app.patch("/api/import-profiles/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const validated = updateImportProfileSchema.parse(req.body);
      const profile = await storage.updateImportProfile(req.params.id, validated);
      if (!profile) {
        return res.status(404).json({ error: "Import profile not found" });
      }
      res.json(profile);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Invalid import profile data" });
    }
  });

  app.delete("/api/import-profiles/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const success = await storage.deleteImportProfile(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Import profile not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete import profile" });
    }
  });

  // ============================================================================
  // IMPORT JOBS
  // ============================================================================

  app.get("/api/import-jobs", requireAuth, async (req: Request, res: Response) => {
    try {
      const jobs = await storage.getAllImportJobs();
      res.json(jobs);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch import jobs" });
    }
  });

  app.get("/api/import-jobs/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const job = await storage.getImportJob(req.params.id);
      if (!job) {
        return res.status(404).json({ error: "Import job not found" });
      }
      res.json(job);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch import job" });
    }
  });

  app.post("/api/import-jobs", requireAuth, async (req: Request, res: Response) => {
    try {
      const validated = insertImportJobSchema.parse(req.body);
      const job = await storage.createImportJob(validated);
      res.status(201).json(job);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Invalid import job data" });
    }
  });

  app.patch("/api/import-jobs/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const validated = updateImportJobSchema.parse(req.body);
      const job = await storage.updateImportJob(req.params.id, validated);
      if (!job) {
        return res.status(404).json({ error: "Import job not found" });
      }
      res.json(job);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Invalid import job data" });
    }
  });

  // ============================================================================
  // IMPORT OPERATIONS
  // ============================================================================

  const upload = multer({ storage: multer.memoryStorage() });

  app.post("/api/import/upload", requireAuth, upload.single("file"), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const importService = new ImportService(storage);
      const rows = importService.parseFile(req.file.buffer, req.file.originalname);

      if (rows.length === 0) {
        return res.status(400).json({ error: "File contains no data" });
      }

      const headers = Object.keys(rows[0]);
      const suggestedMapping = importService.suggestColumnMappings(headers);

      res.json({
        headers,
        suggestedMapping,
        rowCount: rows.length,
        sampleRows: rows.slice(0, 5),
      });
    } catch (error: any) {
      console.error("[Import] Error uploading file:", error);
      res.status(500).json({ error: error.message || "Failed to parse file" });
    }
  });

  app.post("/api/import/preview", requireAuth, upload.single("file"), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const { columnMapping, matchStrategy = "sku" } = req.body;

      if (!columnMapping) {
        return res.status(400).json({ error: "Column mapping is required" });
      }

      const importService = new ImportService(storage);
      const rows = importService.parseFile(req.file.buffer, req.file.originalname);
      const mapping = typeof columnMapping === "string" ? JSON.parse(columnMapping) : columnMapping;

      const preview = await importService.previewImport(rows, mapping, matchStrategy as any);

      res.json(preview);
    } catch (error: any) {
      console.error("[Import] Error previewing import:", error);
      res.status(500).json({ error: error.message || "Failed to preview import" });
    }
  });

  app.post("/api/import/execute", requireAuth, upload.single("file"), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const { columnMapping, matchStrategy = "sku", profileId } = req.body;

      if (!columnMapping) {
        return res.status(400).json({ error: "Column mapping is required" });
      }

      const importService = new ImportService(storage);
      const rows = importService.parseFile(req.file.buffer, req.file.originalname);
      const mapping = typeof columnMapping === "string" ? JSON.parse(columnMapping) : columnMapping;

      const job = await storage.createImportJob({
        profileId: profileId || null,
        fileName: req.file.originalname,
        status: "processing",
      });

      const result = await importService.executeImport(rows, mapping, matchStrategy as any);

      await storage.updateImportJob(job.id, {
        status: result.success ? "completed" : "failed",
        finishedAt: new Date(),
        summary: JSON.stringify({
          inserted: result.inserted,
          updated: result.updated,
          skipped: result.skipped,
          failed: result.failed,
        }),
        errors: result.errors.length > 0 ? JSON.stringify(result.errors) : null,
      });

      res.json({
        jobId: job.id,
        ...result,
      });
    } catch (error: any) {
      console.error("[Import] Error executing import:", error);
      res.status(500).json({ error: error.message || "Failed to execute import" });
    }
  });

  app.get("/api/import/errors/:jobId", requireAuth, async (req: Request, res: Response) => {
    try {
      const job = await storage.getImportJob(req.params.jobId);
      
      if (!job) {
        return res.status(404).json({ error: "Import job not found" });
      }

      const errors = job.errors ? JSON.parse(job.errors) : [];

      const csvHeader = "Row Number,Error,Data\n";
      const csvRows = errors.map((err: any) => 
        `${err.rowNumber},"${err.error}","${JSON.stringify(err.data).replace(/"/g, '""')}"`
      ).join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=import-errors-${req.params.jobId}.csv`);
      res.send(csvHeader + csvRows);
    } catch (error: any) {
      console.error("[Import] Error downloading errors:", error);
      res.status(500).json({ error: "Failed to download error file" });
    }
  });

  // ============================================================================
  // EXPORT & PRINT OPERATIONS
  // ============================================================================

  app.get("/api/export/items", requireAuth, async (req: Request, res: Response) => {
    try {
      const items = await storage.getAllItems();
      
      // Helper to escape CSV values
      const escapeCSV = (val: string | null | undefined) => {
        if (val === null || val === undefined) return '';
        const str = String(val);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };
      
      // Derive productKind from type if not set
      const getProductKind = (item: any) => {
        if (item.productKind) return item.productKind;
        if (item.type === 'finished_product') return 'FINISHED';
        if (item.type === 'component') return 'RAW';
        return '';
      };
      
      // Prepare CSV data with proper productKind values
      const csvHeader = "Name,SKU,Product Kind,Barcode Value,Barcode Format,Barcode Usage,Current Stock,Min Stock\n";
      const csvRows = items.map(item => 
        [
          escapeCSV(item.name),
          escapeCSV(item.sku),
          escapeCSV(getProductKind(item)),
          escapeCSV(item.barcodeValue),
          escapeCSV(item.barcodeFormat),
          escapeCSV(item.barcodeUsage),
          item.currentStock ?? 0,
          item.minStock ?? 0
        ].join(',')
      ).join('\n');
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=items-export.csv');
      res.send(csvHeader + csvRows);
    } catch (error) {
      res.status(500).json({ error: "Failed to export items" });
    }
  });

  app.get("/api/print/labels", requireAuth, async (req: Request, res: Response) => {
    try {
      const { ids } = req.query;
      
      if (!ids || typeof ids !== 'string') {
        return res.status(400).json({ error: "Product IDs are required" });
      }
      
      const productIds = ids.split(',');
      const items = await Promise.all(
        productIds.map(id => storage.getItem(id))
      );
      
      const validItems = items.filter(item => item !== undefined);
      res.json({ items: validItems, message: "Ready for printing" });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch items for printing" });
    }
  });

  // ============================================================================
  // INVENTORY TRANSACTIONS
  // ============================================================================

  const transactionService = new TransactionService(storage);
  const backorderService = new BackorderService(storage);

  app.post("/api/transactions", requireAuth, async (req: Request, res: Response) => {
    try {
      const { itemId, itemType, type, location, quantity, notes } = req.body;

      if (!itemId || !itemType || !type || !location || quantity === undefined) {
        return res.status(400).json({ 
          error: "itemId, itemType, type, location, and quantity are required" 
        });
      }

      if (quantity <= 0) {
        return res.status(400).json({ error: "Quantity must be positive" });
      }

      const result = await transactionService.applyTransaction({
        itemId,
        itemType,
        type,
        location,
        quantity,
        notes: notes || null,
        createdBy: req.session.userId || "system",
      });

      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      res.status(201).json(result.transaction);
    } catch (error: any) {
      console.error("[Transaction] Error creating transaction:", error);
      res.status(500).json({ error: error.message || "Failed to create transaction" });
    }
  });

  app.get("/api/transactions/:itemId", requireAuth, async (req: Request, res: Response) => {
    try {
      const { itemId } = req.params;
      const transactions = await transactionService.getTransactionHistory(itemId);
      res.json(transactions);
    } catch (error: any) {
      console.error("[Transaction] Error fetching transaction history:", error);
      res.status(500).json({ error: "Failed to fetch transaction history" });
    }
  });

  app.post("/api/transactions/transfer", requireAuth, async (req: Request, res: Response) => {
    try {
      const { itemId, fromLocation, toLocation, quantity, notes } = req.body;

      if (!itemId || !fromLocation || !toLocation || quantity === undefined) {
        return res.status(400).json({ 
          error: "itemId, fromLocation, toLocation, and quantity are required" 
        });
      }

      if (quantity <= 0) {
        return res.status(400).json({ error: "Quantity must be positive" });
      }

      if (fromLocation === toLocation) {
        return res.status(400).json({ error: "Cannot transfer to the same location" });
      }

      if (!['HILDALE', 'PIVOT'].includes(fromLocation) || !['HILDALE', 'PIVOT'].includes(toLocation)) {
        return res.status(400).json({ error: "Location must be either HILDALE or PIVOT" });
      }

      const result = await transactionService.applyTransfer({
        itemId,
        fromLocation,
        toLocation,
        quantity,
        notes,
        createdBy: req.session.userId || "system",
      });

      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      res.status(201).json(result.transaction);
    } catch (error: any) {
      console.error("[Transaction] Error processing transfer:", error);
      res.status(500).json({ error: error.message || "Failed to process transfer" });
    }
  });

  app.post("/api/transactions/produce", requireAuth, async (req: Request, res: Response) => {
    try {
      const { finishedProductId, quantity, notes } = req.body;

      if (!finishedProductId || quantity === undefined) {
        return res.status(400).json({ 
          error: "finishedProductId and quantity are required" 
        });
      }

      if (quantity <= 0) {
        return res.status(400).json({ error: "Quantity must be positive" });
      }

      const result = await transactionService.applyProduction({
        finishedProductId,
        quantity,
        notes,
        createdBy: req.session.userId || "system",
      });

      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      res.status(201).json(result.transaction);
    } catch (error: any) {
      console.error("[Transaction] Error processing production:", error);
      res.status(500).json({ error: error.message || "Failed to process production" });
    }
  });

  // ============================================================================
  // AI RECOMMENDATIONS
  // ============================================================================

  app.get("/api/ai-recommendations", requireAuth, async (req: Request, res: Response) => {
    try {
      const { itemId, type } = req.query;
      let recommendations = await storage.getAllAIRecommendations();
      
      if (itemId) {
        recommendations = recommendations.filter(r => r.itemId === itemId);
      }
      if (type) {
        recommendations = recommendations.filter(r => r.type === type);
      }
      
      res.json(recommendations);
    } catch (error: any) {
      console.error("[AIRecommendation] Error fetching AI recommendations:", error);
      res.status(500).json({ error: "Failed to fetch AI recommendations" });
    }
  });

  app.get("/api/ai-recommendations/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const recommendation = await storage.getAIRecommendation(id);
      
      if (!recommendation) {
        return res.status(404).json({ error: "AI recommendation not found" });
      }
      
      res.json(recommendation);
    } catch (error: any) {
      console.error("[AIRecommendation] Error fetching AI recommendation:", error);
      res.status(500).json({ error: "Failed to fetch AI recommendation" });
    }
  });

  app.patch("/api/ai-recommendations/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const updates = req.body;
      
      const updated = await storage.updateAIRecommendation(id, updates);
      
      if (!updated) {
        return res.status(404).json({ error: "AI recommendation not found" });
      }
      
      res.json(updated);
    } catch (error: any) {
      console.error("[AIRecommendation] Error updating AI recommendation:", error);
      res.status(500).json({ error: "Failed to update AI recommendation" });
    }
  });

  // ============================================================================
  // AI BATCH LOGS
  // ============================================================================

  app.get("/api/ai-batch-logs", requireAuth, async (req: Request, res: Response) => {
    try {
      const { limit, reason } = req.query;
      
      let logs;
      if (reason && typeof reason === "string") {
        logs = await storage.getAIBatchLogsByReason(reason);
      } else {
        logs = await storage.getAllAIBatchLogs(limit ? parseInt(limit as string) : 50);
      }
      
      res.json(logs);
    } catch (error: any) {
      console.error("[AIBatchLog] Error fetching batch logs:", error);
      res.status(500).json({ error: "Failed to fetch batch logs" });
    }
  });

  app.get("/api/ai-batch-logs/latest", requireAuth, async (req: Request, res: Response) => {
    try {
      const log = await storage.getLatestAIBatchLog();
      
      if (!log) {
        return res.status(404).json({ error: "No batch logs found" });
      }
      
      res.json(log);
    } catch (error: any) {
      console.error("[AIBatchLog] Error fetching latest batch log:", error);
      res.status(500).json({ error: "Failed to fetch latest batch log" });
    }
  });

  app.get("/api/ai-batch-logs/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const log = await storage.getAIBatchLog(id);
      
      if (!log) {
        return res.status(404).json({ error: "Batch log not found" });
      }
      
      res.json(log);
    } catch (error: any) {
      console.error("[AIBatchLog] Error fetching batch log:", error);
      res.status(500).json({ error: "Failed to fetch batch log" });
    }
  });

  app.get("/api/ai-batch-scheduler/status", requireAuth, async (req: Request, res: Response) => {
    try {
      const { getSchedulerStatus } = await import("./services/ai-batch-scheduler");
      const status = getSchedulerStatus();
      res.json(status);
    } catch (error: any) {
      console.error("[AIBatchScheduler] Error fetching scheduler status:", error);
      res.status(500).json({ error: "Failed to fetch scheduler status" });
    }
  });

  app.post("/api/ai-batch/run", requireAuth, async (req: Request, res: Response) => {
    try {
      const { triggerManualBatch } = await import("./services/ai-batch-scheduler");
      const result = await triggerManualBatch();
      
      if (result.success) {
        res.json({ success: true, message: result.message });
      } else {
        res.status(400).json({ success: false, error: result.message });
      }
    } catch (error: any) {
      console.error("[AIBatch] Error running manual batch:", error);
      res.status(500).json({ error: error.message || "Failed to run batch" });
    }
  });

  // Manual trigger for credential rotation check
  app.post("/api/rotation-check/run", requireAuth, async (req: Request, res: Response) => {
    try {
      const { triggerManualRotationCheck } = await import("./services/credential-rotation-scheduler");
      const result = await triggerManualRotationCheck();
      
      if (result.success) {
        res.json({ success: true, message: result.message, details: result.details });
      } else {
        res.status(400).json({ success: false, error: result.message, details: result.details });
      }
    } catch (error: any) {
      console.error("[RotationCheck] Error running manual check:", error);
      res.status(500).json({ error: error.message || "Failed to run rotation check" });
    }
  });

  // Get rotation scheduler status
  app.get("/api/rotation-check/status", requireAuth, async (_req: Request, res: Response) => {
    try {
      const { getRotationSchedulerStatus } = await import("./services/credential-rotation-scheduler");
      const status = getRotationSchedulerStatus();
      res.json(status);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to get rotation scheduler status" });
    }
  });

  // ============================================================================
  // PURCHASE ORDERS
  // ============================================================================

  app.get("/api/purchase-orders", requireAuth, async (req: Request, res: Response) => {
    try {
      // Support filtering by live/historical via query params
      const { view, startDate, endDate, status, supplierId } = req.query as {
        view?: 'live' | 'historical' | 'all';
        startDate?: string;
        endDate?: string;
        status?: string;
        supplierId?: string;
      };
      
      let purchaseOrders: PurchaseOrder[];
      
      if (view === 'historical') {
        const options: any = {};
        if (startDate) options.startDate = new Date(startDate);
        if (endDate) options.endDate = new Date(endDate);
        if (status) options.status = status;
        if (supplierId) options.supplierId = supplierId;
        purchaseOrders = await storage.getHistoricalPurchaseOrders(options);
      } else if (view === 'live') {
        purchaseOrders = await storage.getLivePurchaseOrders();
      } else {
        // Default to all for backwards compatibility
        purchaseOrders = await storage.getAllPurchaseOrders();
      }
      
      // Enrich with line items and derived display status
      const enrichedPOs = await Promise.all(
        purchaseOrders.map(async (po) => {
          const lines = await storage.getPurchaseOrderLinesByPOId(po.id);
          const totalQtyOrdered = lines.reduce((sum, l) => sum + (l.qtyOrdered || 0), 0);
          const totalQtyReceived = lines.reduce((sum, l) => sum + (l.qtyReceived || 0), 0);
          
          // Derive the display status based on lifecycle
          const displayStatus = derivePoDisplayStatus(
            {
              status: po.status,
              lastEmailStatus: po.lastEmailStatus,
              lastEmailSentAt: po.lastEmailSentAt,
              acknowledgementStatus: po.acknowledgementStatus,
            },
            totalQtyOrdered,
            totalQtyReceived
          );
          
          return { ...po, lines, displayStatus, totalQtyOrdered, totalQtyReceived };
        })
      );
      
      res.json(enrichedPOs);
    } catch (error: any) {
      console.error("[PurchaseOrder] Error fetching purchase orders:", error);
      res.status(500).json({ error: "Failed to fetch purchase orders" });
    }
  });

  // Get PO summary for dashboard cards (must come before /:id route)
  app.get("/api/purchase-orders/summary", requireAuth, async (req: Request, res: Response) => {
    try {
      const allPOs = await storage.getAllPurchaseOrders();
      
      // Calculate derived status for each PO for accurate summary
      const posWithDerivedStatus = await Promise.all(
        allPOs.map(async (po) => {
          const lines = await storage.getPurchaseOrderLinesByPOId(po.id);
          const totalQtyOrdered = lines.reduce((sum, l) => sum + (l.qtyOrdered || 0), 0);
          const totalQtyReceived = lines.reduce((sum, l) => sum + (l.qtyReceived || 0), 0);
          const displayStatus = derivePoDisplayStatus(
            {
              status: po.status,
              lastEmailStatus: po.lastEmailStatus,
              lastEmailSentAt: po.lastEmailSentAt,
              acknowledgementStatus: po.acknowledgementStatus,
            },
            totalQtyOrdered,
            totalQtyReceived
          );
          return { ...po, displayStatus };
        })
      );
      
      const summary = {
        total: posWithDerivedStatus.length,
        draft: posWithDerivedStatus.filter(po => po.displayStatus === 'DRAFT').length,
        sent: posWithDerivedStatus.filter(po => po.displayStatus === 'SENT').length,
        accepted: posWithDerivedStatus.filter(po => po.displayStatus === 'ACCEPTED').length,
        partial: posWithDerivedStatus.filter(po => po.displayStatus === 'PARTIAL').length,
        received: posWithDerivedStatus.filter(po => po.displayStatus === 'RECEIVED').length,
        closed: posWithDerivedStatus.filter(po => po.displayStatus === 'CLOSED').length,
        cancelled: posWithDerivedStatus.filter(po => po.displayStatus === 'CANCELLED').length,
      };
      res.json(summary);
    } catch (error: any) {
      console.error("[PurchaseOrder] Error fetching summary:", error);
      res.status(500).json({ error: "Failed to fetch PO summary" });
    }
  });

  app.get("/api/purchase-orders/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const purchaseOrder = await storage.getPurchaseOrder(id);
      
      if (!purchaseOrder) {
        return res.status(404).json({ error: "Purchase order not found" });
      }

      const lines = await storage.getPurchaseOrderLinesByPOId(id);
      const totalQtyOrdered = lines.reduce((sum, l) => sum + (l.qtyOrdered || 0), 0);
      const totalQtyReceived = lines.reduce((sum, l) => sum + (l.qtyReceived || 0), 0);
      
      // Derive the display status based on lifecycle
      const displayStatus = derivePoDisplayStatus(
        {
          status: purchaseOrder.status,
          lastEmailStatus: purchaseOrder.lastEmailStatus,
          lastEmailSentAt: purchaseOrder.lastEmailSentAt,
          acknowledgementStatus: purchaseOrder.acknowledgementStatus,
        },
        totalQtyOrdered,
        totalQtyReceived
      );
      
      res.json({ ...purchaseOrder, lines, displayStatus, totalQtyOrdered, totalQtyReceived });
    } catch (error: any) {
      console.error("[PurchaseOrder] Error fetching purchase order:", error);
      res.status(500).json({ error: "Failed to fetch purchase order" });
    }
  });

  app.post("/api/purchase-orders", requireAuth, async (req: Request, res: Response) => {
    let createdPOId: string | null = null;
    try {
      const { lines, ...poData } = req.body;
      
      // Auto-generate PO number if not provided
      if (!poData.poNumber) {
        const allPOs = await storage.getAllPurchaseOrders();
        const year = new Date().getFullYear();
        const existingPOsThisYear = allPOs.filter(po => 
          po.poNumber?.startsWith(`PO-${year}-`)
        );
        const nextSequence = existingPOsThisYear.length + 1;
        poData.poNumber = `PO-${year}-${String(nextSequence).padStart(4, '0')}`;
      }
      
      // PO Hildale-only routing: Always route POs to Hildale warehouse
      // Pivot/Extensiv is a 3PL for fulfillment only - components/raw materials always go to Hildale
      if (!poData.shipToLocation) {
        poData.shipToLocation = 'HILDALE';
      }
      
      const validatedPO = insertPurchaseOrderSchema.parse(poData);
      const purchaseOrder = await storage.createPurchaseOrder(validatedPO);
      createdPOId = purchaseOrder.id;

      // Track linked AI recommendations for status updates
      const linkedRecommendations: Array<{
        recommendationId: string;
        itemId: string;
        sku: string;
        recommendedQty: number;
        orderedQty: number;
        riskLevel?: string;
        daysUntilStockout?: number;
        stockGapPercent?: number;
      }> = [];
      
      if (lines && Array.isArray(lines)) {
        for (const line of lines) {
          const item = await storage.getItem(line.itemId);
          const location = item?.type === 'finished_product' ? 'PIVOT' : null;
          
          // Use explicitly passed aiRecommendationId or fall back to latest recommendation
          let recommendationId = line.aiRecommendationId;
          let recommendedQty = null;
          
          if (recommendationId) {
            // Use the passed recommendation ID
            const rec = await storage.getAIRecommendation(recommendationId);
            if (rec) {
              recommendedQty = rec.recommendedQty;
              // Track for logging and status update
              linkedRecommendations.push({
                recommendationId,
                itemId: line.itemId,
                sku: item?.sku || 'N/A',
                recommendedQty: rec.recommendedQty || line.quantity,
                orderedQty: line.quantity,
                riskLevel: rec.riskLevel ?? undefined,
                daysUntilStockout: rec.daysUntilStockout ?? undefined,
                stockGapPercent: rec.stockGapPercent ?? undefined,
              });
            }
          } else {
            // Fall back to latest recommendation lookup
            const latestRecommendation = await storage.getLatestAIRecommendationForItem(
              line.itemId,
              location
            );
            if (latestRecommendation) {
              recommendationId = latestRecommendation.id;
              recommendedQty = latestRecommendation.recommendedQty;
            }
          }
          
          const validatedLine = insertPurchaseOrderLineSchema.parse({
            ...line,
            purchaseOrderId: purchaseOrder.id,
            aiRecommendationId: recommendationId || null,
            recommendedQtyAtOrderTime: recommendedQty || null,
            finalOrderedQty: line.quantity,
          });
          await storage.createPurchaseOrderLine(validatedLine);
        }
      }

      const createdLines = await storage.getPurchaseOrderLinesByPOId(purchaseOrder.id);
      
      // Recalculate PO totals after creating all lines
      if (createdLines.length > 0) {
        await storage.recalculatePOTotals(purchaseOrder.id);
      }
      
      // Update linked recommendations to ACCEPTED and log AI events
      const supplier = validatedPO.supplierId ? await storage.getSupplier(validatedPO.supplierId) : null;
      for (const linked of linkedRecommendations) {
        try {
          // Update recommendation status to ACCEPTED
          await storage.updateAIRecommendation(linked.recommendationId, { status: 'ACCEPTED' });
          
          // Log AI_RECOMMENDATION_PO_CREATED event
          await AuditLogger.logEvent({
            source: 'USER',
            eventType: 'AI_RECOMMENDATION_PO_CREATED',
            entityType: 'PURCHASE_ORDER',
            entityId: purchaseOrder.id,
            entityLabel: purchaseOrder.poNumber,
            description: `PO created from AI recommendation for ${linked.sku}`,
            purchaseOrderId: purchaseOrder.id,
            supplierId: validatedPO.supplierId || '',
            details: {
              sku: linked.sku,
              recommendedQty: linked.recommendedQty,
              orderedQty: linked.orderedQty,
              supplierName: supplier?.name || 'Unknown Supplier',
              recommendationId: linked.recommendationId,
              riskLevel: linked.riskLevel,
              daysUntilStockout: linked.daysUntilStockout,
              stockGapPercent: linked.stockGapPercent,
            },
          });
        } catch (recError) {
          console.warn('[PurchaseOrder] Failed to update recommendation status:', recError);
        }
      }

      // Log PO creation
      try {
        const user = await storage.getUser(req.session.userId!);
        await AuditLogger.logPOCreated({
          poId: purchaseOrder.id,
          poNumber: purchaseOrder.poNumber,
          supplierId: validatedPO.supplierId || '',
          supplierName: supplier?.name || 'Unknown Supplier',
          userId: req.session.userId!,
          userName: user?.email,
          itemCount: createdLines.length,
        });
      } catch (logError) {
        console.warn('[PurchaseOrder] Failed to log PO creation:', logError);
      }

      res.status(201).json({ ...purchaseOrder, lines: createdLines });
    } catch (error: any) {
      if (createdPOId) {
        try {
          await storage.deletePurchaseOrder(createdPOId);
        } catch (rollbackError) {
          console.error("[PurchaseOrder] Error rolling back PO:", rollbackError);
        }
      }
      console.error("[PurchaseOrder] Error creating purchase order:", error);
      res.status(400).json({ error: error.message || "Failed to create purchase order" });
    }
  });

  // Create PO, generate message via LLM, and send via GHL
  app.post("/api/purchase-orders/create-and-send", requireAuth, async (req: Request, res: Response) => {
    let createdPOId: string | null = null;
    try {
      const { 
        supplierId,
        supplierName,
        supplierEmail,
        supplierPhone,
        items,
        sendVia,
        notes,
        isNewSupplier,
      } = req.body;

      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "At least one item is required" });
      }

      if (!supplierId && !isNewSupplier) {
        return res.status(400).json({ error: "Supplier is required" });
      }

      // Create new supplier if needed
      let finalSupplierId = supplierId;
      if (isNewSupplier && supplierName) {
        const newSupplier = await storage.createSupplier({
          name: supplierName,
          email: supplierEmail || null,
          phone: supplierPhone || null,
        });
        finalSupplierId = newSupplier.id;
      }

      // Get supplier details
      const supplier = await storage.getSupplier(finalSupplierId);
      if (!supplier) {
        return res.status(404).json({ error: "Supplier not found" });
      }

      // Use provided contact info or fall back to supplier's stored info
      const contactEmail = supplierEmail || supplier.email;
      const contactPhone = supplierPhone || supplier.phone;

      if (!contactEmail && !contactPhone) {
        return res.status(400).json({ error: "Supplier must have email or phone to receive PO" });
      }

      // Generate PO number
      const allPOs = await storage.getAllPurchaseOrders();
      const year = new Date().getFullYear();
      const existingPOsThisYear = allPOs.filter(po => 
        po.poNumber?.startsWith(`PO-${year}-`)
      );
      const nextSequence = existingPOsThisYear.length + 1;
      const poNumber = `PO-${year}-${String(nextSequence).padStart(4, '0')}`;

      // Create the PO with Hildale-only routing
      // Components/raw materials always go to Hildale warehouse (not Pivot/Extensiv 3PL)
      const purchaseOrder = await storage.createPurchaseOrder({
        poNumber,
        supplierId: finalSupplierId,
        status: 'DRAFT',
        shipToLocation: 'HILDALE',
      });
      createdPOId = purchaseOrder.id;

      // Create PO lines and track linked recommendations
      const linkedRecommendations: Array<{
        recommendationId: string;
        itemId: string;
        sku: string;
        recommendedQty: number;
        orderedQty: number;
        riskLevel?: string;
        daysUntilStockout?: number;
        stockGapPercent?: number;
      }> = [];
      
      for (const item of items) {
        const itemRecord = await storage.getItem(item.itemId);
        const location = itemRecord?.type === 'finished_product' ? 'PIVOT' : null;
        
        // Use explicitly passed aiRecommendationId or fall back to latest recommendation
        let recommendationId = item.aiRecommendationId;
        let recommendedQty = null;
        
        if (recommendationId) {
          // Use the passed recommendation ID
          const rec = await storage.getAIRecommendation(recommendationId);
          if (rec) {
            recommendedQty = rec.recommendedQty;
            // Track for logging and status update
            linkedRecommendations.push({
              recommendationId,
              itemId: item.itemId,
              sku: itemRecord?.sku || 'N/A',
              recommendedQty: rec.recommendedQty || item.quantity,
              orderedQty: item.quantity,
              riskLevel: rec.riskLevel ?? undefined,
              daysUntilStockout: rec.daysUntilStockout ?? undefined,
              stockGapPercent: rec.stockGapPercent ?? undefined,
            });
          }
        } else {
          // Fall back to latest recommendation lookup
          const recommendations = await storage.getAIRecommendationsByItem(item.itemId);
          const latestRecommendation = recommendations.find(r => r.status === 'NEW') || recommendations[0];
          if (latestRecommendation) {
            recommendationId = latestRecommendation.id;
            recommendedQty = latestRecommendation.recommendedQty;
          }
        }
        
        await storage.createPurchaseOrderLine({
          purchaseOrderId: purchaseOrder.id,
          itemId: item.itemId,
          qtyOrdered: item.quantity,
          unitCost: item.unitCost || null,
          aiRecommendationId: recommendationId || null,
          recommendedQtyAtOrderTime: recommendedQty,
          finalOrderedQty: item.quantity,
        });
      }
      
      // Update linked recommendations to ACCEPTED and log AI events
      for (const linked of linkedRecommendations) {
        try {
          // Update recommendation status to ACCEPTED
          await storage.updateAIRecommendation(linked.recommendationId, { status: 'ACCEPTED' });
          
          // Log AI_RECOMMENDATION_PO_CREATED event
          await AuditLogger.logEvent({
            source: 'USER',
            eventType: 'AI_RECOMMENDATION_PO_CREATED',
            entityType: 'PURCHASE_ORDER',
            entityId: purchaseOrder.id,
            entityLabel: poNumber,
            description: `PO created from AI recommendation for ${linked.sku}`,
            purchaseOrderId: purchaseOrder.id,
            supplierId: finalSupplierId,
            details: {
              sku: linked.sku,
              recommendedQty: linked.recommendedQty,
              orderedQty: linked.orderedQty,
              supplierName: supplier.name,
              recommendationId: linked.recommendationId,
              riskLevel: linked.riskLevel,
              daysUntilStockout: linked.daysUntilStockout,
              stockGapPercent: linked.stockGapPercent,
            },
          });
        } catch (recError) {
          console.warn('[PurchaseOrder] Failed to update recommendation status:', recError);
        }
      }

      // Log PO creation
      try {
        const user = await storage.getUser(req.session.userId!);
        await AuditLogger.logPOCreated({
          poId: purchaseOrder.id,
          poNumber: poNumber,
          supplierId: finalSupplierId,
          supplierName: supplier.name,
          userId: req.session.userId!,
          userName: user?.email,
          itemCount: items.length,
        });
      } catch (logError) {
        console.warn('[PurchaseOrder] Failed to log PO creation:', logError);
      }

      // Generate PO content via LLM
      const poItems = await Promise.all(items.map(async (item: any) => {
        const itemRecord = await storage.getItem(item.itemId);
        const daysUntilStockout = itemRecord && itemRecord.dailyUsage > 0
          ? Math.floor(itemRecord.currentStock / itemRecord.dailyUsage)
          : undefined;
        return {
          sku: itemRecord?.sku || 'N/A',
          name: itemRecord?.name || 'Unknown Item',
          quantity: item.quantity,
          currentStock: itemRecord?.currentStock || 0,
          daysUntilStockout,
          unitPrice: item.unitCost,
        };
      }));

      const poContent = await LLMService.generatePOContent({
        supplierName: supplier.name,
        supplierEmail: contactEmail || undefined,
        supplierPhone: contactPhone || undefined,
        items: poItems,
        poNumber,
        companyName: 'Inventory Management System',
        notes: notes || undefined,
      });

      // Send via GHL
      const settings = await storage.getSettingsByUserId(req.session.userId!);
      let ghlResult: { success: boolean; messageId?: string; error?: string } = { success: false };
      let sentMethod: 'EMAIL' | 'SMS' | null = null;

      if (settings?.gohighlevelApiKey && settings?.gohighlevelLocationId) {
        const ghlClient = new GoHighLevelClient(
          'https://services.leadconnectorhq.com',
          settings.gohighlevelApiKey,
          settings.gohighlevelLocationId
        );

        // Create or find contact in GHL
        const contactResult = await ghlClient.createOrFindContact(
          supplier.name,
          contactEmail || undefined,
          contactPhone || undefined
        );

        if (contactResult.success && contactResult.contactId) {
          // Update supplier with GHL contact ID
          await storage.updateSupplier(finalSupplierId, {
            ghlContactId: contactResult.contactId,
          });

          // Send based on preference
          if (sendVia === 'EMAIL' && contactEmail) {
            ghlResult = await ghlClient.sendEmail(
              contactResult.contactId,
              poContent.subject,
              poContent.body
            );
            sentMethod = 'EMAIL';
          } else if (sendVia === 'SMS' && contactPhone) {
            ghlResult = await ghlClient.sendSMS(
              contactResult.contactId,
              poContent.smsMessage
            );
            sentMethod = 'SMS';
          } else if (contactEmail) {
            ghlResult = await ghlClient.sendEmail(
              contactResult.contactId,
              poContent.subject,
              poContent.body
            );
            sentMethod = 'EMAIL';
          } else if (contactPhone) {
            ghlResult = await ghlClient.sendSMS(
              contactResult.contactId,
              poContent.smsMessage
            );
            sentMethod = 'SMS';
          }
        }
      }

      // Update PO status and persist GHL send results for audit/tracking
      const sendTimestamp = new Date();
      if (ghlResult.success) {
        await storage.updatePurchaseOrder(purchaseOrder.id, {
          status: 'SENT',
          sentAt: sendTimestamp,
          // GHL Send tracking fields (V1 Direct API)
          lastSendChannel: sentMethod,
          lastSendStatus: 'SUCCESS',
          lastSendTimestamp: sendTimestamp,
          lastSendMessageId: ghlResult.messageId || null,
          lastSendError: null, // Clear any previous error
        });

        // Write audit log for successful send
        await storage.createAuditLog({
          actorType: 'USER',
          actorId: req.session.userId,
          eventType: sentMethod === 'EMAIL' ? 'PO_SENT_GHL_EMAIL' : 'PO_SENT_GHL_SMS',
          entityType: 'PURCHASE_ORDER',
          entityId: purchaseOrder.id,
          purchaseOrderId: purchaseOrder.id,
          supplierId: finalSupplierId,
          success: true,
          details: {
            poNumber: poNumber,
            supplierName: supplier.name,
            channel: sentMethod,
            messageId: ghlResult.messageId,
            subject: sentMethod === 'EMAIL' ? poContent.subject : undefined,
            recipientEmail: sentMethod === 'EMAIL' ? contactEmail : undefined,
            recipientPhone: sentMethod === 'SMS' ? contactPhone : undefined,
          },
        });
      } else {
        await storage.updatePurchaseOrder(purchaseOrder.id, {
          status: 'APPROVAL_PENDING',
          // GHL Send tracking fields - record the failed attempt
          lastSendChannel: sentMethod || null,
          lastSendStatus: 'FAILED',
          lastSendTimestamp: sendTimestamp,
          lastSendMessageId: null,
          lastSendError: ghlResult.error || 'Unknown error sending via GHL',
        });

        // Write audit log for failed send
        await storage.createAuditLog({
          actorType: 'USER',
          actorId: req.session.userId,
          eventType: 'PO_SEND_FAILED',
          entityType: 'PURCHASE_ORDER',
          entityId: purchaseOrder.id,
          purchaseOrderId: purchaseOrder.id,
          supplierId: finalSupplierId,
          success: false,
          errorMessage: ghlResult.error || 'Unknown error sending via GHL',
          details: {
            poNumber: poNumber,
            supplierName: supplier.name,
            attemptedChannel: sentMethod || sendVia,
            error: ghlResult.error,
            recipientEmail: contactEmail,
            recipientPhone: contactPhone,
          },
        });
      }

      // ============================================================================
      // V2 WEBHOOK PATH (FUTURE)
      // ============================================================================
      // When V2 webhook integration is implemented:
      // 1. Check settings for gohighlevelInboundWebhookUrl
      // 2. If webhook URL is configured and user prefers webhook:
      //    - POST the PO payload to the webhook URL
      //    - GHL workflow handles contact creation and message sending
      //    - Store webhook response ID for tracking
      // 3. Fall back to direct API if webhook fails or not configured
      // ============================================================================

      const updatedPO = await storage.getPurchaseOrder(purchaseOrder.id);
      const lines = await storage.getPurchaseOrderLinesByPOId(purchaseOrder.id);

      res.status(201).json({
        purchaseOrder: { ...updatedPO, lines },
        poContent,
        ghlResult: {
          success: ghlResult.success,
          sentMethod,
          messageId: ghlResult.messageId,
          error: ghlResult.error,
        },
      });
    } catch (error: any) {
      if (createdPOId) {
        try {
          await storage.deletePurchaseOrder(createdPOId);
        } catch (rollbackError) {
          console.error("[PurchaseOrder] Error rolling back PO:", rollbackError);
        }
      }
      console.error("[PurchaseOrder] Error creating and sending PO:", error);
      res.status(500).json({ error: error.message || "Failed to create and send purchase order" });
    }
  });

  app.patch("/api/purchase-orders/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const validatedUpdates = insertPurchaseOrderSchema.partial().parse(req.body);
      
      const updated = await storage.updatePurchaseOrder(id, validatedUpdates);
      
      if (!updated) {
        return res.status(404).json({ error: "Purchase order not found" });
      }

      if ('shippingCost' in validatedUpdates || 'taxes' in validatedUpdates) {
        const recalculated = await storage.recalculatePOTotals(id);
        if (recalculated) {
          const lines = await storage.getPurchaseOrderLinesByPOId(id);
          return res.json({ ...recalculated, lines });
        }
      }

      res.json(updated);
    } catch (error: any) {
      console.error("[PurchaseOrder] Error updating purchase order:", error);
      res.status(400).json({ error: error.message || "Failed to update purchase order" });
    }
  });

  app.post("/api/purchase-orders/:id/update-financials", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { shippingCost, taxes } = req.body;
      
      const po = await storage.getPurchaseOrder(id);
      if (!po) {
        return res.status(404).json({ error: "Purchase order not found" });
      }

      const updates: any = { updatedAt: new Date() };
      if (shippingCost !== undefined) {
        updates.shippingCost = Math.round((Number(shippingCost) || 0) * 100) / 100;
      }
      if (taxes !== undefined) {
        updates.taxes = Math.round((Number(taxes) || 0) * 100) / 100;
      }
      
      await storage.updatePurchaseOrder(id, updates);
      const recalculated = await storage.recalculatePOTotals(id);
      
      if (!recalculated) {
        return res.status(404).json({ error: "Failed to recalculate totals" });
      }

      const lines = await storage.getPurchaseOrderLinesByPOId(id);
      res.json({ ...recalculated, lines });
    } catch (error: any) {
      console.error("[PurchaseOrder] Error updating financials:", error);
      res.status(400).json({ error: error.message || "Failed to update financials" });
    }
  });

  // PUT endpoint for full PO edit (including line items) - only for DRAFT status
  app.put("/api/purchase-orders/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { supplierId, orderDate, expectedDate, shippingCost, taxes, notes, lines } = req.body;

      const existingPO = await storage.getPurchaseOrder(id);
      if (!existingPO) {
        return res.status(404).json({ error: "Purchase order not found" });
      }

      // Only allow editing DRAFT status POs
      if (!['DRAFT', 'APPROVAL_PENDING', 'APPROVED'].includes(existingPO.status)) {
        return res.status(400).json({ error: "Only draft purchase orders can be edited" });
      }

      // Validate supplierId is provided
      const effectiveSupplierId = supplierId || existingPO.supplierId;
      if (!effectiveSupplierId) {
        return res.status(400).json({ error: "Supplier is required" });
      }

      // Validate supplier exists if being changed
      if (supplierId && supplierId !== existingPO.supplierId) {
        const supplier = await storage.getSupplier(supplierId);
        if (!supplier) {
          return res.status(400).json({ error: "Invalid supplier" });
        }
      }

      // Validate lines only if they are being updated
      if (lines !== undefined && lines !== null) {
        if (!Array.isArray(lines)) {
          return res.status(400).json({ error: "Lines must be an array" });
        }
        
        if (lines.length === 0) {
          return res.status(400).json({ error: "At least one line item is required" });
        }

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (!line.itemId) {
            return res.status(400).json({ error: `Line ${i + 1}: Item ID is required` });
          }
          if (!line.qtyOrdered || line.qtyOrdered < 1) {
            return res.status(400).json({ error: `Line ${i + 1}: Quantity must be greater than 0` });
          }
          if (line.unitCost === undefined || line.unitCost === null || line.unitCost <= 0) {
            return res.status(400).json({ error: `Line ${i + 1}: Unit cost must be greater than 0` });
          }
        }
      }
      // Note: If lines is not provided (undefined/null), we skip line validation
      // and only update the PO header fields, preserving existing lines

      // Update PO header
      const poUpdates: any = { updatedAt: new Date() };
      if (supplierId) poUpdates.supplierId = supplierId;
      if (orderDate) poUpdates.orderDate = new Date(orderDate);
      if (expectedDate !== undefined) poUpdates.expectedDate = expectedDate ? new Date(expectedDate) : null;
      if (shippingCost !== undefined) poUpdates.shippingCost = Math.round((Number(shippingCost) || 0) * 100) / 100;
      if (taxes !== undefined) poUpdates.taxes = Math.round((Number(taxes) || 0) * 100) / 100;
      if (notes !== undefined) poUpdates.notes = notes;

      await storage.updatePurchaseOrder(id, poUpdates);

      // Handle line items if provided
      if (lines && Array.isArray(lines)) {
        // Get existing lines
        const existingLines = await storage.getPurchaseOrderLinesByPOId(id);
        const existingLineIds = new Set(existingLines.map(l => l.id));
        const incomingLineIds = new Set(lines.filter((l: any) => l.id && !l.id.startsWith('temp-')).map((l: any) => l.id));

        // Delete lines that are no longer present
        for (const existingLine of existingLines) {
          if (!incomingLineIds.has(existingLine.id)) {
            await storage.deletePurchaseOrderLine(existingLine.id);
          }
        }

        // Update or create lines
        for (const line of lines) {
          const item = await storage.getItem(line.itemId);
          if (!item) continue;

          const lineTotal = Math.round((line.qtyOrdered * line.unitCost) * 100) / 100;

          if (line.id && existingLineIds.has(line.id)) {
            // Update existing line
            await storage.updatePurchaseOrderLine(line.id, {
              itemId: line.itemId,
              sku: item.sku,
              itemName: item.name,
              qtyOrdered: line.qtyOrdered,
              unitCost: Math.round((Number(line.unitCost) || 0) * 100) / 100,
              lineTotal,
            });
          } else {
            // Create new line
            await storage.createPurchaseOrderLine({
              purchaseOrderId: id,
              itemId: line.itemId,
              sku: item.sku,
              itemName: item.name,
              qtyOrdered: line.qtyOrdered,
              unitCost: Math.round((Number(line.unitCost) || 0) * 100) / 100,
              lineTotal,
              qtyReceived: 0,
            });
          }
        }
      }

      // Recalculate totals
      const recalculated = await storage.recalculatePOTotals(id);
      const updatedLines = await storage.getPurchaseOrderLinesByPOId(id);

      res.json({ ...recalculated, lines: updatedLines });
    } catch (error: any) {
      console.error("[PurchaseOrder] Error updating purchase order:", error);
      res.status(400).json({ error: error.message || "Failed to update purchase order" });
    }
  });

  app.delete("/api/purchase-orders/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const deleted = await storage.deletePurchaseOrder(id);
      
      if (!deleted) {
        return res.status(404).json({ error: "Purchase order not found" });
      }

      res.status(204).send();
    } catch (error: any) {
      console.error("[PurchaseOrder] Error deleting purchase order:", error);
      res.status(500).json({ error: "Failed to delete purchase order" });
    }
  });

  app.post("/api/purchase-orders/:id/mark-sent", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const updated = await storage.updatePurchaseOrder(id, {
        status: 'SENT',
        sentAt: new Date(),
      });
      
      if (!updated) {
        return res.status(404).json({ error: "Purchase order not found" });
      }

      res.json(updated);
    } catch (error: any) {
      console.error("[PurchaseOrder] Error marking purchase order as sent:", error);
      res.status(500).json({ error: "Failed to mark purchase order as sent" });
    }
  });

  app.post("/api/purchase-orders/:id/mark-received", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const updated = await storage.updatePurchaseOrder(id, {
        status: 'RECEIVED',
        receivedAt: new Date(),
      });
      
      if (!updated) {
        return res.status(404).json({ error: "Purchase order not found" });
      }

      // Sync to GHL (non-blocking)
      const { triggerPOSync } = await import("./services/ghl-sync-triggers");
      triggerPOSync(req.session.userId!, id, "delivered").catch(err => {
        console.error(`[PurchaseOrder] GHL sync error:`, err.message);
      });

      res.json(updated);
    } catch (error: any) {
      console.error("[PurchaseOrder] Error marking purchase order as received:", error);
      res.status(500).json({ error: "Failed to mark purchase order as received" });
    }
  });

  app.post("/api/purchase-orders/:id/mark-paid", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const updated = await storage.updatePurchaseOrder(id, {
        paidAt: new Date(),
      });
      
      if (!updated) {
        return res.status(404).json({ error: "Purchase order not found" });
      }

      // Sync to GHL (non-blocking)
      const { triggerPOSync } = await import("./services/ghl-sync-triggers");
      triggerPOSync(req.session.userId!, id, "paid").catch(err => {
        console.error(`[PurchaseOrder] GHL sync error:`, err.message);
      });

      res.json(updated);
    } catch (error: any) {
      console.error("[PurchaseOrder] Error marking purchase order as paid:", error);
      res.status(500).json({ error: "Failed to mark purchase order as paid" });
    }
  });

  app.post("/api/purchase-orders/:id/report-issue", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { issueType, issueNotes, refundStatus, refundAmount } = req.body;
      
      const updated = await storage.updatePurchaseOrder(id, {
        hasIssue: true,
        issueStatus: 'OPEN',
        issueType,
        issueNotes,
        refundStatus: refundStatus || 'NONE',
        refundAmount: refundAmount || 0,
      });
      
      if (!updated) {
        return res.status(404).json({ error: "Purchase order not found" });
      }

      res.json(updated);
    } catch (error: any) {
      console.error("[PurchaseOrder] Error reporting issue:", error);
      res.status(500).json({ error: "Failed to report issue" });
    }
  });

  app.post("/api/purchase-order-lines", requireAuth, async (req: Request, res: Response) => {
    try {
      const lineData = req.body;
      const lineTotal = Math.round((Number(lineData.qtyOrdered) || 0) * (Number(lineData.unitCost) || 0) * 100) / 100;
      const validatedLine = insertPurchaseOrderLineSchema.parse({ ...lineData, lineTotal });
      const line = await storage.createPurchaseOrderLine(validatedLine);
      
      if (line.purchaseOrderId) {
        await storage.recalculatePOTotals(line.purchaseOrderId);
      }
      
      res.status(201).json(line);
    } catch (error: any) {
      console.error("[PurchaseOrderLine] Error creating line:", error);
      res.status(400).json({ error: error.message || "Failed to create line" });
    }
  });

  app.patch("/api/purchase-order-lines/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const existingLine = await storage.getPurchaseOrderLine(id);
      if (!existingLine) {
        return res.status(404).json({ error: "Line not found" });
      }
      
      const updateData = req.body;
      if ('qtyOrdered' in updateData || 'unitCost' in updateData) {
        const qtyOrdered = updateData.qtyOrdered ?? existingLine.qtyOrdered;
        const unitCost = updateData.unitCost ?? existingLine.unitCost;
        updateData.lineTotal = Math.round((Number(qtyOrdered) || 0) * (Number(unitCost) || 0) * 100) / 100;
      }
      
      const validatedUpdates = insertPurchaseOrderLineSchema.partial().parse(updateData);
      const updated = await storage.updatePurchaseOrderLine(id, validatedUpdates);
      
      if (!updated) {
        return res.status(404).json({ error: "Line not found" });
      }

      if (existingLine.purchaseOrderId) {
        await storage.recalculatePOTotals(existingLine.purchaseOrderId);
      }

      res.json(updated);
    } catch (error: any) {
      console.error("[PurchaseOrderLine] Error updating line:", error);
      res.status(400).json({ error: error.message || "Failed to update line" });
    }
  });

  app.delete("/api/purchase-order-lines/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const existingLine = await storage.getPurchaseOrderLine(id);
      if (!existingLine) {
        return res.status(404).json({ error: "Line not found" });
      }
      
      const purchaseOrderId = existingLine.purchaseOrderId;
      const deleted = await storage.deletePurchaseOrderLine(id);
      
      if (!deleted) {
        return res.status(404).json({ error: "Line not found" });
      }

      if (purchaseOrderId) {
        await storage.recalculatePOTotals(purchaseOrderId);
      }

      res.status(204).send();
    } catch (error: any) {
      console.error("[PurchaseOrderLine] Error deleting line:", error);
      res.status(500).json({ error: "Failed to delete line" });
    }
  });

  // ============================================================================
  // ENHANCED PURCHASE ORDER ENDPOINTS
  // ============================================================================

  // Approve PO
  app.post("/api/purchase-orders/:id/approve", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const po = await storage.getPurchaseOrder(id);
      
      if (!po) {
        return res.status(404).json({ error: "Purchase order not found" });
      }

      if (po.status !== 'APPROVAL_PENDING') {
        return res.status(409).json({ error: `Cannot approve PO in ${po.status} status` });
      }

      const updated = await storage.updatePurchaseOrder(id, {
        status: 'APPROVED',
        approvedAt: new Date(),
      });

      res.json(updated);
    } catch (error: any) {
      console.error("[PurchaseOrder] Error approving PO:", error);
      res.status(500).json({ error: "Failed to approve purchase order" });
    }
  });

  // Reject PO
  app.post("/api/purchase-orders/:id/reject", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      const po = await storage.getPurchaseOrder(id);
      
      if (!po) {
        return res.status(404).json({ error: "Purchase order not found" });
      }

      if (po.status !== 'APPROVAL_PENDING') {
        return res.status(409).json({ error: `Cannot reject PO in ${po.status} status` });
      }

      const updated = await storage.updatePurchaseOrder(id, {
        status: 'DRAFT',
        notes: `${po.notes || ''}\n\nRejected: ${reason || 'No reason provided'}`,
      });

      res.json(updated);
    } catch (error: any) {
      console.error("[PurchaseOrder] Error rejecting PO:", error);
      res.status(500).json({ error: "Failed to reject purchase order" });
    }
  });

  // Send PO (email to supplier via SendGrid + sync to GHL)
  app.post("/api/purchase-orders/:id/send", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const po = await storage.getPurchaseOrder(id);
      
      if (!po) {
        return res.status(404).json({ error: "Purchase order not found" });
      }

      // Only allow sending from DRAFT or APPROVED status
      if (!['DRAFT', 'APPROVED'].includes(po.status)) {
        if (po.status === 'SENT' || ['PARTIAL_RECEIVED', 'RECEIVED', 'CLOSED'].includes(po.status)) {
          return res.status(400).json({ 
            error: "This PO has already been sent. Use 'Resend' if you want to send it again.",
            currentStatus: po.status,
          });
        }
        return res.status(409).json({ 
          error: `Cannot send PO in ${po.status} status. Must be DRAFT or APPROVED.`,
          currentStatus: po.status,
        });
      }

      // Import email service dynamically to avoid circular dependencies
      const { purchaseOrderEmailService } = await import("./services/po-email-service");
      const { triggerPOSync } = await import("./services/ghl-sync-triggers");

      // Send the PO via email
      const emailResult = await purchaseOrderEmailService.sendPurchaseOrderEmail(id);
      
      if (!emailResult.success) {
        // Update PO with failed email status
        await storage.updatePurchaseOrder(id, {
          lastEmailStatus: 'FAILED',
          lastEmailError: emailResult.error || 'Unknown error',
        });
        
        return res.status(400).json({ 
          error: emailResult.error || "Failed to send email",
          emailStatus: 'FAILED',
        });
      }

      // Email sent successfully - update PO
      const updateData: any = {
        status: 'SENT',
        sentAt: new Date(),
        emailTo: emailResult.recipientEmail,
        emailSubject: emailResult.subject,
        emailBodyText: emailResult.bodyText,
        lastEmailStatus: 'SENT',
        lastEmailSentAt: new Date(),
        lastEmailProviderMessageId: emailResult.messageId,
        lastEmailError: null,
      };

      const updated = await storage.updatePurchaseOrder(id, updateData);
      
      console.log(`[PurchaseOrder] PO ${po.poNumber} sent via email to ${emailResult.recipientEmail}`);

      // Sync to GHL (non-blocking, log errors but don't fail the request)
      triggerPOSync(req.session.userId!, id, "sent").catch(err => {
        console.error(`[PurchaseOrder] GHL sync error for PO ${po.poNumber}:`, err.message);
      });

      res.json({
        ...updated,
        emailSent: true,
        emailTo: emailResult.recipientEmail,
      });
    } catch (error: any) {
      console.error("[PurchaseOrder] Error sending PO:", error);
      res.status(500).json({ error: "Failed to send purchase order" });
    }
  });

  // Close PO
  app.post("/api/purchase-orders/:id/close", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const po = await storage.getPurchaseOrder(id);
      
      if (!po) {
        return res.status(404).json({ error: "Purchase order not found" });
      }

      if (po.status !== 'RECEIVED') {
        return res.status(409).json({ error: `Cannot close PO in ${po.status} status. Must be RECEIVED.` });
      }

      const updated = await storage.updatePurchaseOrder(id, {
        status: 'CLOSED',
      });

      res.json(updated);
    } catch (error: any) {
      console.error("[PurchaseOrder] Error closing PO:", error);
      res.status(500).json({ error: "Failed to close purchase order" });
    }
  });

  // Cancel PO
  app.post("/api/purchase-orders/:id/cancel", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      const po = await storage.getPurchaseOrder(id);
      
      if (!po) {
        return res.status(404).json({ error: "Purchase order not found" });
      }

      if (['RECEIVED', 'CLOSED', 'CANCELLED'].includes(po.status)) {
        return res.status(409).json({ error: `Cannot cancel PO in ${po.status} status` });
      }

      const updated = await storage.updatePurchaseOrder(id, {
        status: 'CANCELLED',
        notes: `${po.notes || ''}\n\nCancelled: ${reason || 'No reason provided'}`,
      });

      res.json(updated);
    } catch (error: any) {
      console.error("[PurchaseOrder] Error cancelling PO:", error);
      res.status(500).json({ error: "Failed to cancel purchase order" });
    }
  });

  // Mark PO as accepted (internal override)
  app.post("/api/purchase-orders/:id/mark-accepted-internal", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const po = await storage.getPurchaseOrder(id);
      
      if (!po) {
        return res.status(404).json({ error: "Purchase order not found" });
      }

      if (!['NONE', 'PENDING'].includes(po.acknowledgementStatus || 'NONE')) {
        return res.status(409).json({ 
          error: `PO already has acknowledgement status: ${po.acknowledgementStatus}` 
        });
      }

      const updated = await storage.updatePurchaseOrder(id, {
        acknowledgementStatus: 'INTERNAL_CONFIRMED',
        acknowledgedAt: new Date(),
        acknowledgedSource: 'INTERNAL',
      });

      // Log the event
      await storage.createSystemLog({
        type: 'PO_INTERNAL_ACCEPTED',
        message: `PO ${po.poNumber} marked as accepted internally`,
        details: { poId: id, poNumber: po.poNumber },
        source: 'USER',
        userId: req.session.userId,
      });

      console.log(`[PurchaseOrder] PO ${po.poNumber} marked as accepted internally`);

      res.json(updated);
    } catch (error: any) {
      console.error("[PurchaseOrder] Error marking PO as accepted:", error);
      res.status(500).json({ error: "Failed to mark purchase order as accepted" });
    }
  });

  // Supplier acknowledgement via token (public endpoint - no auth)
  app.post("/api/purchase-orders/acknowledge", async (req: Request, res: Response) => {
    try {
      const { token, action } = req.body;
      
      if (!token || !action) {
        return res.status(400).json({ error: "Token and action are required" });
      }

      if (action !== 'ACCEPT') {
        return res.status(400).json({ error: "Invalid action. Only 'ACCEPT' is supported." });
      }

      // Find PO by token
      const allPOs = await storage.getAllPurchaseOrders();
      const po = allPOs.find(p => p.ackToken === token);
      
      if (!po) {
        return res.status(404).json({ error: "Invalid or expired confirmation link" });
      }

      // Check if token is expired
      if (po.ackTokenExpiresAt && new Date(po.ackTokenExpiresAt) < new Date()) {
        return res.status(410).json({ error: "Confirmation link has expired" });
      }

      // Check if already acknowledged
      if (['SUPPLIER_ACCEPTED', 'SUPPLIER_DECLINED', 'INTERNAL_CONFIRMED'].includes(po.acknowledgementStatus || '')) {
        return res.status(409).json({ 
          error: "This purchase order has already been acknowledged",
          currentStatus: po.acknowledgementStatus 
        });
      }

      // Update PO with supplier acknowledgement
      const updated = await storage.updatePurchaseOrder(po.id, {
        acknowledgementStatus: 'SUPPLIER_ACCEPTED',
        acknowledgedAt: new Date(),
        acknowledgedSource: 'SUPPLIER_LINK',
      });

      // Log the event
      await storage.createSystemLog({
        type: 'PO_SUPPLIER_ACCEPTED',
        message: `Supplier accepted PO ${po.poNumber} via confirmation link`,
        details: { poId: po.id, poNumber: po.poNumber },
        source: 'EXTERNAL',
      });

      console.log(`[PurchaseOrder] Supplier accepted PO ${po.poNumber} via confirmation link`);

      res.json({ success: true, poNumber: po.poNumber, status: 'SUPPLIER_ACCEPTED' });
    } catch (error: any) {
      console.error("[PurchaseOrder] Error processing supplier acknowledgement:", error);
      res.status(500).json({ error: "Failed to process acknowledgement" });
    }
  });

  // Get PO by ack token (public endpoint for supplier page)
  app.get("/api/purchase-orders/by-token/:token", async (req: Request, res: Response) => {
    try {
      const { token } = req.params;
      
      if (!token) {
        return res.status(400).json({ error: "Token is required" });
      }

      // Find PO by token
      const allPOs = await storage.getAllPurchaseOrders();
      const po = allPOs.find(p => p.ackToken === token);
      
      if (!po) {
        return res.status(404).json({ error: "Invalid confirmation link" });
      }

      // Check if token is expired
      if (po.ackTokenExpiresAt && new Date(po.ackTokenExpiresAt) < new Date()) {
        return res.status(410).json({ error: "Confirmation link has expired" });
      }

      // Get supplier and lines for display
      const supplier = po.supplierId ? await storage.getSupplier(po.supplierId) : null;
      const lines = await storage.getPurchaseOrderLinesByPOId(po.id);

      // Return limited info for supplier page (no sensitive internal data)
      res.json({
        poNumber: po.poNumber,
        orderDate: po.orderDate,
        expectedDate: po.expectedDate,
        supplierName: supplier?.name || po.supplierName || 'Unknown',
        buyerCompanyName: po.buyerCompanyName,
        total: po.total,
        currency: po.currency,
        acknowledgementStatus: po.acknowledgementStatus,
        lines: lines.map(line => ({
          itemName: line.itemName,
          sku: line.sku,
          qtyOrdered: line.qtyOrdered,
          unitCost: line.unitCost,
          lineTotal: line.lineTotal,
        })),
      });
    } catch (error: any) {
      console.error("[PurchaseOrder] Error fetching PO by token:", error);
      res.status(500).json({ error: "Failed to fetch purchase order" });
    }
  });

  // SendGrid event webhook (public endpoint - no auth, use webhook signature verification in production)
  app.post("/api/sendgrid/events", async (req: Request, res: Response) => {
    try {
      const events = req.body;
      
      if (!Array.isArray(events)) {
        return res.status(400).json({ error: "Invalid event format" });
      }

      console.log(`[SendGrid Webhook] Received ${events.length} events`);

      for (const event of events) {
        const poId = event.po_id || event.customArgs?.po_id;
        const messageId = event.sg_message_id;
        const eventType = event.event;
        const timestamp = event.timestamp ? new Date(event.timestamp * 1000) : new Date();

        if (!poId && !messageId) {
          console.log(`[SendGrid Webhook] Skipping event without PO identifier:`, eventType);
          continue;
        }

        // Find PO by ID or message ID
        let po = null;
        if (poId) {
          po = await storage.getPurchaseOrder(poId);
        }
        if (!po && messageId) {
          const allPOs = await storage.getAllPurchaseOrders();
          po = allPOs.find(p => p.lastEmailProviderMessageId === messageId);
        }

        if (!po) {
          console.log(`[SendGrid Webhook] PO not found for event:`, { poId, messageId, eventType });
          continue;
        }

        // Process based on event type
        const updateData: any = {
          lastEmailEventAt: timestamp,
          lastEmailEventType: eventType,
        };

        switch (eventType) {
          case 'open':
            updateData.lastEmailStatus = 'OPENED';
            console.log(`[SendGrid Webhook] PO ${po.poNumber} email opened`);
            break;
          case 'delivered':
            // Keep SENT status but update event info
            console.log(`[SendGrid Webhook] PO ${po.poNumber} email delivered`);
            break;
          case 'bounce':
          case 'dropped':
          case 'spamreport':
          case 'unsubscribe':
            updateData.lastEmailStatus = 'FAILED';
            updateData.lastEmailError = `Email ${eventType}: ${event.reason || event.status || 'Unknown reason'}`;
            console.log(`[SendGrid Webhook] PO ${po.poNumber} email failed: ${eventType}`);
            
            // Log failure event
            await storage.createSystemLog({
              type: 'PO_EMAIL_FAILED',
              message: `PO ${po.poNumber} email ${eventType}`,
              details: { poId: po.id, poNumber: po.poNumber, reason: event.reason || event.status },
              source: 'EXTERNAL',
            });
            break;
          default:
            // Log but don't update for unknown events
            console.log(`[SendGrid Webhook] PO ${po.poNumber} unknown event: ${eventType}`);
            continue;
        }

        await storage.updatePurchaseOrder(po.id, updateData);
      }

      res.status(200).send('OK');
    } catch (error: any) {
      console.error("[SendGrid Webhook] Error processing events:", error);
      // Return 200 to prevent SendGrid from retrying
      res.status(200).send('Error logged');
    }
  });

  // Alias for SendGrid webhook without /api prefix (matches SendGrid dashboard config)
  // TODO: Add SendGrid signed webhook verification for production security
  app.post("/sendgrid/events", async (req: Request, res: Response) => {
    try {
      const events = req.body;
      
      if (!Array.isArray(events)) {
        return res.status(400).json({ error: "Invalid event format" });
      }

      console.log(`[SendGrid Webhook] Received ${events.length} events at /sendgrid/events`);

      for (const event of events) {
        const poId = event.po_id || event.customArgs?.po_id;
        const messageId = event.sg_message_id;
        const eventType = event.event;
        const timestamp = event.timestamp ? new Date(event.timestamp * 1000) : new Date();

        if (!poId && !messageId) {
          console.log(`[SendGrid Webhook] Skipping event without PO identifier:`, eventType);
          continue;
        }

        let po = null;
        if (poId) {
          po = await storage.getPurchaseOrder(poId);
        }
        if (!po && messageId) {
          const allPOs = await storage.getAllPurchaseOrders();
          po = allPOs.find(p => p.lastEmailProviderMessageId === messageId);
        }

        if (!po) {
          console.log(`[SendGrid Webhook] PO not found for event:`, { poId, messageId, eventType });
          continue;
        }

        const updateData: any = {
          lastEmailEventAt: timestamp,
          lastEmailEventType: eventType,
        };

        switch (eventType) {
          case 'processed':
            updateData.lastEmailStatus = 'SENT';
            console.log(`[SendGrid Webhook] PO ${po.poNumber} email queued/processed`);
            break;
          case 'delivered':
            updateData.lastEmailStatus = 'SENT';
            console.log(`[SendGrid Webhook] PO ${po.poNumber} email delivered`);
            break;
          case 'open':
            updateData.lastEmailStatus = 'OPENED';
            console.log(`[SendGrid Webhook] PO ${po.poNumber} email opened`);
            break;
          case 'click':
            console.log(`[SendGrid Webhook] PO ${po.poNumber} link clicked`);
            break;
          case 'bounce':
          case 'dropped':
          case 'spamreport':
          case 'unsubscribe':
            updateData.lastEmailStatus = 'FAILED';
            updateData.lastEmailError = `Email ${eventType}: ${event.reason || event.status || 'Unknown reason'}`;
            console.log(`[SendGrid Webhook] PO ${po.poNumber} email failed: ${eventType}`);
            
            await storage.createSystemLog({
              type: 'PO_EMAIL_FAILED',
              message: `PO ${po.poNumber} email ${eventType}`,
              details: { poId: po.id, poNumber: po.poNumber, reason: event.reason || event.status },
              source: 'EXTERNAL',
            });
            break;
          default:
            console.log(`[SendGrid Webhook] PO ${po.poNumber} event: ${eventType}`);
            continue;
        }

        await storage.updatePurchaseOrder(po.id, updateData);
      }

      res.status(200).send('OK');
    } catch (error: any) {
      console.error("[SendGrid Webhook] Error processing events:", error);
      res.status(200).send('Error logged');
    }
  });

  // Shopify webhook endpoint - handles all webhook topics via modular handlers
  // Public endpoint - use HMAC verification for security
  app.post("/api/webhooks/shopify", async (req: Request, res: Response) => {
    try {
      const shopifyApiSecret = process.env.SHOPIFY_API_SECRET;
      
      // Verify HMAC signature if secret is configured
      if (shopifyApiSecret) {
        const hmacHeader = req.headers['x-shopify-hmac-sha256'] as string;
        if (!hmacHeader) {
          console.error("[Shopify Webhook] Missing HMAC header");
          return res.status(401).json({ error: "Missing webhook signature" });
        }
        
        const crypto = await import('crypto');
        const rawBody = (req as any).rawBody;
        if (!rawBody) {
          console.error("[Shopify Webhook] Raw body not available for HMAC verification");
          return res.status(500).json({ error: "Server configuration error" });
        }
        
        const calculatedHmac = crypto
          .createHmac('sha256', shopifyApiSecret)
          .update(rawBody)
          .digest('base64');
        
        if (calculatedHmac !== hmacHeader) {
          console.error("[Shopify Webhook] Invalid HMAC signature");
          return res.status(401).json({ error: "Invalid webhook signature" });
        }
        
        console.log("[Shopify Webhook] HMAC signature verified successfully");
      } else {
        console.warn("[Shopify Webhook] SHOPIFY_API_SECRET not configured - skipping signature verification");
      }

      const topic = req.headers['x-shopify-topic'] as string;
      const shopDomain = req.headers['x-shopify-shop-domain'] as string;
      const webhookId = req.headers['x-shopify-webhook-id'] as string;
      const payload = req.body;

      console.log(`[Shopify Webhook] Received ${topic} from ${shopDomain}`);

      // Import the modular webhook router
      const { routeWebhookToHandler } = await import('./shopify/webhook-handlers');
      const { isValidTopic } = await import('./shopify/webhooks-config');
      
      // Check if this topic is supported
      if (!topic || !isValidTopic(topic)) {
        console.log(`[Shopify Webhook] Unsupported topic: ${topic}`);
        return res.status(200).json({ message: "Topic not supported" });
      }

      // Find admin user for context
      const adminUsers = await storage.getAllUsers();
      const adminUser = adminUsers[0];
      if (!adminUser) {
        console.error("[Shopify Webhook] No admin user found for webhook context");
        return res.status(200).json({ error: "No user context available" });
      }

      const userId = adminUser.id;
      const context = { topic, shopDomain, webhookId };
      
      // Route to appropriate handler
      const result = await routeWebhookToHandler(topic, payload, context, userId);

      res.status(200).json(result);
    } catch (error: any) {
      console.error("[Shopify Webhook] Error processing webhook:", error);
      
      await logService.logShopifyWebhookError({
        topic: req.headers['x-shopify-topic'] as string,
        shopDomain: req.headers['x-shopify-shop-domain'] as string,
        externalOrderId: req.body?.id ? String(req.body.id) : undefined,
        error: error.message || 'Unknown error',
        errorDetails: { stack: error.stack },
      });
      
      // Return 200 to prevent Shopify from retrying
      res.status(200).json({ error: "Error logged", message: error.message });
    }
  });

  // Receive PO - creates RECEIVE transactions and updates quantities
  app.post("/api/purchase-orders/:id/receive", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { lineReceipts } = req.body; // Array of { lineId, qtyReceived }
      
      const po = await storage.getPurchaseOrder(id);
      if (!po) {
        return res.status(404).json({ error: "Purchase order not found" });
      }

      if (!['SENT', 'PARTIAL_RECEIVED'].includes(po.status)) {
        return res.status(409).json({ error: `Cannot receive PO in ${po.status} status` });
      }

      const allLines = await storage.getPurchaseOrderLinesByPOId(id);
      const updatedLineIds: string[] = [];
      const inventoryMovement = new InventoryMovement(storage);
      const user = await storage.getUser(req.session.userId!);

      // Process each line receipt
      for (const receipt of lineReceipts) {
        const line = allLines.find(l => l.id === receipt.lineId);
        if (!line) continue;

        const qtyToReceive = receipt.qtyReceived || 0;
        if (qtyToReceive <= 0) continue;

        const newQtyReceived = line.qtyReceived + qtyToReceive;
        if (newQtyReceived > line.qtyOrdered) {
          return res.status(400).json({ 
            error: `Cannot receive more than ordered for item ${line.itemId}` 
          });
        }

        // Update line
        await storage.updatePurchaseOrderLine(line.id, {
          qtyReceived: newQtyReceived,
        });
        updatedLineIds.push(line.id);

        // Use InventoryMovement for stock update and audit logging
        const item = await storage.getItem(line.itemId);
        if (item) {
          // PO receipts go to PIVOT warehouse for finished products
          const location = item.type === 'finished_product' ? 'PIVOT' : 'N/A';
          
          // Apply inventory movement (updates stock and logs)
          await inventoryMovement.apply({
            eventType: "PURCHASE_ORDER_RECEIVED",
            itemId: line.itemId,
            quantity: qtyToReceive,
            location: location as any,
            source: "USER",
            poId: id,
            userId: req.session.userId,
            userName: user?.email,
            notes: `Received from PO ${po.poNumber}`,
          });

          // Create RECEIVE transaction for legacy compatibility
          await storage.createInventoryTransaction({
            itemId: line.itemId,
            itemType: item.type === 'finished_product' ? 'FINISHED' : 'RAW',
            type: 'RECEIVE',
            location: location as any,
            quantity: qtyToReceive,
            notes: `Received from PO ${po.poNumber}`,
            createdBy: req.session.userId?.toString() || 'system',
          });
        }
      }

      // Check if all lines are fully received
      const updatedLines = await storage.getPurchaseOrderLinesByPOId(id);
      const allFullyReceived = updatedLines.every(l => l.qtyReceived >= l.qtyOrdered);

      const newStatus = allFullyReceived ? 'RECEIVED' : 'PARTIAL_RECEIVED';
      const updated = await storage.updatePurchaseOrder(id, {
        status: newStatus,
        receivedAt: allFullyReceived ? new Date() : po.receivedAt,
      });

      // Auto-fulfill backorders for items that received stock
      const receivedItemIds = [...new Set(
        lineReceipts
          .filter((lr: any) => lr.qtyReceived > 0)
          .map((lr: any) => {
            const line = allLines.find(l => l.id === lr.lineId);
            return line?.itemId;
          })
          .filter(Boolean)
      )] as string[];

      for (const itemId of receivedItemIds) {
        await backorderService.checkAndFulfillBackorders(itemId, 0);
      }

      // Sync to GHL if fully received (non-blocking)
      if (allFullyReceived) {
        const { triggerPOSync } = await import("./services/ghl-sync-triggers");
        triggerPOSync(req.session.userId!, id, "delivered").catch(err => {
          console.error(`[PurchaseOrder] GHL sync error:`, err.message);
        });
      }

      res.json({ ...updated, lines: updatedLines });
    } catch (error: any) {
      console.error("[PurchaseOrder] Error receiving PO:", error);
      res.status(500).json({ error: error.message || "Failed to receive purchase order" });
    }
  });

  // Confirm receipt - quick path for fully received POs
  app.post("/api/purchase-orders/:id/confirm-receipt", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
      const po = await storage.getPurchaseOrder(id);
      if (!po) {
        return res.status(404).json({ error: "Purchase order not found" });
      }

      if (po.status !== 'RECEIVED') {
        return res.status(409).json({ error: `Can only confirm receipt for POs with RECEIVED status. Current status: ${po.status}` });
      }

      const lines = await storage.getPurchaseOrderLinesByPOId(id);
      const inventoryMovement = new InventoryMovement(storage);
      const user = await storage.getUser(req.session.userId!);
      
      // Create RECEIVE transactions for any remaining unreceived quantities
      for (const line of lines) {
        const remaining = line.qtyOrdered - line.qtyReceived;
        if (remaining > 0) {
          const item = await storage.getItem(line.itemId);
          if (item) {
            // PO receipts go to PIVOT warehouse for finished products
            const location = item.type === 'finished_product' ? 'PIVOT' : 'N/A';
            
            // Apply inventory movement (updates stock and logs)
            await inventoryMovement.apply({
              eventType: "PURCHASE_ORDER_RECEIVED",
              itemId: line.itemId,
              quantity: remaining,
              location: location as any,
              source: "USER",
              poId: id,
              userId: req.session.userId,
              userName: user?.email,
              notes: `Auto-confirmed receipt from PO ${po.poNumber}`,
            });

            // Create RECEIVE transaction for legacy compatibility
            await storage.createInventoryTransaction({
              itemId: line.itemId,
              itemType: item.type === 'finished_product' ? 'FINISHED' : 'RAW',
              type: 'RECEIVE',
              location: location as any,
              quantity: remaining,
              notes: `Auto-confirmed receipt from PO ${po.poNumber}`,
              createdBy: req.session.userId?.toString() || 'system',
            });
          }

          // Update line received quantity
          await storage.updatePurchaseOrderLine(line.id, {
            qtyReceived: line.qtyOrdered,
          });
        }
        
        // Calculate and record AI recommendation outcome
        if (line.aiRecommendationId && line.recommendedQtyAtOrderTime != null && line.finalOrderedQty != null) {
          const actualReceived = line.qtyOrdered; // Total received after this confirmation
          const recommended = line.recommendedQtyAtOrderTime;
          const ordered = line.finalOrderedQty;
          
          // Only calculate outcome if we have a valid recommendation quantity
          if (recommended > 0) {
            // Determine outcome status based on ordered vs recommended
            let outcomeStatus: 'ACCURATE' | 'UNDER_ORDERED' | 'OVER_ORDERED' = 'ACCURATE';
            const variance = ((ordered - recommended) / recommended) * 100;
            
            if (Math.abs(variance) <= 10) {
              outcomeStatus = 'ACCURATE';
            } else if (ordered < recommended) {
              outcomeStatus = 'UNDER_ORDERED';
            } else {
              outcomeStatus = 'OVER_ORDERED';
            }
            
            // Update the AI recommendation with outcome
            const userDecision = ordered === recommended ? 'ACCEPTED' : (ordered > recommended ? 'INCREASED' : 'REDUCED');
            await storage.updateAIRecommendation(line.aiRecommendationId, {
              outcomeStatus,
              outcomeDetails: {
                userDecision,
                decisionNotes: ordered !== recommended ? `Ordered ${ordered} instead of recommended ${recommended}` : undefined,
                orderedQty: ordered,
                receivedQty: actualReceived,
                recommendedQty: recommended,
                variancePercent: variance,
                outcomeNotes: `Received ${actualReceived} units (${variance.toFixed(1)}% variance from recommendation)`,
              },
            });
          }
        }
      }

      // Mark as fully received
      const updated = await storage.updatePurchaseOrder(id, {
        receivedAt: new Date(),
      });

      res.json(updated);
    } catch (error: any) {
      console.error("[PurchaseOrder] Error confirming receipt:", error);
      res.status(500).json({ error: error.message || "Failed to confirm receipt" });
    }
  });

  // Toggle Dispute - Open or resolve disputes with GHL integration stub
  app.post("/api/purchase-orders/:id/toggle-dispute", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
      // Validate request body
      const toggleDisputeSchema = z.object({
        action: z.enum(['open', 'resolve']),
        reason: z.string().optional(), // Used for opening dispute
        resolutionNotes: z.string().optional(), // Used for resolving dispute
      });
      
      const { action, reason, resolutionNotes } = toggleDisputeSchema.parse(req.body);
      
      const po = await storage.getPurchaseOrder(id);
      if (!po) {
        return res.status(404).json({ error: "Purchase order not found" });
      }

      const now = new Date();
      let updateData: any = {};

      if (action === 'open') {
        updateData = {
          hasIssue: true,
          issueStatus: 'OPEN',
          issueOpenedAt: now,
          issueResolvedAt: null,
          issueNotes: reason || 'Dispute opened without specific reason',
        };

        // TODO: Integrate with GoHighLevel SMS workflow
        // This will trigger a manual SMS workflow in GHL to notify the rep
        console.log('[PurchaseOrder] Dispute opened:', {
          poId: id,
          poNumber: po.poNumber,
          supplierId: po.supplierId,
          ghlRep: po.ghlRepName || 'N/A',
          reason: reason || 'No reason provided',
          // Future: Call GHL API to send SMS to rep
        });
      } else {
        // action === 'resolve'
        // Preserve original dispute reason and append resolution notes
        const originalReason = po.issueNotes || 'No original reason provided';
        const resolutionText = resolutionNotes || 'Marked as resolved without notes';
        const combinedNotes = `Original: ${originalReason}\nResolution: ${resolutionText}`;
        
        updateData = {
          issueStatus: 'RESOLVED',
          issueResolvedAt: now,
          issueNotes: combinedNotes,
        };
        
        console.log('[PurchaseOrder] Dispute resolved:', {
          poId: id,
          poNumber: po.poNumber,
          resolutionNotes: resolutionText,
        });
      }

      await storage.updatePurchaseOrder(id, updateData);
      
      // Fetch updated PO to ensure we return latest data
      const updated = await storage.getPurchaseOrder(id);
      
      if (!updated) {
        return res.status(500).json({ error: "Failed to retrieve updated purchase order" });
      }
      
      res.json({ 
        success: true, 
        message: action === 'open' ? "Dispute opened. GHL team will be notified." : "Dispute resolved.",
        purchaseOrder: updated 
      });
    } catch (error: any) {
      console.error("[PurchaseOrder] Error toggling dispute:", error);
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: "Invalid request body", details: error.errors });
      }
      res.status(500).json({ error: error.message || "Failed to update dispute status" });
    }
  });

  // Bulk Confirm Receipt - Mark PO as fully received and create RECEIVE transactions
  // 
  // LIMITATION: This endpoint is not fully atomic at the database level. While it validates
  // all lines upfront and aborts on the first failure, if processing fails midway through
  // (e.g., line 3 fails), earlier line items (1-2) will have already been updated in inventory
  // with no automatic rollback. The PO status will remain SENT/PARTIAL_RECEIVED, making the
  // discrepancy visible. Clear error messages are returned to the UI so users can manually
  // review affected POs.
  // 
  // TODO: For perfect atomicity, implement storage-level transaction support with
  // withTransaction() wrapper. This is deferred to avoid architectural changes.
  app.post("/api/purchase-orders/:id/bulk-confirm-receipt", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
      // No request body needed, but validate empty body
      const bulkConfirmSchema = z.object({}).optional();
      bulkConfirmSchema.parse(req.body);
      
      const po = await storage.getPurchaseOrder(id);
      
      if (!po) {
        return res.status(404).json({ error: "Purchase order not found" });
      }

      // Check status - prevent double-processing
      if (po.status === 'RECEIVED') {
        return res.status(409).json({ error: "PO already fully received" });
      }

      if (!['SENT', 'PARTIAL_RECEIVED'].includes(po.status)) {
        return res.status(409).json({ error: `Cannot bulk confirm PO in ${po.status} status` });
      }

      const lines = await storage.getPurchaseOrderLinesByPOId(id);
      
      if (!lines || lines.length === 0) {
        return res.status(400).json({ error: "No line items found for this PO" });
      }
      
      // Step 1: Validate all lines can be processed (dry run)
      const linesToProcess: Array<{
        line: typeof lines[0];
        item: Item;
        itemType: 'FINISHED' | 'RAW';
        location: 'HILDALE' | 'PIVOT' | 'N/A';
        remaining: number;
      }> = [];
      
      for (const line of lines) {
        const remaining = line.qtyOrdered - line.qtyReceived;
        if (remaining > 0) {
          // Verify item exists
          const item = await storage.getItem(line.itemId);
          if (!item) {
            return res.status(400).json({ 
              success: false,
              error: `Cannot process PO: Item not found for line ${line.id}`,
            });
          }

          // Determine item type and location
          // PO receipts go to PIVOT warehouse for finished products
          const itemType = item.type === 'finished_product' ? 'FINISHED' as const : 'RAW' as const;
          const location = itemType === 'RAW' ? 'N/A' as const : 'PIVOT' as const;
          
          linesToProcess.push({
            line,
            item,
            itemType,
            location,
            remaining,
          });
        }
      }

      // If no lines to process, nothing to do
      if (linesToProcess.length === 0) {
        return res.status(400).json({
          success: false,
          error: "All line items have already been received",
        });
      }

      // Step 2: Apply all transactions atomically using InventoryMovement
      const processedLines = [];
      const inventoryMovement = new InventoryMovement(storage);
      
      for (const { line, item, itemType, location, remaining } of linesToProcess) {
        try {
          // Use InventoryMovement for centralized inventory updates and audit logging
          const result = await inventoryMovement.apply({
            eventType: "PURCHASE_ORDER_RECEIVED",
            itemId: line.itemId,
            quantity: remaining,
            location: location as any,
            source: "SYSTEM",
            poId: id,
            notes: `Bulk confirm receipt for PO ${po.poNumber}`,
          });

          if (!result.success) {
            // If any transaction fails, abort and return error
            return res.status(400).json({ 
              success: false,
              error: `Failed to receive item "${item.name}": ${result.error}`,
            });
          }
          
          // Create RECEIVE transaction for legacy compatibility
          await storage.createInventoryTransaction({
            itemId: line.itemId,
            itemType,
            type: 'RECEIVE',
            location,
            quantity: remaining,
            notes: `Bulk confirm receipt for PO ${po.poNumber}`,
            createdBy: 'system',
          });

          // Update line received quantity
          await storage.updatePurchaseOrderLine(line.id, {
            qtyReceived: line.qtyOrdered,
          });
          
          processedLines.push({
            lineId: line.id,
            itemName: item.name,
            quantityReceived: remaining,
          });
          
          console.log(`[PurchaseOrder] Received ${remaining} units of item ${item.name} for PO ${po.poNumber}`);
        } catch (lineError: any) {
          // If any error occurs, abort and return error
          console.error(`[PurchaseOrder] Error processing line ${line.id}:`, lineError);
          return res.status(500).json({ 
            success: false,
            error: `Failed to process line for item "${item.name}": ${lineError.message}`,
          });
        }
      }

      // Step 3: Only update PO status if ALL lines succeeded
      await storage.updatePurchaseOrder(id, {
        status: 'RECEIVED',
        receivedAt: new Date(),
      });

      // Auto-fulfill backorders for all items that received stock
      const receivedItemIds = [...new Set(linesToProcess.map(l => l.line.itemId))];
      for (const itemId of receivedItemIds) {
        await backorderService.checkAndFulfillBackorders(itemId, 0);
      }

      // Fetch updated PO to return latest data
      const updated = await storage.getPurchaseOrder(id);
      
      if (!updated) {
        return res.status(500).json({ error: "Failed to retrieve updated PO" });
      }

      res.json({ 
        success: true,
        message: "PO marked as fully received and inventory updated",
        purchaseOrder: updated,
        processed: processedLines,
      });
    } catch (error: any) {
      console.error("[PurchaseOrder] Error bulk confirming receipt:", error);
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: "Invalid request body", details: error.errors });
      }
      res.status(500).json({ error: error.message || "Failed to bulk confirm receipt" });
    }
  });

  // Recalculate PO status based on current line quantities
  // This endpoint fixes POs where status doesn't match the actual received quantities
  app.post("/api/purchase-orders/:id/recalculate-status", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
      const po = await storage.getPurchaseOrder(id);
      if (!po) {
        return res.status(404).json({ error: "Purchase order not found" });
      }

      // Only allow recalculation for SENT, PARTIAL_RECEIVED, or RECEIVED status
      if (!['SENT', 'PARTIAL_RECEIVED', 'RECEIVED'].includes(po.status)) {
        return res.status(409).json({ error: `Cannot recalculate status for PO in ${po.status} status` });
      }

      const lines = await storage.getPurchaseOrderLinesByPOId(id);
      if (!lines || lines.length === 0) {
        return res.status(400).json({ error: "No line items found for this PO" });
      }

      // Calculate actual status based on line quantities
      const hasAnyReceived = lines.some(l => l.qtyReceived > 0);
      const allFullyReceived = lines.every(l => l.qtyReceived >= l.qtyOrdered);

      let newStatus: string;
      if (allFullyReceived) {
        newStatus = 'RECEIVED';
      } else if (hasAnyReceived) {
        newStatus = 'PARTIAL_RECEIVED';
      } else {
        newStatus = po.status; // Keep current status if nothing received
      }

      if (newStatus !== po.status) {
        const updated = await storage.updatePurchaseOrder(id, {
          status: newStatus,
          receivedAt: newStatus === 'RECEIVED' ? (po.receivedAt || new Date()) : po.receivedAt,
        });
        console.log(`[PurchaseOrder] Recalculated status for PO ${po.poNumber}: ${po.status} -> ${newStatus}`);
        res.json({ success: true, previousStatus: po.status, newStatus, purchaseOrder: updated });
      } else {
        res.json({ success: true, message: "Status is already correct", status: po.status, purchaseOrder: po });
      }
    } catch (error: any) {
      console.error("[PurchaseOrder] Error recalculating status:", error);
      res.status(500).json({ error: error.message || "Failed to recalculate status" });
    }
  });

  // Add lines to an existing draft PO
  app.post("/api/purchase-orders/:id/lines", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { lines } = req.body; // Array of { itemId, qtyOrdered, unitCost }
      
      const po = await storage.getPurchaseOrder(id);
      if (!po) {
        return res.status(404).json({ error: "Purchase order not found" });
      }

      if (!['DRAFT', 'APPROVAL_PENDING'].includes(po.status)) {
        return res.status(409).json({ error: `Cannot add lines to PO in ${po.status} status` });
      }

      const createdLines = [];
      for (const lineData of lines) {
        const validatedLine = insertPurchaseOrderLineSchema.parse({
          ...lineData,
          purchaseOrderId: id,
        });
        const line = await storage.createPurchaseOrderLine(validatedLine);
        createdLines.push(line);
      }

      res.status(201).json(createdLines);
    } catch (error: any) {
      console.error("[PurchaseOrder] Error adding lines:", error);
      res.status(400).json({ error: error.message || "Failed to add lines to purchase order" });
    }
  });

  // Get all receipts for a PO
  app.get("/api/purchase-orders/:id/receipts", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
      const po = await storage.getPurchaseOrder(id);
      if (!po) {
        return res.status(404).json({ error: "Purchase order not found" });
      }

      const receipts = await storage.getPurchaseOrderReceiptsByPOId(id);
      
      // Fetch receipt lines for each receipt
      const receiptsWithLines = await Promise.all(
        receipts.map(async (receipt) => {
          const lines = await storage.getPurchaseOrderReceiptLinesByReceiptId(receipt.id);
          return { ...receipt, lines };
        })
      );

      res.json(receiptsWithLines);
    } catch (error: any) {
      console.error("[PurchaseOrderReceipt] Error fetching receipts:", error);
      res.status(500).json({ error: "Failed to fetch purchase order receipts" });
    }
  });

  // Get composite PO view (PO + lines + receipts)
  app.get("/api/purchase-orders/:id/composite", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
      const po = await storage.getPurchaseOrder(id);
      if (!po) {
        return res.status(404).json({ error: "Purchase order not found" });
      }

      const [lines, supplier, receipts] = await Promise.all([
        storage.getPurchaseOrderLinesByPOId(id),
        po.supplierId ? storage.getSupplier(po.supplierId) : Promise.resolve(null),
        storage.getPurchaseOrderReceiptsByPOId(id),
      ]);

      // Enrich lines with item details
      const enrichedLines = await Promise.all(
        lines.map(async (line) => {
          const item = await storage.getItem(line.itemId);
          return {
            ...line,
            item: item ? { id: item.id, name: item.name, sku: item.sku, type: item.type } : null,
          };
        })
      );

      // Enrich receipts with their lines
      const enrichedReceipts = await Promise.all(
        receipts.map(async (receipt) => {
          const receiptLines = await storage.getPurchaseOrderReceiptLinesByReceiptId(receipt.id);
          return { ...receipt, lines: receiptLines };
        })
      );

      // Compute derived display status (single source of truth)
      const totalQtyOrdered = lines.reduce((sum, l) => sum + (l.qtyOrdered || 0), 0);
      const totalQtyReceived = lines.reduce((sum, l) => sum + (l.qtyReceived || 0), 0);
      const displayStatus = derivePoDisplayStatus(
        {
          status: po.status,
          lastEmailStatus: po.lastEmailStatus,
          lastEmailSentAt: po.lastEmailSentAt,
          acknowledgementStatus: po.acknowledgementStatus,
        },
        totalQtyOrdered,
        totalQtyReceived
      );

      res.json({
        ...po,
        supplier,
        lines: enrichedLines,
        receipts: enrichedReceipts,
        displayStatus,
        totalQtyOrdered,
        totalQtyReceived,
      });
    } catch (error: any) {
      console.error("[PurchaseOrder] Error fetching composite view:", error);
      res.status(500).json({ error: "Failed to fetch purchase order details" });
    }
  });

  // Get next PO number (for preview)
  app.get("/api/purchase-orders/next-number", requireAuth, async (req: Request, res: Response) => {
    try {
      const poNumber = await storage.getNextPONumber();
      res.json({ poNumber });
    } catch (error: any) {
      console.error("[PurchaseOrder] Error getting next PO number:", error);
      res.status(500).json({ error: "Failed to get next PO number" });
    }
  });

  // Generate PDF for purchase order
  app.get("/api/purchase-orders/:id/pdf", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
      const po = await storage.getPurchaseOrder(id);
      if (!po) {
        return res.status(404).json({ error: "Purchase order not found" });
      }

      const [lines, supplier] = await Promise.all([
        storage.getPurchaseOrderLinesByPOId(id),
        po.supplierId ? storage.getSupplier(po.supplierId) : Promise.resolve(null),
      ]);

      const { poPdfService } = await import("./services/po-pdf-service");
      const pdfBuffer = await poPdfService.generatePOPdf({ po, lines, supplier });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${po.poNumber}.pdf"`);
      res.send(pdfBuffer);
    } catch (error: any) {
      console.error("[PurchaseOrder] Error generating PDF:", error);
      res.status(500).json({ error: "Failed to generate PDF" });
    }
  });

  app.get("/api/supplier-leads", requireAuth, async (req: Request, res: Response) => {
    try {
      const { status } = req.query;
      
      const leads = status 
        ? await storage.getSupplierLeadsByStatus(status as string)
        : await storage.getAllSupplierLeads();
        
      res.json(leads);
    } catch (error: any) {
      console.error("[SupplierLead] Error fetching leads:", error);
      res.status(500).json({ error: "Failed to fetch supplier leads" });
    }
  });

  app.get("/api/supplier-leads/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const lead = await storage.getSupplierLead(id);
      
      if (!lead) {
        return res.status(404).json({ error: "Supplier lead not found" });
      }

      res.json(lead);
    } catch (error: any) {
      console.error("[SupplierLead] Error fetching lead:", error);
      res.status(500).json({ error: "Failed to fetch supplier lead" });
    }
  });

  app.post("/api/supplier-leads", requireAuth, async (req: Request, res: Response) => {
    try {
      const validatedLead = insertSupplierLeadSchema.parse(req.body);
      const lead = await storage.createSupplierLead(validatedLead);
      res.status(201).json(lead);
    } catch (error: any) {
      console.error("[SupplierLead] Error creating lead:", error);
      res.status(400).json({ error: error.message || "Failed to create supplier lead" });
    }
  });

  app.patch("/api/supplier-leads/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const validatedUpdates = insertSupplierLeadSchema.partial().parse(req.body);
      
      const updated = await storage.updateSupplierLead(id, validatedUpdates);
      
      if (!updated) {
        return res.status(404).json({ error: "Supplier lead not found" });
      }

      res.json(updated);
    } catch (error: any) {
      console.error("[SupplierLead] Error updating lead:", error);
      res.status(400).json({ error: error.message || "Failed to update supplier lead" });
    }
  });

  app.delete("/api/supplier-leads/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const deleted = await storage.deleteSupplierLead(id);
      
      if (!deleted) {
        return res.status(404).json({ error: "Supplier lead not found" });
      }

      res.status(204).send();
    } catch (error: any) {
      console.error("[SupplierLead] Error deleting lead:", error);
      res.status(500).json({ error: "Failed to delete supplier lead" });
    }
  });

  app.post("/api/supplier-leads/:id/generate-outreach", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const lead = await storage.getSupplierLead(id);
      
      if (!lead) {
        return res.status(404).json({ error: "Supplier lead not found" });
      }

      const settings = await storage.getSettings(req.session.userId!);
      const provider = (settings?.llmProvider || 'chatgpt') as LLMProvider;
      const apiKey = settings?.llmApiKey || '';
      const customEndpoint = settings?.llmCustomEndpoint || undefined;

      const prompt = `You are writing an outreach email to a potential supplier. Generate a professional, concise email template to introduce our manufacturing company and express interest in partnering.

Supplier Information:
- Name: ${lead.name}
- Category: ${lead.category || 'Not specified'}
- Website: ${lead.websiteUrl || 'Not specified'}

The email should:
1. Be professional but friendly
2. Briefly introduce our company
3. Express specific interest in their products/services
4. Request pricing information and ordering details
5. Include a clear call-to-action
6. Be concise (under 200 words)

Generate only the email body text, no subject line.`;

      const result = await LLMService.askLLM({
        provider,
        apiKey,
        customEndpoint,
        taskType: "forecasting",
        payload: { prompt },
      });

      if (!result.success || !result.data) {
        return res.status(500).json({ 
          error: result.error || "Failed to generate outreach draft" 
        });
      }

      const outreachDraft = String(result.data);

      const updated = await storage.updateSupplierLead(id, {
        aiOutreachDraft: outreachDraft,
        lastContactedAt: new Date(),
      });

      res.json({ outreachDraft, lead: updated });
    } catch (error: any) {
      console.error("[SupplierLead] Error generating outreach:", error);
      res.status(500).json({ error: error.message || "Failed to generate outreach" });
    }
  });

  app.post("/api/supplier-leads/:id/convert", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { orderUrl } = req.body;
      
      const lead = await storage.getSupplierLead(id);
      
      if (!lead) {
        return res.status(404).json({ error: "Supplier lead not found" });
      }

      const supplierData = {
        name: lead.name,
        orderUrl: orderUrl || lead.websiteUrl || '',
        contactEmail: lead.contactEmail || null,
        contactPhone: lead.contactPhone || null,
        notes: lead.notes || null,
      };

      const validatedSupplier = insertSupplierSchema.parse(supplierData);
      const supplier = await storage.createSupplier(validatedSupplier);

      await storage.updateSupplierLead(id, {
        status: 'CONVERTED',
        convertedSupplierId: supplier.id,
      });

      res.status(201).json({ supplier, lead });
    } catch (error: any) {
      console.error("[SupplierLead] Error converting lead:", error);
      res.status(400).json({ error: error.message || "Failed to convert lead to supplier" });
    }
  });

  // PhantomBuster Supplier Discovery Routes (V2 placeholder - disabled in V1)
  // All PhantomBuster routes return V2 planned message - no real integration in V1
  
  // GET - Get available phantoms/agents (V2 placeholder)
  app.get("/api/suppliers/discovery/phantombuster/agents", requireAuth, async (_req: Request, res: Response) => {
    res.json({ 
      success: false, 
      agents: [],
      message: "PhantomBuster integration is planned for V2. Not available in this version." 
    });
  });

  // POST - Launch a supplier discovery job (V2 placeholder)
  app.post("/api/suppliers/discovery/phantombuster/run", requireAuth, async (_req: Request, res: Response) => {
    res.json({ 
      success: false, 
      message: "PhantomBuster integration is planned for V2. Not available in this version." 
    });
  });

  // POST - Poll for discovery results (V2 placeholder)
  app.post("/api/suppliers/discovery/phantombuster/results", requireAuth, async (_req: Request, res: Response) => {
    res.json({ 
      success: false, 
      leads: [],
      message: "PhantomBuster integration is planned for V2. Not available in this version." 
    });
  });

  // Legacy endpoint - redirect to new pattern (V2 placeholder)
  app.post("/api/supplier-leads/import-phantombuster", requireAuth, async (_req: Request, res: Response) => {
    res.json({ 
      success: false,
      message: "PhantomBuster integration is planned for V2. Not available in this version."
    });
  });

  // ============================================================================
  // RETURNS MODULE
  // ============================================================================
  // Returns are customer-initiated requests for refund/replacement.
  // GHL's support bot handles customer communication and approval.
  // This app creates structured return records, generates labels,
  // and updates inventory when returns are received.

  const labelService = createReturnLabelService();

  // Create return from sales order with label generation in one step
  // POST /api/returns/from-sales-order
  // Body: { salesOrderId, lines: [{ salesOrderLineId, qtyToReturn, reason? }], overallReason?, generateLabel? }
  // Returns: ReturnRequest with label info (labelUrl, trackingNumber, carrier)
  app.post("/api/returns/from-sales-order", requireAuth, async (req: Request, res: Response) => {
    try {
      const { salesOrderId, lines, overallReason, generateLabel = true } = req.body;

      if (!salesOrderId) {
        return res.status(400).json({ error: "salesOrderId is required" });
      }

      if (!lines || !Array.isArray(lines) || lines.length === 0) {
        return res.status(400).json({ error: "At least one line item is required" });
      }

      // Load the sales order
      const salesOrder = await storage.getSalesOrder(salesOrderId);
      if (!salesOrder) {
        return res.status(404).json({ error: "Sales order not found" });
      }

      // Load sales order lines
      const salesOrderLines = await storage.getSalesOrderLinesByOrderId(salesOrderId);
      
      // Validate each line
      const validatedLines: Array<{
        salesOrderLine: typeof salesOrderLines[0];
        qtyToReturn: number;
        reason?: string;
      }> = [];

      for (const line of lines) {
        if (!line.salesOrderLineId || !line.qtyToReturn || line.qtyToReturn <= 0) {
          return res.status(400).json({ 
            error: `Invalid line: salesOrderLineId and qtyToReturn > 0 are required` 
          });
        }

        const salesOrderLine = salesOrderLines.find(sol => sol.id === line.salesOrderLineId);
        if (!salesOrderLine) {
          return res.status(400).json({ 
            error: `Line ${line.salesOrderLineId} does not belong to this order` 
          });
        }

        const fulfilledQty = salesOrderLine.fulfilledQty || 0;
        const returnedQty = salesOrderLine.returnedQty || 0;
        const availableToReturn = fulfilledQty - returnedQty;

        if (line.qtyToReturn > availableToReturn) {
          return res.status(400).json({ 
            error: `Cannot return ${line.qtyToReturn} of ${salesOrderLine.productName || salesOrderLine.sku} - only ${availableToReturn} available` 
          });
        }

        validatedLines.push({
          salesOrderLine,
          qtyToReturn: line.qtyToReturn,
          reason: line.reason,
        });
      }

      // Parse customer shipping address from sales order
      let shippingAddress = salesOrder.shippingAddress;
      if (typeof shippingAddress === 'string') {
        try {
          shippingAddress = JSON.parse(shippingAddress);
        } catch {
          shippingAddress = null;
        }
      }

      // Create the return request
      const returnRequest = await storage.createReturnRequest({
        salesOrderId,
        orderNumber: salesOrder.orderNumber || salesOrder.externalOrderId,
        externalOrderId: salesOrder.externalOrderId,
        salesChannel: salesOrder.channel,
        source: 'Manual',
        customerName: salesOrder.customerName,
        customerEmail: salesOrder.customerEmail,
        customerPhone: salesOrder.customerPhone,
        shippingAddress: shippingAddress,
        status: 'OPEN',
        resolutionRequested: 'REFUND',
        reason: overallReason || 'Customer requested return',
        initiatedVia: 'MANUAL_UI',
        labelProvider: process.env.SHIPPO_API_KEY ? 'SHIPPO' : 'STUB',
      });

      // Create return items
      const returnItems = [];
      for (const { salesOrderLine, qtyToReturn, reason } of validatedLines) {
        // Look up inventory item by SKU if needed
        let inventoryItemId = null;
        const item = await storage.getItemBySku(salesOrderLine.sku);
        if (item) {
          inventoryItemId = item.id;
        }

        const returnItem = await storage.createReturnItem({
          returnRequestId: returnRequest.id,
          salesOrderLineId: salesOrderLine.id,
          inventoryItemId,
          sku: salesOrderLine.sku,
          productName: salesOrderLine.productName,
          unitPrice: salesOrderLine.unitPrice,
          qtyOrdered: salesOrderLine.quantity,
          qtyRequested: qtyToReturn,
          qtyApproved: qtyToReturn, // Auto-approve for manual UI returns
          itemReason: reason || null,
        });

        // Update returnedQty on the sales order line
        const newReturnedQty = (salesOrderLine.returnedQty || 0) + qtyToReturn;
        await storage.updateSalesOrderLine(salesOrderLine.id, {
          returnedQty: newReturnedQty,
        });

        returnItems.push(returnItem);
      }

      // Generate label if requested
      let labelResult = null;
      if (generateLabel) {
        try {
          // Prepare items for label service
          const itemsForLabel = await Promise.all(
            returnItems.map(async (ri) => {
              const item = ri.inventoryItemId ? await storage.getItem(ri.inventoryItemId) : null;
              return {
                sku: ri.sku,
                name: item?.name || ri.productName || ri.sku,
                quantity: ri.qtyApproved,
              };
            })
          );

          // Parse customer address for label
          const customerAddress = shippingAddress ? {
            street1: (shippingAddress as any).address1 || (shippingAddress as any).street1 || '',
            street2: (shippingAddress as any).address2 || (shippingAddress as any).street2 || '',
            city: (shippingAddress as any).city || '',
            state: (shippingAddress as any).province || (shippingAddress as any).state || '',
            zip: (shippingAddress as any).zip || (shippingAddress as any).postalCode || '',
            country: (shippingAddress as any).country || (shippingAddress as any).countryCode || 'US',
          } : undefined;

          // Generate label
          const labelResponse = await labelService.generateLabel({
            customerName: salesOrder.customerName,
            customerAddress,
            items: itemsForLabel,
          });

          // Create shipment record
          await storage.createReturnShipment({
            returnRequestId: returnRequest.id,
            carrier: labelResponse.carrier,
            trackingNumber: labelResponse.trackingNumber,
            labelUrl: labelResponse.labelUrl,
          });

          // Update return request with label info and status
          await storage.updateReturnRequest(returnRequest.id, {
            status: 'LABEL_CREATED',
            carrier: labelResponse.carrier,
            trackingNumber: labelResponse.trackingNumber,
            labelUrl: labelResponse.labelUrl,
          });

          // Create ShippoLabelLog for tracking and scanning
          const skuList = returnItems.map(ri => ri.sku).join(',');
          try {
            await storage.createShippoLabelLog({
              type: 'RETURN',
              shippoShipmentId: labelResponse.shippoShipmentId,
              shippoTransactionId: labelResponse.shippoTransactionId,
              labelUrl: labelResponse.labelUrl,
              trackingNumber: labelResponse.trackingNumber,
              carrier: labelResponse.carrier,
              serviceLevel: labelResponse.serviceLevel,
              labelCost: labelResponse.labelCost,
              labelCurrency: labelResponse.labelCurrency || 'USD',
              status: 'CREATED',
              scanCode: labelResponse.trackingNumber, // Use tracking number as scan code
              sku: returnItems.length === 1 ? returnItems[0].sku : skuList,
              salesOrderId: salesOrderId,
              returnRequestId: returnRequest.id,
              channel: salesOrder.channel,
              customerName: salesOrder.customerName,
              customerEmail: salesOrder.customerEmail,
              orderDate: salesOrder.orderDate,
            });
          } catch (logErr) {
            console.warn('[Returns] Failed to create ShippoLabelLog:', logErr);
          }

          labelResult = {
            carrier: labelResponse.carrier,
            trackingNumber: labelResponse.trackingNumber,
            labelUrl: labelResponse.labelUrl,
          };

          // Log success
          try {
            await AuditLogger.logReturnStatusChanged({
              returnId: returnRequest.id,
              returnNumber: returnRequest.rmaNumber || returnRequest.id,
              oldStatus: 'OPEN',
              newStatus: 'LABEL_CREATED',
            });
          } catch (logError) {
            console.warn('[Returns] Failed to log status change:', logError);
          }
        } catch (labelError: any) {
          console.error('[Returns] Failed to generate label:', labelError);
          // Log the error but don't fail the return creation
          await logService.log({
            type: 'SHIPPO_ERROR',
            severity: 'ERROR',
            message: `Failed to generate return label for return ${returnRequest.id}`,
            details: { returnId: returnRequest.id, error: labelError.message },
          });
          // Return is still created, just without a label
        }
      }

      // Log return creation
      try {
        const user = await storage.getUser(req.session.userId!);
        await AuditLogger.logReturnCreated({
          returnId: returnRequest.id,
          returnNumber: returnRequest.rmaNumber || returnRequest.id,
          orderId: salesOrderId,
          orderNumber: salesOrder.orderNumber || salesOrder.externalOrderId || 'N/A',
          reason: overallReason,
          userId: req.session.userId!,
          userName: user?.email,
        });
      } catch (logError) {
        console.warn('[Returns] Failed to log return creation:', logError);
      }

      // Fetch updated return request
      const updatedReturn = await storage.getReturnRequest(returnRequest.id);

      res.status(201).json({
        returnRequest: updatedReturn,
        items: returnItems,
        label: labelResult,
      });
    } catch (error: any) {
      console.error("[Returns] Error creating return from sales order:", error);
      res.status(400).json({ error: error.message || "Failed to create return" });
    }
  });

  // Create a return request
  // POST /api/returns
  // Body: { externalOrderId, salesChannel, customerName, customerEmail?, customerPhone?, ghlContactId?, resolutionRequested, reason, initiatedVia?, labelProvider?, items: [{ inventoryItemId or sku, qtyOrdered, qtyRequested, itemReason?, disposition? }] }
  // Returns: ReturnRequest with id for GHL to store
  app.post("/api/returns", requireAuth, async (req: Request, res: Response) => {
    try {
      const { items: itemsData, ...requestData } = req.body;

      // Look up SalesOrder if externalOrderId and salesChannel provided
      let salesOrderId = requestData.salesOrderId;
      if (!salesOrderId && requestData.externalOrderId && requestData.salesChannel) {
        const salesOrders = await storage.getAllSalesOrders();
        const salesOrder = salesOrders.find(
          so => so.externalOrderId === requestData.externalOrderId && 
                so.channel === requestData.salesChannel
        );
        if (salesOrder) {
          salesOrderId = salesOrder.id;
        }
      }

      // Validate return request data
      const validatedRequest = insertReturnRequestSchema.parse({
        ...requestData,
        salesOrderId: salesOrderId || null,
        initiatedVia: requestData.initiatedVia || 'MANUAL_UI',
        labelProvider: requestData.labelProvider || 'STUB',
      });
      
      // Create return request
      const returnRequest = await storage.createReturnRequest(validatedRequest);

      // Create return items
      if (!itemsData || !Array.from(itemsData).length) {
        return res.status(400).json({ error: "At least one item is required" });
      }

      const returnItems = [];
      for (const itemData of itemsData) {
        let inventoryItemId = itemData.inventoryItemId;
        
        // If SKU provided instead of ID, look up the item
        if (!inventoryItemId && itemData.sku) {
          const item = await storage.getItemBySku(itemData.sku);
          if (!item) {
            return res.status(404).json({ error: `Item with SKU ${itemData.sku} not found` });
          }
          inventoryItemId = item.id;
        }

        if (!inventoryItemId) {
          return res.status(400).json({ error: "Either inventoryItemId or sku is required for each item" });
        }

        const item = await storage.getItem(inventoryItemId);
        if (!item) {
          return res.status(404).json({ error: `Item ${inventoryItemId} not found` });
        }

        const returnItem = await storage.createReturnItem({
          returnRequestId: returnRequest.id,
          salesOrderLineId: itemData.salesOrderLineId || null,
          inventoryItemId,
          sku: item.sku,
          qtyOrdered: itemData.qtyOrdered || itemData.qtyRequested, // Required field
          qtyRequested: itemData.qtyRequested,
          qtyApproved: itemData.qtyApproved || itemData.qtyRequested, // Default: approve requested qty
          itemReason: itemData.itemReason || null,
          disposition: itemData.disposition || null,
        });

        // Increment returnedQty on the sales order line if linked
        if (itemData.salesOrderLineId) {
          const salesOrderLine = await storage.getSalesOrderLine(itemData.salesOrderLineId);
          if (salesOrderLine) {
            const newReturnedQty = (salesOrderLine.returnedQty ?? 0) + itemData.qtyRequested;
            await storage.updateSalesOrderLine(itemData.salesOrderLineId, {
              returnedQty: newReturnedQty,
            });
          }
        }

        returnItems.push(returnItem);
      }

      // Log return creation
      try {
        const user = await storage.getUser(req.session.userId!);
        await AuditLogger.logReturnCreated({
          returnId: returnRequest.id,
          returnNumber: returnRequest.externalOrderId || returnRequest.id,
          orderId: salesOrderId || '',
          orderNumber: salesOrderId || 'N/A',
          reason: requestData.reason,
          userId: req.session.userId!,
          userName: user?.email,
        });
      } catch (logError) {
        console.warn('[Returns] Failed to log return creation:', logError);
      }

      res.status(201).json({ 
        returnRequest,
        items: returnItems 
      });
    } catch (error: any) {
      console.error("[Returns] Error creating return request:", error);
      res.status(400).json({ error: error.message || "Failed to create return request" });
    }
  });

  // Issue return label for an existing request
  // POST /api/returns/:id/label
  // Returns: { trackingNumber, labelUrl } for GHL to send to customer
  app.post("/api/returns/:id/label", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const returnRequest = await storage.getReturnRequest(id);
      if (!returnRequest) {
        return res.status(404).json({ error: "Return request not found" });
      }

      // Validate that return is in an allowed state
      if (!['OPEN', 'LABEL_CREATED'].includes(returnRequest.status)) {
        return res.status(400).json({ 
          error: `Cannot issue label for return with status ${returnRequest.status}` 
        });
      }

      // Get return items for label generation
      const returnItems = await storage.getReturnItemsByRequestId(id);
      if (!returnItems.length) {
        return res.status(400).json({ error: "Return has no items" });
      }

      // Prepare items for label service
      const itemsForLabel = await Promise.all(
        returnItems.map(async (ri) => {
          const item = await storage.getItem(ri.inventoryItemId);
          return {
            sku: ri.sku,
            name: item?.name || ri.sku,
            quantity: ri.qtyApproved,
          };
        })
      );

      // Generate shipping label via stub service
      // TODO: When integrating real provider (Shippo/EasyPost), add customer address here
      const labelResponse = await labelService.generateLabel({
        customerName: returnRequest.customerName,
        items: itemsForLabel,
      });

      // Create shipment record
      await storage.createReturnShipment({
        returnRequestId: id,
        carrier: labelResponse.carrier,
        trackingNumber: labelResponse.trackingNumber,
        labelUrl: labelResponse.labelUrl,
      });

      // Update return request status
      const oldStatus = returnRequest.status;
      await storage.updateReturnRequest(id, {
        status: 'LABEL_CREATED',
      });

      // Log status change
      try {
        await AuditLogger.logReturnStatusChanged({
          returnId: id,
          returnNumber: returnRequest.externalOrderId || id,
          oldStatus: oldStatus,
          newStatus: 'LABEL_CREATED',
        });
      } catch (logError) {
        console.warn('[Returns] Failed to log status change:', logError);
      }

      res.json({
        trackingNumber: labelResponse.trackingNumber,
        labelUrl: labelResponse.labelUrl,
        carrier: labelResponse.carrier,
      });
    } catch (error: any) {
      console.error("[Returns] Error issuing label:", error);
      res.status(500).json({ error: error.message || "Failed to issue return label" });
    }
  });

  // Mark return as received
  // POST /api/returns/:id/receive
  // Body: { items: [{ returnItemId, qtyReceived, disposition }], resolutionFinal?, resolutionNotes? }
  // Updates inventory for RESTOCK items using TransactionService
  app.post("/api/returns/:id/receive", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { items: receivedItems, resolutionFinal, resolutionNotes } = req.body;
      const userId = req.session.userId!;

      const returnRequest = await storage.getReturnRequest(id);
      if (!returnRequest) {
        return res.status(404).json({ error: "Return request not found" });
      }

      if (!receivedItems || !Array.from(receivedItems).length) {
        return res.status(400).json({ error: "At least one received item is required" });
      }

      // Validate all items upfront
      const returnItems = await storage.getReturnItemsByRequestId(id);
      for (const receivedItem of receivedItems) {
        const returnItem = returnItems.find(ri => ri.id === receivedItem.returnItemId);
        if (!returnItem) {
          return res.status(404).json({ 
            error: `Return item ${receivedItem.returnItemId} not found` 
          });
        }

        if (!['RESTOCK', 'SCRAP', 'INSPECT'].includes(receivedItem.disposition)) {
          return res.status(400).json({ 
            error: `Invalid disposition: ${receivedItem.disposition}` 
          });
        }
      }

      // Process each received item using InventoryMovement for audit logging
      const restockedItemIds: string[] = [];
      const inventoryMovement = new InventoryMovement(storage);
      const user = await storage.getUser(userId);
      
      for (const receivedItem of receivedItems) {
        const returnItem = returnItems.find(ri => ri.id === receivedItem.returnItemId);
        if (!returnItem) continue;

        // Update return item with received qty and disposition
        await storage.updateReturnItem(receivedItem.returnItemId, {
          qtyReceived: receivedItem.qtyReceived,
          disposition: receivedItem.disposition,
          notes: receivedItem.notes || null,
        });

        // If disposition is RESTOCK, update inventory via InventoryMovement
        if (receivedItem.disposition === 'RESTOCK' && receivedItem.qtyReceived > 0) {
          const item = await storage.getItem(returnItem.inventoryItemId);
          if (!item) continue;

          // Use InventoryMovement for consistent inventory updates and audit logging
          // Returns ALWAYS go to HILDALE warehouse for finished products
          // InventoryMovement handles both hildaleQty AND availableForSaleQty updates
          const itemType = item.type === 'finished_product' ? 'FINISHED' : 'RAW';
          const location = item.type === 'finished_product' ? 'HILDALE' : 'N/A';
          
          // Apply inventory movement (updates stock and logs)
          const result = await inventoryMovement.apply({
            eventType: "RETURN_RECEIVED",
            itemId: item.id,
            quantity: receivedItem.qtyReceived,
            location: location as any,
            source: "USER",
            returnId: id,
            channel: returnRequest.channel,
            userId,
            userName: user?.email,
            notes: `Restocked from return ${returnRequest.externalOrderId || id}`,
          });

          if (result.success) {
            restockedItemIds.push(item.id);
            
            // Create RECEIVE transaction for legacy compatibility
            await storage.createInventoryTransaction({
              itemId: item.id,
              itemType,
              type: 'RECEIVE',
              location,
              quantity: receivedItem.qtyReceived,
              notes: `Restocked from return ${returnRequest.externalOrderId || id}`,
              createdBy: userId.toString(),
            });
            
            // NOTE: Extensiv is READ-ONLY. Returns go to HILDALE only.
            // When units are ready to sell, they must be transferred from Hildale → Pivot
            // via the existing transfer/scan workflows. Extensiv will pick up the change
            // on the next sync cycle.
            console.log(`[Returns] Restocked ${receivedItem.qtyReceived} ${item.sku} to HILDALE (Extensiv is READ-ONLY)`);
          } else {
            console.error(`[Returns] Failed to restock item ${item.sku}: ${result.error}`);
          }
        }
      }

      // Auto-fulfill backorders for items that were restocked
      for (const itemId of [...new Set(restockedItemIds)]) {
        await backorderService.checkAndFulfillBackorders(itemId, 0);
      }

      // Update return request status
      const updates: any = { status: 'RECEIVED_AT_WAREHOUSE' };
      if (resolutionNotes) {
        updates.resolutionNotes = resolutionNotes; // Store resolution notes
      }
      if (resolutionFinal) {
        updates.resolutionFinal = resolutionFinal; // Store final resolution outcome
        // Mark as completed if final resolution is provided
        updates.status = 'COMPLETED';
      }

      const updatedRequest = await storage.updateReturnRequest(id, updates);

      // Log status change
      try {
        const user = await storage.getUser(userId);
        await AuditLogger.logReturnStatusChanged({
          returnId: id,
          returnNumber: returnRequest.externalOrderId || id,
          oldStatus: returnRequest.status,
          newStatus: updates.status,
          userId: userId,
          userName: user?.email,
        });
      } catch (logError) {
        console.warn('[Returns] Failed to log status change:', logError);
      }

      // Fetch updated items
      const updatedItems = await storage.getReturnItemsByRequestId(id);

      res.json({
        returnRequest: updatedRequest,
        items: updatedItems,
      });
    } catch (error: any) {
      console.error("[Returns] Error receiving return:", error);
      res.status(500).json({ error: error.message || "Failed to receive return" });
    }
  });

  // Get return request details
  // GET /api/returns/:id
  // Returns: ReturnRequest + items + shipments
  app.get("/api/returns/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const returnRequest = await storage.getReturnRequest(id);
      if (!returnRequest) {
        return res.status(404).json({ error: "Return request not found" });
      }

      const items = await storage.getReturnItemsByRequestId(id);
      const shipments = await storage.getReturnShipmentsByRequestId(id);

      res.json({
        returnRequest,
        items,
        shipments,
      });
    } catch (error: any) {
      console.error("[Returns] Error fetching return:", error);
      res.status(500).json({ error: error.message || "Failed to fetch return" });
    }
  });

  // Track receipt printing
  // POST /api/returns/:id/print-receipt
  // Updates receiptPrintedAt (first time only) and increments receiptPrintCount
  app.post("/api/returns/:id/print-receipt", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const returnRequest = await storage.getReturnRequest(id);
      if (!returnRequest) {
        return res.status(404).json({ error: "Return request not found" });
      }

      const updates: any = {
        receiptPrintCount: (returnRequest.receiptPrintCount || 0) + 1,
      };

      // Set receiptPrintedAt only on first print
      if (!returnRequest.receiptPrintedAt) {
        updates.receiptPrintedAt = new Date();
      }

      const updated = await storage.updateReturnRequest(id, updates);
      res.json(updated);
    } catch (error: any) {
      console.error("[Returns] Error tracking receipt print:", error);
      res.status(500).json({ error: error.message || "Failed to track receipt print" });
    }
  });

  // List all return requests
  // GET /api/returns
  app.get("/api/returns", requireAuth, async (req: Request, res: Response) => {
    try {
      // Support filtering by live/historical via query params
      const { view, startDate, endDate, status, channel } = req.query as {
        view?: 'live' | 'historical' | 'all';
        startDate?: string;
        endDate?: string;
        status?: string;
        channel?: string;
      };
      
      let returnRequests: ReturnRequest[];
      
      if (view === 'historical') {
        const options: any = {};
        if (startDate) options.startDate = new Date(startDate);
        if (endDate) options.endDate = new Date(endDate);
        if (status) options.status = status;
        if (channel) options.channel = channel;
        returnRequests = await storage.getHistoricalReturnRequests(options);
      } else if (view === 'live') {
        returnRequests = await storage.getLiveReturnRequests();
      } else {
        // Default to all for backwards compatibility
        returnRequests = await storage.getAllReturnRequests();
      }
      
      res.json(returnRequests);
    } catch (error: any) {
      console.error("[Returns] Error fetching returns:", error);
      res.status(500).json({ error: error.message || "Failed to fetch returns" });
    }
  });

  // Get item IDs from pending returns (for label printing)
  // GET /api/returns/pending-item-ids
  // Returns: { itemIds: string[] } - unique inventory item IDs from pending returns
  app.get("/api/returns/pending-item-ids", requireAuth, async (req: Request, res: Response) => {
    try {
      const returnRequests = await storage.getAllReturnRequests();
      
      // Filter to only pending returns (OPEN, LABEL_CREATED, IN_TRANSIT)
      const pendingStatuses = ['OPEN', 'LABEL_CREATED', 'IN_TRANSIT'];
      const pendingReturns = returnRequests.filter(r => pendingStatuses.includes(r.status));
      
      // Collect all unique item IDs from pending returns
      const itemIds = new Set<string>();
      for (const ret of pendingReturns) {
        const items = await storage.getReturnItemsByRequestId(ret.id);
        items.forEach((item: any) => {
          if (item.inventoryItemId) {
            itemIds.add(item.inventoryItemId);
          }
        });
      }
      
      res.json({ itemIds: Array.from(itemIds) });
    } catch (error: any) {
      console.error("[Returns] Error fetching pending item IDs:", error);
      res.status(500).json({ error: error.message || "Failed to fetch pending return item IDs" });
    }
  });

  // Create return from GHL (authenticated via shared secret)
  // POST /api/returns/create-from-ghl
  // Headers: X-GHL-Secret: <shared secret>
  // Body: { externalOrderId, channel, customerName, customerEmail?, customerPhone?, ghlContactId?, shippingAddress?, resolutionRequested, reason, items: [{ sku, qtyRequested }] }
  // Returns: { returnRequest, labelUrl, trackingNumber} for GHL to send via SMS/email
  // Note: Uses rawBody to authenticate BEFORE JSON parsing to ensure 401 precedes all other errors
  app.post("/api/returns/create-from-ghl", async (req: Request, res: Response) => {
    try {
      // Authenticate FIRST using rawBody (before JSON parsing errors can occur)
      const ghlSecret = process.env.GHL_WEBHOOK_SECRET;
      const providedSecret = req.headers['x-ghl-secret'] as string;
      
      if (!ghlSecret) {
        console.error("[Returns] GHL_WEBHOOK_SECRET not configured - rejecting webhook request");
        return res.status(401).json({ error: "Webhook authentication not configured" });
      }
      
      if (!providedSecret) {
        return res.status(401).json({ error: "Unauthorized: Missing GHL secret" });
      }

      // Timing-safe comparison
      const expectedBuffer = Buffer.from(ghlSecret, 'utf-8');
      const providedBuffer = Buffer.from(providedSecret, 'utf-8');
      
      if (expectedBuffer.length !== providedBuffer.length) {
        return res.status(401).json({ error: "Unauthorized: Invalid GHL secret" });
      }

      const isValid = crypto.timingSafeEqual(expectedBuffer, providedBuffer);
      if (!isValid) {
        return res.status(401).json({ error: "Unauthorized: Invalid GHL secret" });
      }

      // Authentication successful - NOW validate and parse body
      if (!req.body || typeof req.body !== 'object') {
        return res.status(400).json({ error: "Invalid request body" });
      }

      const { items: itemsData, ...requestData } = req.body;
      
      if (!itemsData || !Array.isArray(itemsData) || itemsData.length === 0) {
        return res.status(400).json({ error: "At least one item is required" });
      }

      // Look up SalesOrder if externalOrderId and channel provided
      let salesOrderId = requestData.salesOrderId;
      let orderNumber = null;
      if (!salesOrderId && requestData.externalOrderId && requestData.channel) {
        const salesOrders = await storage.getAllSalesOrders();
        const salesOrder = salesOrders.find(
          so => so.externalOrderId === requestData.externalOrderId && 
                so.channel === requestData.channel
        );
        if (salesOrder) {
          salesOrderId = salesOrder.id;
          orderNumber = salesOrder.orderNumber;
        }
      }

      // Validate return request data
      const validatedRequest = insertReturnRequestSchema.parse({
        ...requestData,
        salesOrderId: salesOrderId || null,
        orderNumber: orderNumber,
        salesChannel: requestData.channel,
        source: 'GHL',
        initiatedVia: 'GHL_BOT',
      });

      const returnRequest = await storage.createReturnRequest(validatedRequest);
      const returnItems: ReturnItem[] = [];

      // Create return items
      for (const itemData of itemsData) {
        let inventoryItem: Item | undefined;
        
        // Find item by SKU
        if (itemData.sku) {
          inventoryItem = await storage.getItemBySku(itemData.sku);
        } else if (itemData.inventoryItemId) {
          inventoryItem = await storage.getItem(itemData.inventoryItemId);
        }

        if (!inventoryItem) {
          throw new Error(`Item not found: ${itemData.sku || itemData.inventoryItemId}`);
        }

        const returnItem = await storage.createReturnItem({
          returnRequestId: returnRequest.id,
          salesOrderLineId: itemData.salesOrderLineId || null,
          inventoryItemId: inventoryItem.id,
          sku: inventoryItem.sku,
          qtyOrdered: itemData.qtyOrdered || itemData.qtyRequested,
          qtyRequested: itemData.qtyRequested,
          qtyApproved: itemData.qtyApproved || itemData.qtyRequested,
          itemReason: itemData.itemReason || null,
          disposition: itemData.disposition || null,
        });

        returnItems.push(returnItem);
      }

      // Automatically generate shipping label if address is provided
      let labelUrl = null;
      let trackingNumber = null;

      if (requestData.shippingAddress) {
        try {
          const itemsForLabel = returnItems.map(ri => ({
            sku: ri.sku,
            name: ri.sku,
            quantity: ri.qtyApproved,
          }));

          const labelResponse = await labelService.generateLabel({
            customerName: returnRequest.customerName,
            customerAddress: requestData.shippingAddress,
            items: itemsForLabel,
          });

          // Create shipment record
          await storage.createReturnShipment({
            returnRequestId: returnRequest.id,
            carrier: labelResponse.carrier,
            trackingNumber: labelResponse.trackingNumber,
            labelUrl: labelResponse.labelUrl,
          });

          // Update return request status
          await storage.updateReturnRequest(returnRequest.id, {
            status: 'LABEL_CREATED',
            labelProvider: 'SHIPPO',
          });

          labelUrl = labelResponse.labelUrl;
          trackingNumber = labelResponse.trackingNumber;
        } catch (labelError: any) {
          console.error("[Returns] Failed to generate label for GHL return:", labelError);
          // Continue without label - GHL can retry later
        }
      }

      res.status(201).json({ 
        returnRequest,
        items: returnItems,
        labelUrl,
        trackingNumber,
      });
    } catch (error: any) {
      console.error("[Returns] Error creating return from GHL:", error);
      res.status(400).json({ error: error.message || "Failed to create return from GHL" });
    }
  });

  // Submit return request via ReturnsService (with auto-approval and label generation)
  // POST /api/returns/request
  const requestReturnSchema = z.object({
    customerId: z.string().optional(),
    customerName: z.string().min(1, "Customer name is required"),
    customerEmail: z.string().email().optional(),
    customerPhone: z.string().optional(),
    channel: z.string().min(1, "Channel is required"),
    orderId: z.string().min(1, "Order ID is required"),
    externalOrderId: z.string().optional(),
    items: z.array(z.object({
      sku: z.string().min(1, "SKU is required"),
      productName: z.string().optional(),
      quantity: z.number().int().positive("Quantity must be positive"),
      unitPrice: z.number().optional(),
      orderLineId: z.string().optional(),
    })).min(1, "At least one item is required"),
    reasonCode: z.string().optional(),
    reasonText: z.string().optional(),
    desiredResolution: z.enum(['REFUND', 'REPLACEMENT', 'EXCHANGE', 'STORE_CREDIT']).optional(),
    shippingAddress: z.any().optional(),
    ghlContactId: z.string().optional(),
    source: z.string().optional(),
  });

  app.post("/api/returns/request", requireAuth, async (req: Request, res: Response) => {
    try {
      const validatedData = requestReturnSchema.parse(req.body);
      const result = await returnsService.requestReturn(validatedData);
      
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }
      
      res.status(201).json(result);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: "Validation error", details: error.errors });
      }
      console.error("[Returns] Error submitting return request:", error);
      res.status(500).json({ error: error.message || "Failed to submit return request" });
    }
  });

  // Create return label via Shippo
  // POST /api/returns/:id/create-label
  app.post("/api/returns/:id/create-label", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
      const result = await returnsService.createReturnLabel(id);
      
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }
      
      res.json(result);
    } catch (error: any) {
      console.error("[Returns] Error creating return label:", error);
      res.status(500).json({ error: error.message || "Failed to create return label" });
    }
  });

  // Mark return as refund pending (creates GHL opportunity)
  // POST /api/returns/:id/mark-refund-pending
  app.post("/api/returns/:id/mark-refund-pending", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
      const success = await returnsService.markRefundIssuePending(id);
      
      if (!success) {
        return res.status(400).json({ error: "Cannot mark refund pending from current status" });
      }
      
      // Sync to GHL (non-blocking)
      const { triggerReturnSync } = await import("./services/ghl-sync-triggers");
      triggerReturnSync(req.session.userId!, id, false).catch(err => {
        console.error(`[Returns] GHL sync error:`, err.message);
      });
      
      const returnDetails = await returnsService.getReturnWithDetails(id);
      res.json(returnDetails);
    } catch (error: any) {
      console.error("[Returns] Error marking refund pending:", error);
      res.status(500).json({ error: error.message || "Failed to mark refund pending" });
    }
  });

  // Mark return refund as completed
  // POST /api/returns/:id/mark-refund-completed
  // Automatically posts to QuickBooks if configured
  app.post("/api/returns/:id/mark-refund-completed", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { refundAmount, skipQuickBooks } = req.body;
      const userId = req.session.userId!;
      
      const success = await returnsService.markRefundCompleted(id, refundAmount);
      
      if (!success) {
        return res.status(400).json({ error: "Cannot mark refund completed from current status" });
      }
      
      // Sync to GHL as refunded (non-blocking)
      const { triggerReturnSync } = await import("./services/ghl-sync-triggers");
      triggerReturnSync(userId, id, true).catch(err => {
        console.error(`[Returns] GHL sync error:`, err.message);
      });
      
      // Automatically post to QuickBooks if configured and not already posted
      let quickbooksResult = null;
      if (!skipQuickBooks) {
        try {
          const { QuickBooksClient, isQuickBooksConfigured } = await import("./services/quickbooks-client");
          
          if (isQuickBooksConfigured()) {
            const returnRequest = await storage.getReturnRequest(id);
            
            // Only post if not already posted
            if (returnRequest && !returnRequest.quickbooksRefundId) {
              const returnItems = await storage.getReturnItemsByRequestId(id);
              
              if (returnItems.length > 0) {
                // Build item map for price lookup
                const itemSkus = returnItems.map(ri => ri.sku);
                const allItems = await storage.getAllItems();
                const itemMap = new Map<string, { id: string; sku: string; name: string; price?: number | null }>();
                
                for (const item of allItems) {
                  if (itemSkus.includes(item.sku)) {
                    itemMap.set(item.sku, {
                      id: item.id,
                      sku: item.sku,
                      name: item.name,
                      price: item.price,
                    });
                  }
                }
                
                // Create QuickBooks client and post refund
                const qbClient = new QuickBooksClient(storage, userId);
                const result = await qbClient.createRefundFromReturn(
                  {
                    id: returnRequest.id,
                    rmaNumber: returnRequest.rmaNumber,
                    customerName: returnRequest.customerName,
                    customerEmail: returnRequest.customerEmail,
                    externalOrderId: returnRequest.externalOrderId,
                    salesChannel: returnRequest.salesChannel,
                  },
                  returnItems.map(ri => ({
                    sku: ri.sku,
                    quantityReturned: ri.qtyReturned || 0,
                    reason: ri.reason,
                  })),
                  itemMap
                );
                
                if (result.success) {
                  // Update return request with QB refund info
                  await storage.updateReturnRequest(id, {
                    quickbooksRefundId: result.refundId,
                    quickbooksRefundType: result.refundType,
                    quickbooksRefundCreatedAt: new Date(),
                  });
                  
                  quickbooksResult = {
                    success: true,
                    refundId: result.refundId,
                    refundNumber: result.refundNumber,
                    refundType: result.refundType,
                    totalAmount: result.totalAmount,
                  };
                  
                  console.log(`[Returns] Auto-posted refund to QuickBooks: ${result.refundId}`);
                } else {
                  console.error(`[Returns] QuickBooks refund failed:`, result.error);
                  quickbooksResult = { success: false, error: result.error };
                }
              }
            }
          }
        } catch (qbError: any) {
          console.error(`[Returns] QuickBooks auto-post error:`, qbError.message);
          quickbooksResult = { success: false, error: qbError.message };
        }
      }
      
      const returnDetails = await returnsService.getReturnWithDetails(id);
      res.json({
        ...returnDetails,
        quickbooksPostResult: quickbooksResult
      });
    } catch (error: any) {
      console.error("[Returns] Error marking refund completed:", error);
      res.status(500).json({ error: error.message || "Failed to mark refund completed" });
    }
  });

  // Close return
  // POST /api/returns/:id/close
  app.post("/api/returns/:id/close", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
      const success = await returnsService.closeReturn(id);
      
      if (!success) {
        return res.status(400).json({ error: "Cannot close return from current status" });
      }
      
      const returnDetails = await returnsService.getReturnWithDetails(id);
      res.json(returnDetails);
    } catch (error: any) {
      console.error("[Returns] Error closing return:", error);
      res.status(500).json({ error: error.message || "Failed to close return" });
    }
  });

  // Post refund to QuickBooks (create Credit Memo)
  // POST /api/returns/:id/post-to-quickbooks
  app.post("/api/returns/:id/post-to-quickbooks", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const userId = req.session.userId!;
      
      // Check if QuickBooks is configured
      const { QuickBooksClient, isQuickBooksConfigured } = await import("./services/quickbooks-client");
      if (!isQuickBooksConfigured()) {
        return res.status(400).json({ error: "QuickBooks is not configured. Please set up QuickBooks integration first." });
      }
      
      // Get return request
      const returnRequest = await storage.getReturnRequest(id);
      if (!returnRequest) {
        return res.status(404).json({ error: "Return request not found" });
      }
      
      // Check if already posted to QB
      if (returnRequest.quickbooksRefundId) {
        return res.status(400).json({ 
          error: "Return already posted to QuickBooks",
          quickbooksRefundId: returnRequest.quickbooksRefundId,
          quickbooksRefundType: returnRequest.quickbooksRefundType
        });
      }
      
      // Get return items
      const returnItems = await storage.getReturnItemsByRequestId(id);
      if (returnItems.length === 0) {
        return res.status(400).json({ error: "No items found for this return" });
      }
      
      // Build item map for price lookup
      const itemSkus = returnItems.map(ri => ri.sku);
      const allItems = await storage.getAllItems();
      const itemMap = new Map<string, { id: string; sku: string; name: string; price?: number | null }>();
      
      for (const item of allItems) {
        if (itemSkus.includes(item.sku)) {
          itemMap.set(item.sku, {
            id: item.id,
            sku: item.sku,
            name: item.name,
            price: item.price,
          });
        }
      }
      
      // Create QuickBooks client and post refund
      const qbClient = new QuickBooksClient(storage, userId);
      const result = await qbClient.createRefundFromReturn(
        {
          id: returnRequest.id,
          rmaNumber: returnRequest.rmaNumber,
          customerName: returnRequest.customerName,
          customerEmail: returnRequest.customerEmail,
          externalOrderId: returnRequest.externalOrderId,
          salesChannel: returnRequest.salesChannel,
        },
        returnItems.map(ri => ({
          sku: ri.sku,
          quantityReturned: ri.qtyReturned || 0,
          reason: ri.reason,
        })),
        itemMap
      );
      
      if (!result.success) {
        return res.status(400).json({ error: result.error || "Failed to create QuickBooks refund" });
      }
      
      // Update return request with QB refund info
      await storage.updateReturnRequest(id, {
        quickbooksRefundId: result.refundId,
        quickbooksRefundType: result.refundType,
        quickbooksRefundCreatedAt: new Date(),
      });
      
      // Get updated return details
      const returnDetails = await returnsService.getReturnWithDetails(id);
      
      res.json({
        success: true,
        quickbooksRefundId: result.refundId,
        quickbooksRefundNumber: result.refundNumber,
        quickbooksRefundType: result.refundType,
        totalAmount: result.totalAmount,
        return: returnDetails,
      });
    } catch (error: any) {
      console.error("[Returns] Error posting to QuickBooks:", error);
      res.status(500).json({ error: error.message || "Failed to post refund to QuickBooks" });
    }
  });

  // Get return events (audit log)
  // GET /api/returns/:id/events
  app.get("/api/returns/:id/events", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
      const events = await storage.getReturnEventsByRequestId(id);
      res.json(events);
    } catch (error: any) {
      console.error("[Returns] Error fetching return events:", error);
      res.status(500).json({ error: error.message || "Failed to fetch return events" });
    }
  });

  // Get return details with full info
  // GET /api/returns/:id/details
  app.get("/api/returns/:id/details", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
      const details = await returnsService.getReturnWithDetails(id);
      
      if (!details) {
        return res.status(404).json({ error: "Return not found" });
      }
      
      res.json(details);
    } catch (error: any) {
      console.error("[Returns] Error fetching return details:", error);
      res.status(500).json({ error: error.message || "Failed to fetch return details" });
    }
  });

  // ============================================================================
  // SALES ORDERS & BACKORDERS
  // ============================================================================

  // Get all sales orders with summary info
  // GET /api/sales-orders
  app.get("/api/sales-orders", requireAuth, async (req: Request, res: Response) => {
    try {
      // Support filtering by live/historical via query params
      const { view, startDate, endDate, status, channel } = req.query as {
        view?: 'live' | 'historical' | 'all';
        startDate?: string;
        endDate?: string;
        status?: string;
        channel?: string;
      };
      
      let orders: SalesOrder[];
      
      if (view === 'historical') {
        const options: any = {};
        if (startDate) options.startDate = new Date(startDate);
        if (endDate) options.endDate = new Date(endDate);
        if (status) options.status = status;
        if (channel) options.channel = channel;
        orders = await storage.getHistoricalSalesOrders(options);
      } else if (view === 'live') {
        orders = await storage.getLiveSalesOrders();
      } else {
        // Default to all for backwards compatibility
        orders = await storage.getAllSalesOrders();
      }
      
      // Enhance with line counts, total units, and totalBackorderQty
      const ordersWithSummary = await Promise.all(
        orders.map(async (order) => {
          const lines = await storage.getSalesOrderLines(order.id);
          const linesCount = lines.length;
          const totalUnits = lines.reduce((sum: number, line: SalesOrderLine) => sum + line.qtyOrdered, 0);
          const totalBackorderQty = lines.reduce((sum: number, line: SalesOrderLine) => sum + (line.backorderQty || 0), 0);
          
          return {
            ...order,
            linesCount,
            totalUnits,
            totalBackorderQty,
          };
        })
      );

      // Sort by orderDate DESC
      ordersWithSummary.sort((a, b) => 
        new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime()
      );

      res.json(ordersWithSummary);
    } catch (error: any) {
      console.error("[Sales Orders] Error fetching sales orders:", error);
      res.status(500).json({ error: error.message || "Failed to fetch sales orders" });
    }
  });

  // Get single sales order with all details
  // GET /api/sales-orders/:id
  app.get("/api/sales-orders/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const order = await storage.getSalesOrder(id);
      if (!order) {
        return res.status(404).json({ error: "Sales order not found" });
      }

      const lines = await storage.getSalesOrderLines(id);
      const totalBackorderQty = lines.reduce((sum: number, line: SalesOrderLine) => sum + (line.backorderQty || 0), 0);

      res.json({
        ...order,
        lines,
        totalBackorderQty,
      });
    } catch (error: any) {
      console.error("[Sales Orders] Error fetching sales order:", error);
      res.status(500).json({ error: error.message || "Failed to fetch sales order" });
    }
  });

  // Create new sales order with lines and allocation logic
  // POST /api/sales-orders
  app.post("/api/sales-orders", requireAuth, async (req: Request, res: Response) => {
    try {
      const { order: orderData, lines: linesData } = req.body;

      // Validate order data
      const validatedOrder = insertSalesOrderSchema.parse(orderData);

      // Validate lines data
      if (!Array.isArray(linesData) || linesData.length === 0) {
        return res.status(400).json({ error: "At least one order line is required" });
      }

      const validatedLines = linesData.map((line: any) => 
        insertSalesOrderLineSchema.parse(line)
      );

      // Create order first
      const createdOrder = await storage.createSalesOrder(validatedOrder);

      // Process each line with allocation logic
      const createdLines = [];
      const affectedProductIds = new Set<string>();

      for (const lineData of validatedLines) {
        // Get product to verify it exists and get current stock
        const product = await storage.getItem(lineData.productId);
        if (!product) {
          return res.status(400).json({ 
            error: `Product not found: ${lineData.productId}` 
          });
        }

        // Calculate available stock (hildaleQty + pivotQty for finished products)
        const availableStock = (product.hildaleQty ?? 0) + (product.pivotQty ?? 0);

        // Set qtyAllocated = min(qtyOrdered, availableStock)
        const qtyAllocated = Math.min(lineData.qtyOrdered, availableStock);

        // Set backorderQty = max(0, qtyOrdered - qtyAllocated)
        const backorderQty = Math.max(0, lineData.qtyOrdered - qtyAllocated);

        // Create line with calculated values
        const line = await storage.createSalesOrderLine({
          ...lineData,
          salesOrderId: createdOrder.id,
          qtyAllocated,
          backorderQty,
          qtyShipped: 0,
        });

        createdLines.push(line);
        affectedProductIds.add(lineData.productId);
      }

      // Refresh backorder snapshots and forecast context for all affected products
      for (const productId of Array.from(affectedProductIds)) {
        await storage.refreshBackorderSnapshot(productId);
        await storage.refreshProductForecastContext(productId);
      }

      // Log SALES_ORDER_CREATED events for each line and update availableForSaleQty for Pivot-fulfilled orders
      const inventoryMovement = new InventoryMovement(storage);
      const user = await storage.getUser(req.session.userId!);
      const isPivotOrder = validatedOrder.channel === 'SHOPIFY' || validatedOrder.channel === 'AMAZON';
      
      for (const line of createdLines) {
        await inventoryMovement.apply({
          eventType: "SALES_ORDER_CREATED",
          itemId: line.productId,
          quantity: line.qtyOrdered,
          location: isPivotOrder ? "PIVOT" : "HILDALE",
          source: "USER",
          orderId: createdOrder.id,
          salesOrderLineId: line.id,
          channel: validatedOrder.channel,
          userId: req.session.userId,
          userName: user?.email,
          notes: `Order ${createdOrder.externalOrderId || createdOrder.id}: ${line.qtyAllocated} allocated, ${line.backorderQty} backordered`,
        });
      }

      // Calculate total backorder and components used from BOM
      let totalBackorderQty = 0;
      let componentsUsed = 0;
      
      for (const line of createdLines) {
        totalBackorderQty += line.backorderQty;
        
        // Calculate components consumed based on qtyAllocated (fulfilled from stock)
        const qtyFulfilledFromStock = line.qtyAllocated;
        if (qtyFulfilledFromStock > 0) {
          const bomEntries = await storage.getBillOfMaterialsByProductId(line.productId);
          for (const bom of bomEntries) {
            componentsUsed += bom.quantityRequired * qtyFulfilledFromStock;
          }
        }
      }

      // Set production status: 'ready' if no backorder, 'alerted' if any backorder
      const productionStatus = totalBackorderQty > 0 ? 'alerted' : 'ready';

      // Update order with computed values
      const updatedOrder = await storage.updateSalesOrder(createdOrder.id, {
        componentsUsed,
        productionStatus,
      });

      res.status(201).json({
        ...updatedOrder,
        lines: createdLines,
      });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: "Validation error", details: error.errors });
      }
      console.error("[Sales Orders] Error creating sales order:", error);
      res.status(500).json({ error: error.message || "Failed to create sales order" });
    }
  });

  // Update sales order metadata only
  // PATCH /api/sales-orders/:id
  app.patch("/api/sales-orders/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      // Validate using partial schema
      const validatedData = updateSalesOrderSchema.partial().parse(req.body);

      const updatedOrder = await storage.updateSalesOrder(id, validatedData);
      if (!updatedOrder) {
        return res.status(404).json({ error: "Sales order not found" });
      }

      res.json(updatedOrder);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: "Validation error", details: error.errors });
      }
      console.error("[Sales Orders] Error updating sales order:", error);
      res.status(500).json({ error: error.message || "Failed to update sales order" });
    }
  });

  // Delete sales order
  // DELETE /api/sales-orders/:id
  app.delete("/api/sales-orders/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      // Get order to check channel for availableForSaleQty restoration
      const order = await storage.getSalesOrder(id);
      if (!order) {
        return res.status(404).json({ error: "Sales order not found" });
      }

      // Get lines to restore inventory and refresh products
      const lines = await storage.getSalesOrderLines(id);
      const affectedProductIds = new Set(lines.map((line: SalesOrderLine) => line.productId));

      // Restore availableForSaleQty for Pivot-fulfilled orders (Shopify/Amazon)
      // This mirrors the cancel logic to ensure stock is restored when orders are deleted
      const isPivotOrder = order.channel === 'SHOPIFY' || order.channel === 'AMAZON';
      if (isPivotOrder) {
        const inventoryMovement = new InventoryMovement(storage);
        const user = await storage.getUser(req.session.userId!);

        for (const line of lines) {
          // Only restore if order hasn't been fulfilled/shipped yet
          const unfulfilledQty = line.qtyOrdered - (line.qtyFulfilled ?? 0);
          if (unfulfilledQty > 0) {
            await inventoryMovement.apply({
              eventType: "SALES_ORDER_CANCELLED",
              itemId: line.productId,
              quantity: unfulfilledQty,
              location: "PIVOT",
              source: "USER",
              orderId: id,
              salesOrderLineId: line.id,
              channel: order.channel,
              userId: req.session.userId,
              userName: user?.email,
              notes: `Order ${order.externalOrderId || order.id} deleted: restored ${unfulfilledQty} to availableForSaleQty`,
            });
          }
        }
      }

      // Delete order (cascade will delete lines)
      const success = await storage.deleteSalesOrder(id);
      if (!success) {
        return res.status(404).json({ error: "Sales order not found" });
      }

      // Refresh backorder snapshots and forecast context for all affected products
      for (const productId of Array.from(affectedProductIds)) {
        await storage.refreshBackorderSnapshot(productId);
        await storage.refreshProductForecastContext(productId);
      }

      res.status(204).send();
    } catch (error: any) {
      console.error("[Sales Orders] Error deleting sales order:", error);
      res.status(500).json({ error: error.message || "Failed to delete sales order" });
    }
  });

  // Ship allocated quantities and update stock
  // POST /api/sales-orders/:id/ship
  app.post("/api/sales-orders/:id/ship", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { lineIds } = req.body;

      const order = await storage.getSalesOrder(id);
      if (!order) {
        return res.status(404).json({ error: "Sales order not found" });
      }

      // Get all lines for this order
      const allLines = await storage.getSalesOrderLines(id);

      // Determine which lines to ship
      const linesToShip = lineIds && Array.isArray(lineIds)
        ? allLines.filter((line: SalesOrderLine) => lineIds.includes(line.id))
        : allLines.filter((line: SalesOrderLine) => line.qtyAllocated > 0);

      if (linesToShip.length === 0) {
        return res.status(400).json({ error: "No lines available to ship" });
      }

      const affectedProductIds = new Set<string>();
      const inventoryMovement = new InventoryMovement(storage);
      const userId = req.session.userId!;
      const user = await storage.getUser(userId);

      // Process each line being shipped
      for (const line of linesToShip) {
        const shipQty = line.qtyAllocated;
        if (shipQty <= 0) continue;

        // Get current product data
        const product = await storage.getItem(line.productId);
        if (!product) {
          return res.status(400).json({ 
            error: `Product not found: ${line.productId}` 
          });
        }

        // Determine which warehouse to ship from (prioritize Pivot, then Hildale)
        let location: 'PIVOT' | 'HILDALE';
        if ((product.pivotQty ?? 0) >= shipQty) {
          location = 'PIVOT';
        } else if ((product.hildaleQty ?? 0) >= shipQty) {
          location = 'HILDALE';
        } else {
          // Not enough stock in either location
          return res.status(400).json({ 
            error: `Insufficient stock to ship line ${line.sku}` 
          });
        }

        // Use InventoryMovement helper to update stock and log the movement
        const result = await inventoryMovement.apply({
          eventType: "SALES_ORDER_SHIPPED",
          itemId: product.id,
          quantity: shipQty,
          location,
          source: "USER",
          orderId: order.id,
          salesOrderLineId: line.id,
          channel: order.channel,
          userId,
          userName: user?.email,
          notes: `Ship order ${order.externalOrderId || order.id} line ${line.sku}`,
        });

        if (!result.success) {
          return res.status(400).json({ error: result.error });
        }

        // Create SHIP transaction for legacy compatibility
        await storage.createInventoryTransaction({
          itemId: product.id,
          itemType: 'FINISHED',
          type: 'SHIP',
          quantity: shipQty,
          location,
          notes: `Ship order ${order.externalOrderId || order.id} line ${line.sku}`,
          createdBy: userId.toString(),
        });

        // Update line: qtyShipped += shipQty, qtyFulfilled = qtyShipped, qtyAllocated = 0, recalculate backorderQty
        const newQtyShipped = line.qtyShipped + shipQty;
        const newQtyFulfilled = newQtyShipped; // Fulfilled qty equals shipped qty
        const newBackorderQty = line.qtyOrdered - newQtyShipped;

        await storage.updateSalesOrderLine(line.id, {
          qtyShipped: newQtyShipped,
          qtyFulfilled: newQtyFulfilled,
          qtyAllocated: 0,
          backorderQty: newBackorderQty,
        });

        affectedProductIds.add(line.productId);
      }

      // Refresh backorder snapshots and forecast context for affected products
      for (const productId of Array.from(affectedProductIds)) {
        await storage.refreshBackorderSnapshot(productId);
        await storage.refreshProductForecastContext(productId);
      }

      // Determine order status
      const updatedLines = await storage.getSalesOrderLines(id);
      const allFulfilled = updatedLines.every((line: SalesOrderLine) => line.qtyShipped >= line.qtyOrdered);
      const anyShipped = updatedLines.some((line: SalesOrderLine) => line.qtyShipped > 0);

      let newStatus = order.status;
      if (allFulfilled) {
        newStatus = 'FULFILLED';
      } else if (anyShipped) {
        newStatus = 'PARTIALLY_FULFILLED';
      }

      // Update order status if needed
      if (newStatus !== order.status) {
        await storage.updateSalesOrder(id, { status: newStatus });
      }

      // Return updated order with lines
      const updatedOrder = await storage.getSalesOrder(id);
      res.json({
        ...updatedOrder,
        lines: updatedLines,
      });
    } catch (error: any) {
      console.error("[Sales Orders] Error shipping sales order:", error);
      res.status(500).json({ error: error.message || "Failed to ship sales order" });
    }
  });

  // Mark order as fulfilled
  // POST /api/sales-orders/:id/fulfill
  app.post("/api/sales-orders/:id/fulfill", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const order = await storage.getSalesOrder(id);
      if (!order) {
        return res.status(404).json({ error: "Sales order not found" });
      }

      // Get all lines for this order
      const lines = await storage.getSalesOrderLines(id);

      // Update each line to mark all ordered quantities as fulfilled (without shipping)
      for (const line of lines) {
        await storage.updateSalesOrderLine(line.id, {
          qtyFulfilled: line.qtyOrdered,
        });
      }

      // Update order status to FULFILLED
      const updatedOrder = await storage.updateSalesOrder(id, { 
        status: 'FULFILLED' 
      });

      // Return updated order with lines
      const updatedLines = await storage.getSalesOrderLines(id);
      res.json({
        ...updatedOrder,
        lines: updatedLines,
      });
    } catch (error: any) {
      console.error("[Sales Orders] Error fulfilling sales order:", error);
      res.status(500).json({ error: error.message || "Failed to fulfill sales order" });
    }
  });

  // Cancel sales order
  // POST /api/sales-orders/:id/cancel
  app.post("/api/sales-orders/:id/cancel", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const order = await storage.getSalesOrder(id);
      if (!order) {
        return res.status(404).json({ error: "Sales order not found" });
      }

      // Get all lines
      const lines = await storage.getSalesOrderLines(id);

      // Check if any items have been fulfilled - if so, cannot cancel
      const anyFulfilled = lines.some((line: SalesOrderLine) => (line.qtyFulfilled ?? 0) > 0);
      if (anyFulfilled) {
        return res.status(400).json({ 
          error: "Cannot cancel order with fulfilled items. Use returns instead." 
        });
      }

      const affectedProductIds = new Set<string>();
      const inventoryMovement = new InventoryMovement(storage);
      const user = await storage.getUser(req.session.userId!);
      const isPivotOrder = order.channel === 'SHOPIFY' || order.channel === 'AMAZON';

      // Update each line: set qtyAllocated = 0, backorderQty = 0
      for (const line of lines) {
        await storage.updateSalesOrderLine(line.id, {
          qtyAllocated: 0,
          backorderQty: 0,
        });
        affectedProductIds.add(line.productId);

        // Log SALES_ORDER_CANCELLED event and restore availableForSaleQty for Pivot orders
        await inventoryMovement.apply({
          eventType: "SALES_ORDER_CANCELLED",
          itemId: line.productId,
          quantity: line.qtyOrdered,
          location: isPivotOrder ? "PIVOT" : "HILDALE",
          source: "USER",
          orderId: id,
          salesOrderLineId: line.id,
          channel: order.channel,
          userId: req.session.userId,
          userName: user?.email,
          notes: `Order ${order.externalOrderId || order.id} cancelled: released ${line.qtyAllocated} allocated, ${line.backorderQty} backordered`,
        });
      }

      // Update order status
      await storage.updateSalesOrder(id, { status: 'CANCELLED' });

      // Refresh backorder snapshots and forecast context for all products
      for (const productId of Array.from(affectedProductIds)) {
        await storage.refreshBackorderSnapshot(productId);
        await storage.refreshProductForecastContext(productId);
      }

      // Return updated order
      const updatedOrder = await storage.getSalesOrder(id);
      res.json(updatedOrder);
    } catch (error: any) {
      console.error("[Sales Orders] Error cancelling sales order:", error);
      res.status(500).json({ error: error.message || "Failed to cancel sales order" });
    }
  });

  // Get all backorder snapshots
  // GET /api/backorder-snapshots
  app.get("/api/backorder-snapshots", requireAuth, async (req: Request, res: Response) => {
    try {
      const snapshots = await storage.getAllBackorderSnapshots();
      res.json(snapshots);
    } catch (error: any) {
      console.error("[Backorder Snapshots] Error fetching backorder snapshots:", error);
      res.status(500).json({ error: error.message || "Failed to fetch backorder snapshots" });
    }
  });

  // Get all ad performance snapshots
  // GET /api/ad-performance-snapshots
  app.get("/api/ad-performance-snapshots", requireAuth, async (req: Request, res: Response) => {
    try {
      const snapshots = await storage.getAllAdPerformanceSnapshots();
      res.json(snapshots);
    } catch (error: any) {
      console.error("[Ad Performance] Error fetching ad performance snapshots:", error);
      res.status(500).json({ error: error.message || "Failed to fetch ad performance snapshots" });
    }
  });

  // ============================================================================
  // MULTI-CHANNEL MARKETING & SALES INTEGRATION
  // ============================================================================

  // Get all channels
  // GET /api/channels
  app.get("/api/channels", requireAuth, async (req: Request, res: Response) => {
    try {
      const channels = await storage.getAllChannels();
      res.json(channels);
    } catch (error: any) {
      console.error("[Channels] Error fetching channels:", error);
      res.status(500).json({ error: error.message || "Failed to fetch channels" });
    }
  });

  // Get channel by ID
  // GET /api/channels/:id
  app.get("/api/channels/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const channel = await storage.getChannel(id);
      if (!channel) {
        return res.status(404).json({ error: "Channel not found" });
      }
      res.json(channel);
    } catch (error: any) {
      console.error("[Channels] Error fetching channel:", error);
      res.status(500).json({ error: error.message || "Failed to fetch channel" });
    }
  });

  // Get all product channel mappings
  // GET /api/product-channel-mappings
  app.get("/api/product-channel-mappings", requireAuth, async (req: Request, res: Response) => {
    try {
      const mappings = await storage.getAllProductChannelMappings();
      res.json(mappings);
    } catch (error: any) {
      console.error("[Mappings] Error fetching mappings:", error);
      res.status(500).json({ error: error.message || "Failed to fetch mappings" });
    }
  });

  // Get product channel mappings by product ID
  // GET /api/products/:productId/channel-mappings
  app.get("/api/products/:productId/channel-mappings", requireAuth, async (req: Request, res: Response) => {
    try {
      const { productId } = req.params;
      const mappings = await storage.getProductChannelMappingsByProduct(productId);
      res.json(mappings);
    } catch (error: any) {
      console.error("[Mappings] Error fetching product mappings:", error);
      res.status(500).json({ error: error.message || "Failed to fetch product mappings" });
    }
  });

  // Create product channel mapping
  // POST /api/product-channel-mappings
  app.post("/api/product-channel-mappings", requireAuth, async (req: Request, res: Response) => {
    try {
      const mapping = await storage.createProductChannelMapping(req.body);
      res.status(201).json(mapping);
    } catch (error: any) {
      console.error("[Mappings] Error creating mapping:", error);
      res.status(500).json({ error: error.message || "Failed to create mapping" });
    }
  });

  // Delete product channel mapping
  // DELETE /api/product-channel-mappings/:id
  app.delete("/api/product-channel-mappings/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const success = await storage.deleteProductChannelMapping(id);
      if (!success) {
        return res.status(404).json({ error: "Mapping not found" });
      }
      res.status(204).send();
    } catch (error: any) {
      console.error("[Mappings] Error deleting mapping:", error);
      res.status(500).json({ error: error.message || "Failed to delete mapping" });
    }
  });

  // Get ad performance snapshots by product
  // GET /api/products/:productId/ad-performance
  app.get("/api/products/:productId/ad-performance", requireAuth, async (req: Request, res: Response) => {
    try {
      const { productId } = req.params;
      const { startDate, endDate } = req.query;
      
      const start = startDate ? new Date(startDate as string) : undefined;
      const end = endDate ? new Date(endDate as string) : undefined;
      
      const snapshots = await storage.getAdPerformanceSnapshotsByProduct(productId, start, end);
      res.json(snapshots);
    } catch (error: any) {
      console.error("[Ad Performance] Error fetching snapshots:", error);
      res.status(500).json({ error: error.message || "Failed to fetch ad performance" });
    }
  });

  // Get sales snapshots by product
  // GET /api/products/:productId/sales
  app.get("/api/products/:productId/sales", requireAuth, async (req: Request, res: Response) => {
    try {
      const { productId } = req.params;
      const { startDate, endDate } = req.query;
      
      const start = startDate ? new Date(startDate as string) : undefined;
      const end = endDate ? new Date(endDate as string) : undefined;
      
      const snapshots = await storage.getSalesSnapshotsByProduct(productId, start, end);
      res.json(snapshots);
    } catch (error: any) {
      console.error("[Sales] Error fetching snapshots:", error);
      res.status(500).json({ error: error.message || "Failed to fetch sales data" });
    }
  });

  // Get product forecast context for all products
  // GET /api/forecast-context
  app.get("/api/forecast-context", requireAuth, async (req: Request, res: Response) => {
    try {
      const contexts = await storage.getAllProductForecastContexts();
      res.json(contexts);
    } catch (error: any) {
      console.error("[Forecast] Error fetching contexts:", error);
      res.status(500).json({ error: error.message || "Failed to fetch forecast contexts" });
    }
  });

  // Get product forecast context by product ID
  // GET /api/products/:productId/forecast-context
  app.get("/api/products/:productId/forecast-context", requireAuth, async (req: Request, res: Response) => {
    try {
      const { productId } = req.params;
      const context = await storage.getProductForecastContext(productId);
      if (!context) {
        return res.status(404).json({ error: "Forecast context not found" });
      }
      res.json(context);
    } catch (error: any) {
      console.error("[Forecast] Error fetching context:", error);
      res.status(500).json({ error: error.message || "Failed to fetch forecast context" });
    }
  });

  // Refresh forecast context for a specific product
  // POST /api/products/:productId/refresh-forecast
  app.post("/api/products/:productId/refresh-forecast", requireAuth, async (req: Request, res: Response) => {
    try {
      const { productId } = req.params;
      const context = await storage.refreshProductForecastContext(productId);
      res.json(context);
    } catch (error: any) {
      console.error("[Forecast] Error refreshing context:", error);
      res.status(500).json({ error: error.message || "Failed to refresh forecast context" });
    }
  });

  // Refresh forecast context for all products
  // POST /api/refresh-all-forecasts
  app.post("/api/refresh-all-forecasts", requireAuth, async (req: Request, res: Response) => {
    try {
      await storage.refreshAllProductForecastContexts();
      res.json({ message: "All forecast contexts refreshed successfully" });
    } catch (error: any) {
      console.error("[Forecast] Error refreshing all contexts:", error);
      res.status(500).json({ error: error.message || "Failed to refresh all forecast contexts" });
    }
  });

  // ========== QuickBooks Online Integration Routes ==========
  // V1 Scope: Read-only historical sales sync + PO→Bill creation
  
  // Import QuickBooks client dynamically to avoid circular deps
  const { QuickBooksClient, isQuickBooksConfigured } = await import('./services/quickbooks-client');

  // GET /api/quickbooks/status - Get connection status
  app.get("/api/quickbooks/status", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!isQuickBooksConfigured()) {
        return res.json({ 
          configured: false, 
          isConnected: false,
          message: 'QuickBooks credentials not configured'
        });
      }

      const userId = req.user?.id || 'system';
      const client = new QuickBooksClient(storage, userId);
      const status = await client.getConnectionStatus();
      
      res.json({ 
        configured: true, 
        ...status 
      });
    } catch (error: any) {
      console.error("[QuickBooks] Error getting status:", error);
      res.status(500).json({ error: error.message || "Failed to get QuickBooks status" });
    }
  });

  // POST /api/quickbooks/test-connection - Test connection
  app.post("/api/quickbooks/test-connection", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!isQuickBooksConfigured()) {
        return res.status(400).json({ 
          success: false, 
          message: 'QuickBooks credentials not configured. Add QUICKBOOKS_CLIENT_ID and QUICKBOOKS_CLIENT_SECRET.'
        });
      }

      const userId = req.user?.id || 'system';
      const client = new QuickBooksClient(storage, userId);
      const result = await client.testConnection();
      
      res.json(result);
    } catch (error: any) {
      console.error("[QuickBooks] Test connection error:", error);
      res.status(500).json({ success: false, message: error.message || "Connection test failed" });
    }
  });

  // POST /api/quickbooks/sync-sales - Sync historical sales data (legacy snapshots)
  app.post("/api/quickbooks/sync-sales", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!isQuickBooksConfigured()) {
        return res.status(400).json({ 
          success: false, 
          message: 'QuickBooks not configured'
        });
      }

      const userId = req.user?.id || 'system';
      const { years = 3 } = req.body;
      
      const client = new QuickBooksClient(storage, userId);
      const result = await client.syncSalesSnapshots(years);
      
      res.json(result);
    } catch (error: any) {
      console.error("[QuickBooks] Sync sales error:", error);
      res.status(500).json({ success: false, message: error.message || "Sales sync failed" });
    }
  });

  // POST /api/quickbooks/sync-demand-history - Sync demand history (sales + returns)
  // Mode: "append" (add new, update existing) or "rebuild" (clear date range, repopulate)
  app.post("/api/quickbooks/sync-demand-history", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!isQuickBooksConfigured()) {
        return res.status(400).json({ 
          success: false, 
          message: 'QuickBooks not configured'
        });
      }

      const userId = req.user?.id || 'system';
      const { years = 3, mode = "append" } = req.body;
      const syncMode = mode === "rebuild" ? "rebuild" : "append"; // Default to "append" (safer)
      console.log(`[QuickBooks] Starting demand history sync in ${syncMode.toUpperCase()} mode for ${years} years`);
      
      const client = new QuickBooksClient(storage, userId);
      
      // In rebuild mode, clear existing data for the date range first
      if (syncMode === "rebuild") {
        const startDate = new Date();
        startDate.setFullYear(startDate.getFullYear() - years);
        console.log(`[QuickBooks] Rebuild mode: clearing demand history from ${startDate.toISOString()}`);
        try {
          await storage.clearQuickbooksDemandHistory(startDate);
        } catch (clearErr: any) {
          console.warn('[QuickBooks] Failed to clear old demand history:', clearErr);
        }
      }
      
      const result = await client.syncDemandHistory(years);
      
      // Log sync completion
      try {
        const { logService } = await import('./services/log-service');
        await logService.logIntegrationEvent({
          source: 'QUICKBOOKS',
          action: syncMode === "rebuild" ? 'REBUILD_SYNC_COMPLETED' : 'APPEND_SYNC_COMPLETED',
          status: result.success ? 'SUCCESS' : 'FAILED',
          message: result.message || `Synced demand history (${syncMode} mode)`,
          details: { mode: syncMode, years, ...result }
        });
      } catch (logError) {
        console.warn('[QuickBooks] Failed to log sync completion:', logError);
      }
      
      res.json({
        ...result,
        mode: syncMode,
      });
    } catch (error: any) {
      console.error("[QuickBooks] Sync demand history error:", error);
      res.status(500).json({ success: false, message: error.message || "Demand history sync failed" });
    }
  });

  // GET /api/quickbooks/demand-history - Get demand history records
  app.get("/api/quickbooks/demand-history", requireAuth, async (req: Request, res: Response) => {
    try {
      const { search, year, month, page, pageSize } = req.query;
      
      const result = await storage.getQuickbooksDemandHistoryItems({
        search: search as string | undefined,
        year: year ? parseInt(year as string) : undefined,
        month: month ? parseInt(month as string) : undefined,
        page: page ? parseInt(page as string) : 1,
        pageSize: pageSize ? parseInt(pageSize as string) : 25,
      });
      
      res.json(result);
    } catch (error: any) {
      console.error("[QuickBooks] Get demand history error:", error);
      res.status(500).json({ error: error.message || "Failed to get demand history" });
    }
  });

  // GET /api/quickbooks/sales-snapshots - Get all sales snapshots for analysis
  app.get("/api/quickbooks/sales-snapshots", requireAuth, async (req: Request, res: Response) => {
    try {
      const snapshots = await storage.getAllQuickbooksSalesSnapshots();
      res.json(snapshots);
    } catch (error: any) {
      console.error("[QuickBooks] Error fetching snapshots:", error);
      res.status(500).json({ error: error.message || "Failed to fetch snapshots" });
    }
  });

  // GET /api/quickbooks/sales-snapshots/:sku - Get snapshots for a specific SKU
  app.get("/api/quickbooks/sales-snapshots/:sku", requireAuth, async (req: Request, res: Response) => {
    try {
      const { sku } = req.params;
      const snapshots = await storage.getQuickbooksSalesSnapshotsBySku(sku);
      res.json(snapshots);
    } catch (error: any) {
      console.error("[QuickBooks] Error fetching SKU snapshots:", error);
      res.status(500).json({ error: error.message || "Failed to fetch snapshots" });
    }
  });

  // ========================================================================
  // DAILY SALES SNAPSHOTS (Aggregated daily totals for LLM trend analysis)
  // ========================================================================

  // GET /api/daily-sales-snapshots - Get daily sales snapshots in a date range
  app.get("/api/daily-sales-snapshots", requireAuth, async (req: Request, res: Response) => {
    try {
      const { startDate, endDate, days } = req.query;
      
      let start: string;
      let end: string;
      
      if (startDate && endDate) {
        start = startDate as string;
        end = endDate as string;
      } else {
        // Default to last N days (default 30)
        const daysBack = days ? parseInt(days as string) : 30;
        const endDt = new Date();
        const startDt = new Date();
        startDt.setDate(startDt.getDate() - daysBack);
        
        start = startDt.toISOString().split('T')[0];
        end = endDt.toISOString().split('T')[0];
      }
      
      const snapshots = await storage.getDailySalesSnapshotsInRange(start, end);
      res.json({
        snapshots,
        dateRange: { startDate: start, endDate: end },
        count: snapshots.length,
      });
    } catch (error: any) {
      console.error("[DailySales] Error fetching snapshots:", error);
      res.status(500).json({ error: error.message || "Failed to fetch daily sales snapshots" });
    }
  });

  // GET /api/daily-sales-snapshots/years - Get available years
  app.get("/api/daily-sales-snapshots/years", requireAuth, async (req: Request, res: Response) => {
    try {
      const years = await storage.getDailySalesSnapshotYears();
      res.json({ years });
    } catch (error: any) {
      console.error("[DailySales] Error fetching years:", error);
      res.status(500).json({ error: error.message || "Failed to fetch years" });
    }
  });

  // GET /api/daily-sales-snapshots/:date - Get snapshot for a specific date
  app.get("/api/daily-sales-snapshots/:date", requireAuth, async (req: Request, res: Response) => {
    try {
      const { date } = req.params;
      const snapshot = await storage.getDailySalesSnapshot(date);
      
      if (!snapshot) {
        return res.status(404).json({ error: "No snapshot found for this date" });
      }
      
      res.json(snapshot);
    } catch (error: any) {
      console.error("[DailySales] Error fetching snapshot:", error);
      res.status(500).json({ error: error.message || "Failed to fetch snapshot" });
    }
  });

  // POST /api/daily-sales-snapshots/trigger - Manually trigger daily sales aggregation
  app.post("/api/daily-sales-snapshots/trigger", requireAuth, async (req: Request, res: Response) => {
    try {
      const { date } = req.body;
      const { triggerAggregation } = await import("./services/daily-sales-scheduler");
      
      const targetDate = date ? new Date(date) : new Date();
      const result = await triggerAggregation(targetDate);
      
      res.json(result);
    } catch (error: any) {
      console.error("[DailySales] Error triggering aggregation:", error);
      res.status(500).json({ error: error.message || "Failed to trigger aggregation" });
    }
  });

  // POST /api/daily-sales-snapshots/backfill - Backfill historical daily sales data
  app.post("/api/daily-sales-snapshots/backfill", requireAuth, async (req: Request, res: Response) => {
    try {
      const { days = 30 } = req.body;
      const { backfillDailySales } = await import("./services/daily-sales-scheduler");
      
      const result = await backfillDailySales(days);
      
      res.json(result);
    } catch (error: any) {
      console.error("[DailySales] Error backfilling:", error);
      res.status(500).json({ error: error.message || "Failed to backfill daily sales" });
    }
  });

  // POST /api/purchase-orders/:id/create-bill - Create QuickBooks Bill from PO
  app.post("/api/purchase-orders/:id/create-bill", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!isQuickBooksConfigured()) {
        return res.status(400).json({ 
          success: false, 
          error: 'QuickBooks not configured'
        });
      }

      const { id } = req.params;
      const userId = req.user?.id || 'system';
      
      // Get PO with lines
      const po = await storage.getPurchaseOrder(id);
      if (!po) {
        return res.status(404).json({ success: false, error: 'Purchase order not found' });
      }
      
      const poLines = await storage.getPurchaseOrderLinesByPOId(id);
      if (!poLines.length) {
        return res.status(400).json({ success: false, error: 'Purchase order has no line items' });
      }
      
      // Get supplier
      const supplier = await storage.getSupplier(po.supplierId);
      if (!supplier) {
        return res.status(400).json({ success: false, error: 'Supplier not found' });
      }
      
      // Build items map
      const itemIds = poLines.map(line => line.itemId);
      const allItems = await storage.getAllItems();
      const itemsMap = new Map<string, typeof allItems[0]>();
      allItems.filter(i => itemIds.includes(i.id)).forEach(i => itemsMap.set(i.id, i));
      
      // Create bill
      const client = new QuickBooksClient(storage, userId);
      const result = await client.createBillFromPurchaseOrder(po, poLines, supplier, itemsMap);
      
      res.json(result);
    } catch (error: any) {
      console.error("[QuickBooks] Create bill error:", error);
      res.status(500).json({ success: false, error: error.message || "Failed to create bill" });
    }
  });

  // GET /api/purchase-orders/:id/bill-status - Get QuickBooks Bill status for PO
  app.get("/api/purchase-orders/:id/bill-status", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const bill = await storage.getQuickbooksBillByPurchaseOrderId(id);
      
      if (!bill) {
        return res.json({ hasBill: false });
      }
      
      res.json({
        hasBill: true,
        billId: bill.quickbooksBillId,
        billNumber: bill.quickbooksBillNumber,
        status: bill.status,
        totalAmount: bill.totalAmount,
        createdAt: bill.createdAt,
      });
    } catch (error: any) {
      console.error("[QuickBooks] Get bill status error:", error);
      res.status(500).json({ error: error.message || "Failed to get bill status" });
    }
  });

  // OAuth callback route - handle QuickBooks OAuth redirect
  app.get("/api/quickbooks/callback", async (req: Request, res: Response) => {
    try {
      const { code, realmId, state } = req.query;
      
      if (!code || !realmId) {
        return res.status(400).send('Missing required OAuth parameters');
      }

      const clientId = process.env.QUICKBOOKS_CLIENT_ID;
      const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
      const redirectUri = process.env.QUICKBOOKS_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/quickbooks/callback`;

      if (!clientId || !clientSecret) {
        return res.status(500).send('QuickBooks credentials not configured');
      }

      // Exchange code for tokens
      const tokenResponse = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: code as string,
          redirect_uri: redirectUri,
        }),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error('[QuickBooks] Token exchange failed:', errorText);
        return res.status(400).send('Failed to exchange OAuth code for tokens');
      }

      const tokens = await tokenResponse.json() as {
        access_token: string;
        refresh_token: string;
        expires_in: number;
        x_refresh_token_expires_in: number;
      };

      // Get company info
      let companyName = 'Unknown Company';
      try {
        const companyResponse = await fetch(
          `https://quickbooks.api.intuit.com/v3/company/${realmId}/companyinfo/${realmId}`,
          {
            headers: {
              'Authorization': `Bearer ${tokens.access_token}`,
              'Accept': 'application/json',
            },
          }
        );
        if (companyResponse.ok) {
          const companyData = await companyResponse.json() as { CompanyInfo?: { CompanyName?: string } };
          companyName = companyData.CompanyInfo?.CompanyName || companyName;
        }
      } catch (e) {
        console.error('[QuickBooks] Failed to fetch company info:', e);
      }

      // Parse user ID from state (format: userId or just use 'system')
      const userId = (state as string) || 'system';
      const now = new Date();
      const accessTokenExpiresAt = new Date(now.getTime() + tokens.expires_in * 1000);
      const refreshTokenExpiresAt = new Date(now.getTime() + tokens.x_refresh_token_expires_in * 1000);

      // Check if auth record exists
      const existingAuth = await storage.getQuickbooksAuth(userId);
      
      if (existingAuth) {
        await storage.updateQuickbooksAuth(existingAuth.id, {
          realmId: realmId as string,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          accessTokenExpiresAt,
          refreshTokenExpiresAt,
          companyName,
          isConnected: true,
        });
      } else {
        await storage.createQuickbooksAuth({
          userId,
          realmId: realmId as string,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          accessTokenExpiresAt,
          refreshTokenExpiresAt,
          companyName,
          isConnected: true,
        });
      }

      // Redirect to AI Agent Data Sources page with success
      console.log('[QuickBooks] OAuth successful for user:', userId, 'company:', companyName);
      res.redirect('/ai?tab=data-sources&quickbooks=connected');
    } catch (error: any) {
      console.error('[QuickBooks] OAuth callback error:', error);
      res.redirect('/ai?tab=data-sources&quickbooks=error');
    }
  });

  // Alternative OAuth callback route - matches QuickBooks app redirect URI
  app.get("/auth/qbo/callback", async (req: Request, res: Response) => {
    try {
      const { code, realmId, state } = req.query;
      
      if (!code || !realmId) {
        return res.status(400).send('Missing required OAuth parameters');
      }

      const clientId = process.env.QUICKBOOKS_CLIENT_ID;
      const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
      const redirectUri = process.env.QUICKBOOKS_REDIRECT_URI || `${req.protocol}://${req.get('host')}/auth/qbo/callback`;

      if (!clientId || !clientSecret) {
        return res.status(500).send('QuickBooks credentials not configured');
      }

      // Exchange code for tokens
      const tokenResponse = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: code as string,
          redirect_uri: redirectUri,
        }),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error('[QuickBooks] Token exchange failed:', errorText);
        return res.status(400).send('Failed to exchange OAuth code for tokens');
      }

      const tokens = await tokenResponse.json() as {
        access_token: string;
        refresh_token: string;
        expires_in: number;
        x_refresh_token_expires_in: number;
      };

      // Get company info
      let companyName = 'Unknown Company';
      try {
        const companyResponse = await fetch(
          `https://quickbooks.api.intuit.com/v3/company/${realmId}/companyinfo/${realmId}`,
          {
            headers: {
              'Authorization': `Bearer ${tokens.access_token}`,
              'Accept': 'application/json',
            },
          }
        );
        if (companyResponse.ok) {
          const companyData = await companyResponse.json() as { CompanyInfo?: { CompanyName?: string } };
          companyName = companyData.CompanyInfo?.CompanyName || companyName;
        }
      } catch (e) {
        console.error('[QuickBooks] Failed to fetch company info:', e);
      }

      // Parse user ID from state
      const userId = (state as string) || 'system';
      const now = new Date();
      const accessTokenExpiresAt = new Date(now.getTime() + tokens.expires_in * 1000);
      const refreshTokenExpiresAt = new Date(now.getTime() + tokens.x_refresh_token_expires_in * 1000);

      // Check if auth record exists
      const existingAuth = await storage.getQuickbooksAuth(userId);
      
      if (existingAuth) {
        await storage.updateQuickbooksAuth(existingAuth.id, {
          realmId: realmId as string,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          accessTokenExpiresAt,
          refreshTokenExpiresAt,
          companyName,
          isConnected: true,
        });
      } else {
        await storage.createQuickbooksAuth({
          userId,
          realmId: realmId as string,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          accessTokenExpiresAt,
          refreshTokenExpiresAt,
          companyName,
          isConnected: true,
        });
      }

      // Redirect to AI Agent Data Sources page with success
      console.log('[QuickBooks] OAuth successful for user:', userId, 'company:', companyName);
      res.redirect('/ai?tab=data-sources&quickbooks=connected');
    } catch (error: any) {
      console.error('[QuickBooks] OAuth callback error:', error);
      res.redirect('/ai?tab=data-sources&quickbooks=error');
    }
  });

  // GET /api/quickbooks/auth-url - Get OAuth authorization URL
  app.get("/api/quickbooks/auth-url", requireAuth, async (req: Request, res: Response) => {
    try {
      const clientId = process.env.QUICKBOOKS_CLIENT_ID;
      if (!clientId) {
        return res.status(400).json({ error: 'QuickBooks client ID not configured' });
      }

      const redirectUri = process.env.QUICKBOOKS_REDIRECT_URI || 
        `${req.protocol}://${req.get('host')}/api/quickbooks/callback`;
      
      const scope = 'com.intuit.quickbooks.accounting';
      const state = req.user?.id || 'system';
      
      const authUrl = `https://appcenter.intuit.com/connect/oauth2?` +
        `client_id=${clientId}&` +
        `redirect_uri=${encodeURIComponent(redirectUri)}&` +
        `response_type=code&` +
        `scope=${encodeURIComponent(scope)}&` +
        `state=${state}`;

      res.json({ authUrl });
    } catch (error: any) {
      console.error('[QuickBooks] Auth URL error:', error);
      res.status(500).json({ error: error.message || 'Failed to generate auth URL' });
    }
  });

  // POST /api/quickbooks/disconnect - Disconnect QuickBooks
  app.post("/api/quickbooks/disconnect", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id || 'system';
      const auth = await storage.getQuickbooksAuth(userId);
      
      if (auth) {
        await storage.updateQuickbooksAuth(auth.id, { isConnected: false });
      }
      
      res.json({ success: true, message: 'QuickBooks disconnected' });
    } catch (error: any) {
      console.error('[QuickBooks] Disconnect error:', error);
      res.status(500).json({ success: false, error: error.message || 'Failed to disconnect' });
    }
  });

  // GET /api/quickbooks/items - Fetch items from QuickBooks for SKU mapping
  app.get("/api/quickbooks/items", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id || 'system';
      const qbClient = new QuickBooksClient(storage, userId);
      const result = await qbClient.fetchItems();
      
      if (!result.success) {
        return res.status(400).json({ success: false, error: result.error });
      }
      
      res.json(result);
    } catch (error: any) {
      console.error('[QuickBooks] Items fetch error:', error);
      res.status(500).json({ success: false, error: error.message || 'Failed to fetch items' });
    }
  });

  // GET /api/quickbooks/items/lookup/:sku - Look up item by SKU with purchase cost and preferred vendor
  app.get("/api/quickbooks/items/lookup/:sku", requireAuth, async (req: Request, res: Response) => {
    try {
      const { sku } = req.params;
      if (!sku) {
        return res.status(400).json({ success: false, error: 'SKU is required' });
      }

      const userId = req.user?.id || 'system';
      const qbClient = new QuickBooksClient(storage, userId);
      const result = await qbClient.lookupItemBySku(sku);
      
      if (!result.success) {
        return res.status(404).json(result);
      }
      
      res.json(result);
    } catch (error: any) {
      console.error('[QuickBooks] Item lookup error:', error);
      res.status(500).json({ success: false, error: error.message || 'Failed to lookup item' });
    }
  });

  // GET /api/quickbooks/items/search - Search QuickBooks items by name for fallback matching
  app.get("/api/quickbooks/items/search", requireAuth, async (req: Request, res: Response) => {
    try {
      const { q, limit } = req.query;
      const searchTerm = typeof q === 'string' ? q : '';
      const searchLimit = typeof limit === 'string' ? parseInt(limit, 10) : 10;

      if (!searchTerm || searchTerm.length < 2) {
        return res.status(400).json({ success: false, error: 'Search term must be at least 2 characters' });
      }

      const userId = req.user?.id || 'system';
      const qbClient = new QuickBooksClient(storage, userId);
      const result = await qbClient.searchItemsByName(searchTerm, searchLimit);
      
      res.json(result);
    } catch (error: any) {
      console.error('[QuickBooks] Item search error:', error);
      res.status(500).json({ success: false, error: error.message || 'Failed to search items' });
    }
  });

  // ============================================================================
  // SYSTEM LOGS (Unified logging for mismatches and external events)
  // ============================================================================

  app.get("/api/system-logs", requireAuth, async (req: Request, res: Response) => {
    try {
      const { type, severity, entityType, startDate, endDate } = req.query;
      const filters: { type?: string; severity?: string; entityType?: string; startDate?: Date; endDate?: Date } = {};
      
      if (type && typeof type === 'string') filters.type = type;
      if (severity && typeof severity === 'string') filters.severity = severity;
      if (entityType && typeof entityType === 'string') filters.entityType = entityType;
      if (startDate && typeof startDate === 'string') filters.startDate = new Date(startDate);
      if (endDate && typeof endDate === 'string') filters.endDate = new Date(endDate);
      
      const logs = await storage.getAllSystemLogs(filters);
      res.json(logs);
    } catch (error: any) {
      console.error('[System Logs] Error fetching logs:', error);
      res.status(500).json({ error: error.message || 'Failed to fetch system logs' });
    }
  });

  app.get("/api/system-logs/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const log = await storage.getSystemLog(req.params.id);
      if (!log) {
        return res.status(404).json({ error: 'System log not found' });
      }
      res.json(log);
    } catch (error: any) {
      console.error('[System Logs] Error fetching log:', error);
      res.status(500).json({ error: error.message || 'Failed to fetch system log' });
    }
  });

  // Log inventory adjustment (for AI Agent Logs)
  app.post("/api/logs/inventory-adjustment", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const user = await storage.getUser(userId);
      
      const { itemId, itemName, itemSku, field, oldValue, newValue, delta, reason, notes } = req.body;
      
      if (!itemId || !field || reason === undefined) {
        return res.status(400).json({ error: 'Missing required fields: itemId, field, reason' });
      }
      
      await logService.logInventoryAdjustment({
        itemId,
        itemName,
        itemSku,
        field,
        oldValue: oldValue ?? 0,
        newValue: newValue ?? 0,
        delta: delta ?? 0,
        reason,
        notes,
        userId,
        userName: user?.email,
      });
      
      res.json({ success: true, message: 'Inventory adjustment logged' });
    } catch (error: any) {
      console.error('[Logs] Error logging inventory adjustment:', error);
      res.status(500).json({ error: error.message || 'Failed to log inventory adjustment' });
    }
  });

  // ============================================================================
  // AI AGENT SETTINGS
  // ============================================================================

  app.get("/api/ai-agent-settings", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      
      let settings = await storage.getAiAgentSettingsByUserId(userId);
      
      // If no settings exist, create default settings
      if (!settings) {
        settings = await storage.createAiAgentSettings({ userId });
      }
      
      res.json(settings);
    } catch (error: any) {
      console.error('[AI Agent Settings] Error fetching settings:', error);
      res.status(500).json({ error: error.message || 'Failed to fetch AI agent settings' });
    }
  });

  app.patch("/api/ai-agent-settings", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      
      // Check if settings exist, create if not
      let existing = await storage.getAiAgentSettingsByUserId(userId);
      if (!existing) {
        existing = await storage.createAiAgentSettings({ userId });
      }
      
      // Filter to only include valid fields that are defined
      const validFields = [
        'autoSendCriticalPos', 'criticalRescueDays', 'criticalThresholdDays',
        'highThresholdDays', 'mediumThresholdDays', 'shopifyTwoWaySync', 'shopifySafetyBuffer',
        'amazonTwoWaySync', 'amazonSafetyBuffer',
        'extensivTwoWaySync', 'pivotLowDaysThreshold', 'hildaleHighDaysThreshold'
      ];
      const updateData: Record<string, any> = {};
      for (const field of validFields) {
        if (req.body[field] !== undefined) {
          updateData[field] = req.body[field];
        }
      }
      
      // Only update if there are valid fields to update
      if (Object.keys(updateData).length === 0) {
        return res.json(existing);
      }
      
      // Update settings
      const updated = await storage.updateAiAgentSettings(userId, updateData);
      if (!updated) {
        return res.status(404).json({ error: 'Failed to update settings' });
      }
      
      res.json(updated);
    } catch (error: any) {
      console.error('[AI Agent Settings] Error updating settings:', error);
      res.status(500).json({ error: error.message || 'Failed to update AI agent settings' });
    }
  });

  // ============================================================================
  // SHOPIFY INVENTORY SYNC
  // ============================================================================

  // Trigger manual Shopify inventory sync for all mapped items
  app.post("/api/shopify/sync-inventory", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      // Check if two-way sync is enabled before proceeding
      const settings = await storage.getAiAgentSettingsByUserId(userId);
      if (!settings?.shopifyTwoWaySync) {
        return res.status(400).json({ 
          error: "Two-way sync disabled", 
          message: "Enable 'Push Inventory to Shopify' in AI Agent Settings to use this feature" 
        });
      }

      const { shopifyInventorySync } = await import("./services/shopify-inventory-sync-service");
      
      // Initialize with user-specific credentials
      const initialized = await shopifyInventorySync.initialize(userId);
      if (!initialized) {
        return res.status(400).json({ 
          error: "Shopify not configured", 
          message: "Please configure Shopify integration in Data Sources or set environment variables" 
        });
      }

      const result = await shopifyInventorySync.syncAllInventory(userId);
      
      res.json({
        success: true,
        message: `Synced ${result.synced} items to Shopify`,
        ...result,
      });
    } catch (error: any) {
      console.error('[Shopify Sync] Error syncing inventory:', error);
      res.status(500).json({ error: error.message || 'Failed to sync inventory' });
    }
  });

  // Sync a single item's inventory to Shopify
  app.post("/api/shopify/sync-inventory/:itemId", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      // Check if two-way sync is enabled before proceeding
      const settings = await storage.getAiAgentSettingsByUserId(userId);
      if (!settings?.shopifyTwoWaySync) {
        return res.status(400).json({ 
          error: "Two-way sync disabled", 
          message: "Enable 'Push Inventory to Shopify' in AI Agent Settings to use this feature" 
        });
      }

      const { itemId } = req.params;
      const { shopifyInventorySync } = await import("./services/shopify-inventory-sync-service");

      // Initialize with user-specific credentials
      const initialized = await shopifyInventorySync.initialize(userId);
      if (!initialized) {
        return res.status(400).json({ 
          error: "Shopify not configured", 
          message: "Please configure Shopify integration in Data Sources or set environment variables" 
        });
      }

      const result = await shopifyInventorySync.syncItemById(itemId, userId);
      
      if (!result) {
        return res.status(404).json({ 
          error: "Item not found or not mapped to Shopify",
          message: "Ensure the item has a Shopify variant ID configured"
        });
      }

      if (result.success) {
        res.json({ 
          success: true, 
          message: `Synced ${result.sku} to Shopify`,
          ...result 
        });
      } else {
        res.status(400).json({ 
          success: false, 
          error: result.error,
          ...result 
        });
      }
    } catch (error: any) {
      console.error('[Shopify Sync] Error syncing item:', error);
      res.status(500).json({ error: error.message || 'Failed to sync item' });
    }
  });

  // Check Shopify sync configuration status
  app.get("/api/shopify/sync-status", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const { shopifyInventorySync } = await import("./services/shopify-inventory-sync-service");
      const settings = await storage.getAiAgentSettingsByUserId(userId);
      
      // Try to initialize with user credentials
      await shopifyInventorySync.initialize(userId);
      const credentialsInfo = shopifyInventorySync.getCredentialsInfo();

      res.json({
        configured: credentialsInfo.configured,
        shopDomain: credentialsInfo.shopDomain,
        hasLocationId: credentialsInfo.hasLocationId,
        hasPivotLocationId: credentialsInfo.hasPivotLocationId,
        hasHildaleLocationId: credentialsInfo.hasHildaleLocationId,
        pivotLocationId: credentialsInfo.pivotLocationId,
        hildaleLocationId: credentialsInfo.hildaleLocationId,
        twoWaySyncEnabled: settings?.shopifyTwoWaySync || false,
        safetyBuffer: settings?.shopifySafetyBuffer || 0,
        // Source info
        source: credentialsInfo.configured 
          ? (await storage.getIntegrationConfig(userId, 'SHOPIFY'))?.isEnabled 
            ? 'integration_config' 
            : 'environment_variables'
          : 'none',
      });
    } catch (error: any) {
      console.error('[Shopify Sync] Error checking status:', error);
      res.status(500).json({ error: error.message || 'Failed to check sync status' });
    }
  });

  // ============================================================================
  // SHOPIFY WEBHOOKS MANAGEMENT
  // ============================================================================

  // List all registered Shopify webhooks
  app.get("/api/shopify/webhooks", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const config = await storage.getIntegrationConfig(userId, 'SHOPIFY');
      const shopDomain = (config?.config as any)?.shopDomain || process.env.SHOPIFY_SHOP_DOMAIN;
      const accessToken = config?.apiKey || process.env.SHOPIFY_ACCESS_TOKEN;
      const apiVersion = (config?.config as any)?.apiVersion || '2024-01';

      if (!shopDomain || !accessToken) {
        return res.status(400).json({ error: "Shopify credentials not configured" });
      }

      const client = new ShopifyClient(shopDomain, accessToken, apiVersion);
      const webhooks = await client.listWebhooks();

      res.json({ webhooks });
    } catch (error: any) {
      console.error('[Shopify Webhooks] Error listing webhooks:', error);
      res.status(500).json({ error: error.message || 'Failed to list webhooks' });
    }
  });

  // Register a new Shopify webhook
  app.post("/api/shopify/webhooks", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const { topic, address } = req.body;
      if (!topic || !address) {
        return res.status(400).json({ error: "Missing required fields: topic, address" });
      }

      const config = await storage.getIntegrationConfig(userId, 'SHOPIFY');
      const shopDomain = (config?.config as any)?.shopDomain || process.env.SHOPIFY_SHOP_DOMAIN;
      const accessToken = config?.apiKey || process.env.SHOPIFY_ACCESS_TOKEN;
      const apiVersion = (config?.config as any)?.apiVersion || '2024-01';

      if (!shopDomain || !accessToken) {
        return res.status(400).json({ error: "Shopify credentials not configured" });
      }

      const client = new ShopifyClient(shopDomain, accessToken, apiVersion);
      const webhook = await client.registerWebhook(topic, address);

      console.log(`[Shopify Webhooks] Registered webhook for topic ${topic}: ${webhook.id}`);
      res.json({ success: true, webhook });
    } catch (error: any) {
      console.error('[Shopify Webhooks] Error registering webhook:', error);
      res.status(500).json({ error: error.message || 'Failed to register webhook' });
    }
  });

  // Delete a Shopify webhook
  app.delete("/api/shopify/webhooks/:webhookId", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const { webhookId } = req.params;
      if (!webhookId) {
        return res.status(400).json({ error: "Missing webhook ID" });
      }

      const config = await storage.getIntegrationConfig(userId, 'SHOPIFY');
      const shopDomain = (config?.config as any)?.shopDomain || process.env.SHOPIFY_SHOP_DOMAIN;
      const accessToken = config?.apiKey || process.env.SHOPIFY_ACCESS_TOKEN;
      const apiVersion = (config?.config as any)?.apiVersion || '2024-01';

      if (!shopDomain || !accessToken) {
        return res.status(400).json({ error: "Shopify credentials not configured" });
      }

      const client = new ShopifyClient(shopDomain, accessToken, apiVersion);
      await client.deleteWebhook(parseInt(webhookId, 10));

      console.log(`[Shopify Webhooks] Deleted webhook ${webhookId}`);
      res.json({ success: true });
    } catch (error: any) {
      console.error('[Shopify Webhooks] Error deleting webhook:', error);
      res.status(500).json({ error: error.message || 'Failed to delete webhook' });
    }
  });

  // Auto-register all Shopify webhooks using the new modular system
  app.post("/api/shopify/webhooks/auto-register", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const config = await storage.getIntegrationConfig(userId, 'SHOPIFY');
      const shopDomain = (config?.config as any)?.shopDomain || process.env.SHOPIFY_SHOP_DOMAIN;
      const accessToken = config?.apiKey || process.env.SHOPIFY_ACCESS_TOKEN;
      const apiVersion = (config?.config as any)?.apiVersion || '2024-01';

      if (!shopDomain || !accessToken) {
        return res.status(400).json({ error: "Shopify credentials not configured" });
      }

      const { ensureWebhooks } = await import('./shopify/webhook-admin');
      const result = await ensureWebhooks(shopDomain, accessToken, apiVersion);
      
      console.log(`[Shopify Webhooks] Auto-registration completed:`, result);
      res.json(result);
    } catch (error: any) {
      console.error('[Shopify Webhooks] Error in auto-registration:', error);
      res.status(500).json({ error: error.message || 'Failed to auto-register webhooks' });
    }
  });

  // Register all order-related webhooks at once (legacy endpoint)
  app.post("/api/shopify/webhooks/register-orders", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const { callbackUrl } = req.body;
      if (!callbackUrl) {
        return res.status(400).json({ error: "Missing callback URL" });
      }

      const config = await storage.getIntegrationConfig(userId, 'SHOPIFY');
      const shopDomain = (config?.config as any)?.shopDomain || process.env.SHOPIFY_SHOP_DOMAIN;
      const accessToken = config?.apiKey || process.env.SHOPIFY_ACCESS_TOKEN;
      const apiVersion = (config?.config as any)?.apiVersion || '2024-01';

      if (!shopDomain || !accessToken) {
        return res.status(400).json({ error: "Shopify credentials not configured" });
      }

      const client = new ShopifyClient(shopDomain, accessToken, apiVersion);
      
      const orderTopics = ['orders/create', 'orders/updated', 'orders/cancelled', 'orders/fulfilled'];
      const results: { topic: string; success: boolean; webhookId?: number; error?: string }[] = [];

      for (const topic of orderTopics) {
        try {
          const webhook = await client.registerWebhook(topic, callbackUrl);
          results.push({ topic, success: true, webhookId: webhook.id });
        } catch (err: any) {
          // If webhook already exists, it's not an error
          if (err.message?.includes('422') || err.message?.includes('already exists')) {
            results.push({ topic, success: true, error: 'Already registered' });
          } else {
            results.push({ topic, success: false, error: err.message });
          }
        }
      }

      console.log(`[Shopify Webhooks] Registered order webhooks:`, results);
      res.json({ success: true, results });
    } catch (error: any) {
      console.error('[Shopify Webhooks] Error registering order webhooks:', error);
      res.status(500).json({ error: error.message || 'Failed to register order webhooks' });
    }
  });

  // Test a specific webhook by fetching it from Shopify API
  app.get("/api/shopify/webhooks/:webhookId/test", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const { webhookId } = req.params;
      if (!webhookId) {
        return res.status(400).json({ error: "Missing webhook ID" });
      }

      const config = await storage.getIntegrationConfig(userId, 'SHOPIFY');
      const shopDomain = (config?.config as any)?.shopDomain || process.env.SHOPIFY_SHOP_DOMAIN;
      const accessToken = config?.apiKey || process.env.SHOPIFY_ACCESS_TOKEN;
      const apiVersion = (config?.config as any)?.apiVersion || '2024-01';

      if (!shopDomain || !accessToken) {
        return res.status(400).json({ error: "Shopify credentials not configured" });
      }

      const client = new ShopifyClient(shopDomain, accessToken, apiVersion);
      
      // Fetch the specific webhook to verify it exists
      const webhook = await client.getWebhook(parseInt(webhookId, 10));
      
      if (webhook) {
        console.log(`[Shopify Webhooks] Test successful for webhook ${webhookId}: ${webhook.topic}`);
        res.json({ 
          success: true, 
          webhook,
          message: `Webhook ${webhook.topic} is active and registered with Shopify`
        });
      } else {
        res.status(404).json({ 
          success: false, 
          error: "Webhook not found in Shopify" 
        });
      }
    } catch (error: any) {
      console.error('[Shopify Webhooks] Error testing webhook:', error);
      res.status(500).json({ error: error.message || 'Failed to test webhook' });
    }
  });

  // Shopify Reconciliation Scheduler status and manual trigger
  app.get("/api/shopify/reconciliation/status", requireAuth, async (req: Request, res: Response) => {
    try {
      const { getReconciliationSchedulerStatus } = await import("./services/shopify-reconciliation-scheduler");
      const status = getReconciliationSchedulerStatus();
      res.json(status);
    } catch (error: any) {
      console.error('[Shopify Reconciliation] Error getting status:', error);
      res.status(500).json({ error: error.message || 'Failed to get reconciliation status' });
    }
  });

  app.post("/api/shopify/reconciliation/trigger", requireAuth, async (req: Request, res: Response) => {
    try {
      const { triggerManualReconciliation } = await import("./services/shopify-reconciliation-scheduler");
      const result = await triggerManualReconciliation();
      res.json({
        success: result.success,
        message: `Reconciliation completed: ${result.ordersCreated} created, ${result.ordersUpdated} updated`,
        ...result,
      });
    } catch (error: any) {
      console.error('[Shopify Reconciliation] Error triggering reconciliation:', error);
      res.status(500).json({ error: error.message || 'Failed to trigger reconciliation' });
    }
  });

  // Pull inventory FROM Shopify to update hildaleQty and pivotQty (multi-location)
  app.post("/api/shopify/pull-inventory", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const { shopifyInventorySync } = await import("./services/shopify-inventory-sync-service");
      
      // Initialize with user-specific credentials
      const initialized = await shopifyInventorySync.initialize(userId);
      if (!initialized) {
        return res.status(400).json({ 
          error: "Shopify not configured", 
          message: "Please configure Shopify integration in Data Sources" 
        });
      }

      const result = await shopifyInventorySync.pullAllInventoryFromShopify(userId);
      
      res.json({
        success: true,
        message: `Pulled inventory for ${result.updated} products from Shopify`,
        ...result,
      });
    } catch (error: any) {
      console.error('[Shopify Pull] Error pulling inventory:', error);
      res.status(500).json({ error: error.message || 'Failed to pull inventory from Shopify' });
    }
  });

  // ============================================================================
  // MIGRATION ENDPOINT: Set isHistorical for existing records based on terminal status
  // ============================================================================
  app.post("/api/admin/migrate-historical-status", requireAuth, async (req: Request, res: Response) => {
    try {
      const { isPOStatusTerminal, isSalesOrderStatusTerminal, isReturnStatusTerminal } = await import("@shared/schema");
      
      let poCount = 0;
      let soCount = 0;
      let returnCount = 0;
      
      // Migrate Purchase Orders
      const allPOs = await storage.getAllPurchaseOrders();
      for (const po of allPOs) {
        if (!po.isHistorical && isPOStatusTerminal(po.status)) {
          await storage.updatePurchaseOrder(po.id, { 
            isHistorical: true, 
            archivedAt: po.receivedAt || po.closedAt || po.cancelledAt || new Date()
          });
          poCount++;
        }
      }
      
      // Migrate Sales Orders
      const allSOs = await storage.getAllSalesOrders();
      for (const so of allSOs) {
        if (!so.isHistorical && isSalesOrderStatusTerminal(so.status)) {
          await storage.updateSalesOrder(so.id, { 
            isHistorical: true, 
            archivedAt: so.fulfilledAt || so.cancelledAt || new Date()
          });
          soCount++;
        }
      }
      
      // Migrate Return Requests
      const allReturns = await storage.getAllReturnRequests();
      for (const ret of allReturns) {
        if (!ret.isHistorical && isReturnStatusTerminal(ret.status)) {
          await storage.updateReturnRequest(ret.id, { 
            isHistorical: true, 
            archivedAt: ret.closedAt || ret.refundedAt || new Date()
          });
          returnCount++;
        }
      }
      
      res.json({
        success: true,
        message: "Migration completed",
        migratedCounts: {
          purchaseOrders: poCount,
          salesOrders: soCount,
          returnRequests: returnCount,
        }
      });
    } catch (error: any) {
      console.error("[Migration] Error migrating historical status:", error);
      res.status(500).json({ error: error.message || "Failed to migrate historical status" });
    }
  });

  // ============================================================================
  // CUSTOM DASHBOARDS & WIDGETS API
  // ============================================================================

  // Get or create user's default report widgets with trend data
  app.get("/api/report-widgets", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      
      // Get or create the user's default dashboard
      let dashboards = await storage.getCustomDashboardsByUserId(userId);
      let defaultDashboard = dashboards.find(d => d.isDefault);
      
      if (!defaultDashboard) {
        // Create a default dashboard if none exists
        defaultDashboard = await storage.createCustomDashboard({
          userId,
          name: "My Reports",
          description: "Default report widgets",
          isDefault: true,
        });
      }
      
      // Get widgets for the default dashboard
      const widgets = await storage.getWidgetsByDashboardId(defaultDashboard.id);
      
      // Calculate trends for each widget
      const widgetsWithTrends = await Promise.all(widgets.map(async (widget) => {
        const trend = await calculateWidgetTrend(widget, storage);
        return { ...widget, trend };
      }));
      
      res.json({ 
        dashboardId: defaultDashboard.id,
        widgets: widgetsWithTrends 
      });
    } catch (error: any) {
      console.error("[Reports] Error fetching report widgets:", error);
      res.status(500).json({ error: error.message || "Failed to fetch report widgets" });
    }
  });

  // Add widget to user's default report
  app.post("/api/report-widgets", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      
      // Get or create the user's default dashboard
      let dashboards = await storage.getCustomDashboardsByUserId(userId);
      let defaultDashboard = dashboards.find(d => d.isDefault);
      
      if (!defaultDashboard) {
        defaultDashboard = await storage.createCustomDashboard({
          userId,
          name: "My Reports",
          description: "Default report widgets",
          isDefault: true,
        });
      }
      
      const { type, title, dataSource, config, position } = req.body;
      if (!type || !title || !dataSource) {
        return res.status(400).json({ error: "Widget type, title, and data source are required" });
      }
      
      const widget = await storage.createDashboardWidget({
        dashboardId: defaultDashboard.id,
        type,
        title,
        dataSource,
        config: config || {},
        position: position || { x: 0, y: 0, w: 1, h: 1 },
      });
      
      res.status(201).json(widget);
    } catch (error: any) {
      console.error("[Reports] Error adding report widget:", error);
      res.status(500).json({ error: error.message || "Failed to add report widget" });
    }
  });

  // Get all dashboards for the current user
  app.get("/api/dashboards", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      const dashboards = await storage.getCustomDashboardsByUserId(userId);
      res.json(dashboards);
    } catch (error: any) {
      console.error("[Dashboards] Error fetching dashboards:", error);
      res.status(500).json({ error: error.message || "Failed to fetch dashboards" });
    }
  });

  // Get a single dashboard with its widgets
  app.get("/api/dashboards/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      const dashboard = await storage.getCustomDashboard(req.params.id);
      if (!dashboard) {
        return res.status(404).json({ error: "Dashboard not found" });
      }
      if (dashboard.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }
      const widgets = await storage.getWidgetsByDashboardId(dashboard.id);
      res.json({ ...dashboard, widgets });
    } catch (error: any) {
      console.error("[Dashboards] Error fetching dashboard:", error);
      res.status(500).json({ error: error.message || "Failed to fetch dashboard" });
    }
  });

  // Create a new dashboard
  app.post("/api/dashboards", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      const { name, description, layout } = req.body;
      if (!name) {
        return res.status(400).json({ error: "Dashboard name is required" });
      }
      const dashboard = await storage.createCustomDashboard({
        userId,
        name,
        description,
        layout,
        isDefault: false,
      });
      res.status(201).json(dashboard);
    } catch (error: any) {
      console.error("[Dashboards] Error creating dashboard:", error);
      res.status(500).json({ error: error.message || "Failed to create dashboard" });
    }
  });

  // Update a dashboard
  app.patch("/api/dashboards/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      const dashboard = await storage.getCustomDashboard(req.params.id);
      if (!dashboard) {
        return res.status(404).json({ error: "Dashboard not found" });
      }
      if (dashboard.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }
      const { name, description, layout, isDefault } = req.body;
      const updated = await storage.updateCustomDashboard(req.params.id, {
        name,
        description,
        layout,
        isDefault,
      });
      res.json(updated);
    } catch (error: any) {
      console.error("[Dashboards] Error updating dashboard:", error);
      res.status(500).json({ error: error.message || "Failed to update dashboard" });
    }
  });

  // Delete a dashboard
  app.delete("/api/dashboards/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      const dashboard = await storage.getCustomDashboard(req.params.id);
      if (!dashboard) {
        return res.status(404).json({ error: "Dashboard not found" });
      }
      if (dashboard.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }
      await storage.deleteCustomDashboard(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("[Dashboards] Error deleting dashboard:", error);
      res.status(500).json({ error: error.message || "Failed to delete dashboard" });
    }
  });

  // Add a widget to a dashboard
  app.post("/api/dashboards/:id/widgets", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      const dashboard = await storage.getCustomDashboard(req.params.id);
      if (!dashboard) {
        return res.status(404).json({ error: "Dashboard not found" });
      }
      if (dashboard.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }
      const { type, title, dataSource, config, position } = req.body;
      if (!type || !title || !dataSource || !config || !position) {
        return res.status(400).json({ error: "Missing required widget fields" });
      }
      const widget = await storage.createDashboardWidget({
        dashboardId: req.params.id,
        type,
        title,
        dataSource,
        config,
        position,
      });
      res.status(201).json(widget);
    } catch (error: any) {
      console.error("[Dashboards] Error creating widget:", error);
      res.status(500).json({ error: error.message || "Failed to create widget" });
    }
  });

  // Update a widget
  app.patch("/api/widgets/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      const widget = await storage.getDashboardWidget(req.params.id);
      if (!widget) {
        return res.status(404).json({ error: "Widget not found" });
      }
      const dashboard = await storage.getCustomDashboard(widget.dashboardId);
      if (!dashboard || dashboard.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }
      const { type, title, dataSource, config, position } = req.body;
      const updated = await storage.updateDashboardWidget(req.params.id, {
        type,
        title,
        dataSource,
        config,
        position,
      });
      res.json(updated);
    } catch (error: any) {
      console.error("[Dashboards] Error updating widget:", error);
      res.status(500).json({ error: error.message || "Failed to update widget" });
    }
  });

  // Delete a widget
  app.delete("/api/widgets/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      const widget = await storage.getDashboardWidget(req.params.id);
      if (!widget) {
        return res.status(404).json({ error: "Widget not found" });
      }
      const dashboard = await storage.getCustomDashboard(widget.dashboardId);
      if (!dashboard || dashboard.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }
      await storage.deleteDashboardWidget(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("[Dashboards] Error deleting widget:", error);
      res.status(500).json({ error: error.message || "Failed to delete widget" });
    }
  });

  // Bulk update widget positions (for drag-and-drop)
  app.post("/api/dashboards/:id/widgets/positions", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      const dashboard = await storage.getCustomDashboard(req.params.id);
      if (!dashboard) {
        return res.status(404).json({ error: "Dashboard not found" });
      }
      if (dashboard.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }
      const { updates } = req.body;
      if (!Array.isArray(updates)) {
        return res.status(400).json({ error: "Updates must be an array" });
      }
      await storage.bulkUpdateWidgetPositions(updates);
      res.json({ success: true });
    } catch (error: any) {
      console.error("[Dashboards] Error updating widget positions:", error);
      res.status(500).json({ error: error.message || "Failed to update widget positions" });
    }
  });

  // Get widget data based on data source
  app.get("/api/widgets/:id/data", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      const widget = await storage.getDashboardWidget(req.params.id);
      if (!widget) {
        return res.status(404).json({ error: "Widget not found" });
      }
      const dashboard = await storage.getCustomDashboard(widget.dashboardId);
      if (!dashboard || dashboard.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }
      
      // Fetch data based on data source
      let data: any = null;
      const config = widget.config as any;
      
      switch (widget.dataSource) {
        case "ITEMS":
          const items = await storage.getAllItems();
          data = processWidgetData(items, config, widget.type);
          break;
        case "SALES_ORDERS":
          const salesOrders = await storage.getAllSalesOrders();
          data = processWidgetData(salesOrders, config, widget.type);
          break;
        case "PURCHASE_ORDERS":
          const purchaseOrders = await storage.getAllPurchaseOrders();
          data = processWidgetData(purchaseOrders, config, widget.type);
          break;
        case "RETURNS":
          const returns = await storage.getAllReturnRequests();
          data = processWidgetData(returns, config, widget.type);
          break;
        case "SUPPLIERS":
          const suppliers = await storage.getAllSuppliers();
          data = processWidgetData(suppliers, config, widget.type);
          break;
        case "INVENTORY_TRANSACTIONS":
          const transactions = await storage.getAllInventoryTransactions();
          data = processWidgetData(transactions.slice(-100), config, widget.type);
          break;
        case "AI_RECOMMENDATIONS":
          const recommendations = await storage.getActiveAIRecommendations();
          data = processWidgetData(recommendations, config, widget.type);
          break;
        case "SYSTEM_LOGS":
          const logs = await storage.getAllSystemLogs();
          data = processWidgetData(logs.slice(0, 100), config, widget.type);
          break;
        default:
          data = [];
      }
      
      res.json({ data });
    } catch (error: any) {
      console.error("[Dashboards] Error fetching widget data:", error);
      res.status(500).json({ error: error.message || "Failed to fetch widget data" });
    }
  });

  // ============================================================================
  // NOTIFICATIONS API
  // ============================================================================

  // Get all notifications for current user
  app.get("/api/notifications", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      const unreadOnly = req.query.unreadOnly === "true";
      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
      
      const notifications = await storage.getNotificationsByUserId(userId, { unreadOnly, limit });
      const unreadCount = await storage.getUnreadNotificationCount(userId);
      
      res.json({ notifications, unreadCount });
    } catch (error: any) {
      console.error("[Notifications] Error fetching notifications:", error);
      res.status(500).json({ error: error.message || "Failed to fetch notifications" });
    }
  });

  // Get unread count only (for badge)
  app.get("/api/notifications/count", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      const count = await storage.getUnreadNotificationCount(userId);
      res.json({ count });
    } catch (error: any) {
      console.error("[Notifications] Error fetching count:", error);
      res.status(500).json({ error: error.message || "Failed to fetch notification count" });
    }
  });

  // Mark notification as read
  app.patch("/api/notifications/:id/read", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      const notification = await storage.getNotification(req.params.id);
      if (!notification) {
        return res.status(404).json({ error: "Notification not found" });
      }
      if (notification.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }
      const updated = await storage.markNotificationAsRead(req.params.id);
      res.json(updated);
    } catch (error: any) {
      console.error("[Notifications] Error marking as read:", error);
      res.status(500).json({ error: error.message || "Failed to mark notification as read" });
    }
  });

  // Mark all notifications as read
  app.post("/api/notifications/mark-all-read", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      await storage.markAllNotificationsAsRead(userId);
      res.json({ success: true });
    } catch (error: any) {
      console.error("[Notifications] Error marking all as read:", error);
      res.status(500).json({ error: error.message || "Failed to mark all notifications as read" });
    }
  });

  // Delete a notification
  app.delete("/api/notifications/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      const notification = await storage.getNotification(req.params.id);
      if (!notification) {
        return res.status(404).json({ error: "Notification not found" });
      }
      if (notification.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }
      await storage.deleteNotification(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("[Notifications] Error deleting notification:", error);
      res.status(500).json({ error: error.message || "Failed to delete notification" });
    }
  });

  // ============================================================================
  // USER TABLE PREFERENCES API
  // ============================================================================

  // Get table preferences
  app.get("/api/table-preferences/:tableId", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      const prefs = await storage.getTablePreferences(userId, req.params.tableId);
      res.json(prefs || { visibleColumns: null, columnOrder: null });
    } catch (error: any) {
      console.error("[TablePreferences] Error fetching preferences:", error);
      res.status(500).json({ error: error.message || "Failed to fetch table preferences" });
    }
  });

  // Save table preferences
  app.post("/api/table-preferences/:tableId", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      const { visibleColumns, columnOrder } = req.body;
      const prefs = await storage.upsertTablePreferences({
        userId,
        tableId: req.params.tableId,
        visibleColumns,
        columnOrder,
      });
      res.json(prefs);
    } catch (error: any) {
      console.error("[TablePreferences] Error saving preferences:", error);
      res.status(500).json({ error: error.message || "Failed to save table preferences" });
    }
  });

  const httpServer = createServer(app);
  
  // Initialize AI Batch Scheduler for scheduled runs at 10:00 AM and 3:00 PM Mountain time
  import("./services/ai-batch-scheduler").then(({ initializeScheduler }) => {
    initializeScheduler();
    console.log("[Server] AI Batch Scheduler initialized");
  }).catch((error) => {
    console.error("[Server] Failed to initialize AI Batch Scheduler:", error);
  });
  
  // Initialize Credential Rotation Scheduler for daily checks at 6:00 AM Mountain time
  import("./services/credential-rotation-scheduler").then(({ initializeRotationScheduler }) => {
    initializeRotationScheduler();
    console.log("[Server] Credential Rotation Scheduler initialized");
  }).catch((error) => {
    console.error("[Server] Failed to initialize Credential Rotation Scheduler:", error);
  });
  
  // Initialize Shopify Reconciliation Scheduler for Tuesday & Thursday at 9:00 AM Mountain time
  import("./services/shopify-reconciliation-scheduler").then(({ initializeShopifyReconciliationScheduler }) => {
    initializeShopifyReconciliationScheduler();
    console.log("[Server] Shopify Reconciliation Scheduler initialized");
  }).catch((error) => {
    console.error("[Server] Failed to initialize Shopify Reconciliation Scheduler:", error);
  });
  
  // Initialize Daily Sales Scheduler for nightly aggregation at 11:59 PM Mountain time
  import("./services/daily-sales-scheduler").then(({ initializeDailySalesScheduler }) => {
    initializeDailySalesScheduler();
    console.log("[Server] Daily Sales Scheduler initialized");
  }).catch((error) => {
    console.error("[Server] Failed to initialize Daily Sales Scheduler:", error);
  });
  
  // Startup webhook auto-registration for Shopify (non-blocking)
  (async () => {
    try {
      const users = await storage.getAllUsers();
      if (users.length === 0) {
        console.log("[Server] Shopify Webhooks: No users yet, skipping webhook registration");
        return;
      }
      
      const config = await storage.getIntegrationConfig(users[0].id, 'SHOPIFY');
      const shopDomain = (config?.config as any)?.shopDomain || process.env.SHOPIFY_SHOP_DOMAIN;
      const accessToken = config?.apiKey || process.env.SHOPIFY_ACCESS_TOKEN;
      
      if (!shopDomain || !accessToken) {
        console.log("[Server] Shopify Webhooks: No credentials configured, skipping auto-registration");
        return;
      }
      
      const apiVersion = (config?.config as any)?.apiVersion || '2024-01';
      const { ensureWebhooks } = await import('./shopify/webhook-admin');
      const result = await ensureWebhooks(shopDomain, accessToken, apiVersion);
      
      console.log(`[Server] Shopify Webhooks: Auto-registration completed - ${result.registered} registered, ${result.existing} existing, ${result.failed} failed`);
    } catch (error: any) {
      console.warn("[Server] Shopify Webhooks: Auto-registration failed (non-blocking):", error.message);
    }
  })();
  
  return httpServer;
}
