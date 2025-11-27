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
import { PhantomBusterClient } from "./services/phantombuster-client";
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
  type Item,
  type SalesOrderLine,
} from "@shared/schema";
import { createReturnLabelService } from "./return-label-service";
import { InventoryDecisionEngine } from "./services/inventory-decision-engine";
import { InventoryMovement } from "./services/inventory-movement";

const SALT_ROUNDS = 10;

// Create a single instance of the decision engine
const decisionEngine = new InventoryDecisionEngine(storage);

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
    } catch (error) {
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
      const config = await storage.getIntegrationConfig(userId, provider);
      
      if (!config) {
        return res.status(404).json({ error: "Integration config not found" });
      }
      
      // Sanitize config before sending to client
      res.json(sanitizeIntegrationConfig(config));
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch integration config" });
    }
  });

  // Create new integration config
  app.post("/api/integration-configs", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const { provider, accountName, apiKey, config } = req.body;

      if (!provider) {
        return res.status(400).json({ error: "Provider is required" });
      }

      // Check if config already exists
      const existing = await storage.getIntegrationConfig(userId, provider.toUpperCase());
      if (existing) {
        return res.status(409).json({ error: "Integration config already exists" });
      }

      const newConfig = await storage.createIntegrationConfig({
        userId,
        provider: provider.toUpperCase(),
        accountName: accountName || null,
        apiKey: apiKey || null,
        isEnabled: true,
        config: config || null,
      });

      // Log integration config creation
      try {
        const user = await storage.getUser(userId);
        await AuditLogger.logIntegrationConfigUpdated({
          integrationType: provider.toUpperCase(),
          integrationName: accountName || provider.toUpperCase(),
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
  
  // GoHighLevel - Sync sales history
  app.post("/api/integrations/gohighlevel/sync", requireAuth, async (req: Request, res: Response) => {
    try {
      // Stub implementation - would call GoHighLevel API
      // In a real implementation, you'd make the API call here and catch errors
      
      // Simulate successful connection
      await storage.createOrUpdateIntegrationHealth({
        integrationName: "gohighlevel",
        lastSuccessAt: new Date(),
        lastStatus: "connected",
        lastAlertAt: null,
        errorMessage: null,
      });
      
      res.json({ success: true, message: "Sales history sync initiated (stub)" });
    } catch (error: any) {
      // Record failure in integration health
      await storage.createOrUpdateIntegrationHealth({
        integrationName: "gohighlevel",
        lastStatus: "failed",
        errorMessage: error.message || "Integration sync failed",
      });
      res.status(500).json({ error: error.message || "Integration sync failed" });
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
  app.post("/api/integrations/extensiv/sync", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      
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

      let syncedCount = 0;
      const unmatchedSkus: string[] = [];
      const errors: string[] = [];

      // Update Pivot quantities for matching SKUs using InventoryMovement for centralized updates
      const inventoryMovement = new InventoryMovement(storage);
      const user = await storage.getUser(userId);
      
      for (const extensivItem of extensivItems) {
        try {
          const item = await storage.getItemBySku(extensivItem.sku);
          
          if (!item) {
            unmatchedSkus.push(extensivItem.sku);
            continue;
          }

          // V1: Store Extensiv snapshot for variance display (read-only reconciliation)
          await storage.updateItem(item.id, {
            extensivOnHandSnapshot: extensivItem.quantity,
            extensivLastSyncAt: new Date(),
          });
          
          // Use EXTENSIV_SYNC event to update both pivotQty and availableForSaleQty
          const result = await inventoryMovement.apply({
            eventType: "EXTENSIV_SYNC",
            itemId: item.id,
            quantity: extensivItem.quantity, // New authoritative quantity from Extensiv
            location: "PIVOT",
            source: "SYSTEM",
            userId: userId,
            userName: user?.email,
            notes: `Extensiv sync: ${item.pivotQty ?? 0} → ${extensivItem.quantity}`,
          });

          if (result.success) {
            syncedCount++;
          } else {
            errors.push(`${extensivItem.sku}: ${result.error}`);
          }
        } catch (error: any) {
          errors.push(`${extensivItem.sku}: ${error.message}`);
          console.error(`[Extensiv] Failed to sync ${extensivItem.sku}:`, error);
        }
      }

      const summary = `Synced ${syncedCount} items. ${unmatchedSkus.length} unmatched SKUs${errors.length > 0 ? `, ${errors.length} errors` : ''}`;
      const hasErrors = errors.length > 0;
      
      // Update integration config status
      if (config) {
        await storage.updateIntegrationConfig(config.id, {
          lastSyncAt: new Date(),
          lastSyncStatus: hasErrors ? 'FAILED' : 'SUCCESS',
          lastSyncMessage: summary,
        });
      }

      res.json({
        success: !hasErrors,
        syncedItems: syncedCount,
        unmatchedSkus,
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

  // Shopify - Sync Recent Orders
  app.post("/api/integrations/shopify/sync", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const { daysBack = 7 } = req.body;
      
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
      
      // Set status to PENDING
      if (config) {
        await storage.updateIntegrationConfig(config.id, {
          lastSyncStatus: 'PENDING',
          lastSyncMessage: 'Sync in progress...',
        });
      }

      // Fetch recent orders from Shopify
      console.log(`[Shopify] Syncing orders from last ${daysBack} days...`);
      const normalizedOrders = await client.syncRecentOrders(daysBack);
      console.log(`[Shopify] Fetched ${normalizedOrders.length} orders`);

      let createdCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;
      const unmatchedSkus: string[] = [];
      const errors: string[] = [];
      const affectedProductIds = new Set<string>();

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
          } else {
            // Create new sales order
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
            });

            // Create order lines
            for (const lineItem of orderData.lineItems) {
              try {
                // Try to find product by SKU
                const product = await storage.getItemBySku(lineItem.sku);
                
                if (!product) {
                  unmatchedSkus.push(lineItem.sku);
                  console.warn(`[Shopify] SKU not found: ${lineItem.sku} - order ${salesOrder.id} will be created without this line`);
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
        }
      }

      // Log sync completion
      try {
        await AuditLogger.logIntegrationSync({
          source: 'SHOPIFY',
          integrationName: 'Shopify Orders',
          recordsProcessed: normalizedOrders.length,
          recordsCreated: createdCount,
          recordsUpdated: updatedCount,
          recordsSkipped: skippedCount,
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

      const summary = `Created ${createdCount}, updated ${updatedCount} orders. ${unmatchedSkus.length} unmatched SKUs${errors.length > 0 ? `, ${errors.length} errors` : ''}`;
      const hasErrors = errors.length > 0;
      
      // Update integration config status
      if (config) {
        await storage.updateIntegrationConfig(config.id, {
          lastSyncAt: new Date(),
          lastSyncStatus: hasErrors ? 'FAILED' : 'SUCCESS',
          lastSyncMessage: summary,
        });
      }

      res.json({
        success: !hasErrors,
        createdOrders: createdCount,
        updatedOrders: updatedCount,
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
      const sellerId = (config?.config as any)?.sellerId || process.env.AMAZON_SELLER_ID;
      const marketplaceId = (config?.config as any)?.marketplaceId || process.env.AMAZON_MARKETPLACE_ID || 'ATVPDKIKX0DER'; // US default
      const refreshToken = (config?.config as any)?.refreshToken || process.env.AMAZON_REFRESH_TOKEN;
      const clientId = (config?.config as any)?.clientId || process.env.AMAZON_CLIENT_ID;
      const clientSecret = (config?.config as any)?.clientSecret || process.env.AMAZON_CLIENT_SECRET;
      
      if (!sellerId || !refreshToken || !clientId || !clientSecret) {
        return res.status(400).json({ 
          success: false,
          message: "Amazon SP-API credentials not configured. Please add seller ID, refresh token, client ID, and client secret in Settings." 
        });
      }

      const client = new AmazonClient(sellerId, marketplaceId, refreshToken, clientId, clientSecret);
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
  app.post("/api/integrations/amazon/sync", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const { daysBack = 7 } = req.body;
      
      // Get credentials from integration config or environment variables
      const config = await storage.getIntegrationConfig(userId, 'AMAZON');
      const sellerId = (config?.config as any)?.sellerId || process.env.AMAZON_SELLER_ID;
      const marketplaceId = (config?.config as any)?.marketplaceId || process.env.AMAZON_MARKETPLACE_ID || 'ATVPDKIKX0DER';
      const refreshToken = (config?.config as any)?.refreshToken || process.env.AMAZON_REFRESH_TOKEN;
      const clientId = (config?.config as any)?.clientId || process.env.AMAZON_CLIENT_ID;
      const clientSecret = (config?.config as any)?.clientSecret || process.env.AMAZON_CLIENT_SECRET;
      
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

      const client = new AmazonClient(sellerId, marketplaceId, refreshToken, clientId, clientSecret);
      
      // Set status to PENDING
      if (config) {
        await storage.updateIntegrationConfig(config.id, {
          lastSyncStatus: 'PENDING',
          lastSyncMessage: 'Sync in progress...',
        });
      }

      // Fetch recent orders from Amazon
      console.log(`[Amazon] Syncing orders from last ${daysBack} days...`);
      const normalizedOrders = await client.syncRecentOrders(daysBack);
      console.log(`[Amazon] Fetched ${normalizedOrders.length} orders`);

      let createdCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;
      const unmatchedSkus: string[] = [];
      const errors: string[] = [];
      const affectedProductIds = new Set<string>();

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
          } else {
            // Create new sales order
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
            });

            // Create order lines
            for (const lineItem of orderData.lineItems) {
              try {
                // Try to find product by SKU
                const product = await storage.getItemBySku(lineItem.sku);
                
                if (!product) {
                  unmatchedSkus.push(lineItem.sku);
                  console.warn(`[Amazon] SKU not found: ${lineItem.sku} - order ${salesOrder.id} will be created without this line`);
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
        }
      }

      // Log sync completion
      try {
        await AuditLogger.logIntegrationSync({
          source: 'AMAZON',
          integrationName: 'Amazon Orders',
          recordsProcessed: normalizedOrders.length,
          recordsCreated: createdCount,
          recordsUpdated: updatedCount,
          recordsSkipped: skippedCount,
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

      const summary = `Created ${createdCount}, updated ${updatedCount} orders. ${unmatchedSkus.length} unmatched SKUs${errors.length > 0 ? `, ${errors.length} errors` : ''}`;
      const hasErrors = errors.length > 0;
      
      // Update integration config status
      if (config) {
        await storage.updateIntegrationConfig(config.id, {
          lastSyncAt: new Date(),
          lastSyncStatus: hasErrors ? 'FAILED' : 'SUCCESS',
          lastSyncMessage: summary,
        });
      }

      res.json({
        success: !hasErrors,
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

  // GoHighLevel - Test Connection
  app.post("/api/integrations/gohighlevel/test", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      
      // Get credentials from integration config
      const config = await storage.getIntegrationConfig(userId, 'GOHIGHLEVEL');
      const baseUrl = (config?.config as any)?.baseUrl || 'https://rest.gohighlevel.com/v1';
      const apiKey = config?.apiKey;
      const locationId = (config?.config as any)?.locationId;
      
      if (!apiKey || !locationId) {
        return res.status(400).json({ 
          success: false,
          message: "GoHighLevel credentials not configured. Please add API key and Location ID." 
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
        message: error.message || "Failed to test GoHighLevel connection" 
      });
    }
  });

  // GoHighLevel - Sync (placeholder)
  app.post("/api/integrations/gohighlevel/sync", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      
      // Get credentials from integration config
      const config = await storage.getIntegrationConfig(userId, 'GOHIGHLEVEL');
      const baseUrl = (config?.config as any)?.baseUrl || 'https://rest.gohighlevel.com/v1';
      const apiKey = config?.apiKey;
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

      // For now, just test connection as a sync placeholder
      const result = await client.sync();
      
      // Update integration config status
      if (config) {
        await storage.updateIntegrationConfig(config.id, {
          lastSyncAt: new Date(),
          lastSyncStatus: result.success ? 'SUCCESS' : 'FAILED',
          lastSyncMessage: result.message,
        });
      }

      res.json({
        success: result.success,
        message: result.message,
      });
    } catch (error: any) {
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

  // PhantomBuster - Test Connection
  app.post("/api/integrations/phantombuster/test", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      
      // Get credentials from integration config
      const config = await storage.getIntegrationConfig(userId, 'PHANTOMBUSTER');
      const apiKey = config?.apiKey;
      
      if (!apiKey) {
        return res.status(400).json({ 
          success: false,
          message: "PhantomBuster API key not configured." 
        });
      }

      const client = new PhantomBusterClient(apiKey);
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
        message: error.message || "Failed to test PhantomBuster connection" 
      });
    }
  });

  // PhantomBuster - Sync (placeholder)
  app.post("/api/integrations/phantombuster/sync", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      
      // Get credentials from integration config
      const config = await storage.getIntegrationConfig(userId, 'PHANTOMBUSTER');
      const apiKey = config?.apiKey;
      
      if (!apiKey) {
        const message = "PhantomBuster API key not configured";
        if (config) {
          await storage.updateIntegrationConfig(config.id, {
            lastSyncAt: new Date(),
            lastSyncStatus: 'FAILED',
            lastSyncMessage: message,
          });
        }
        return res.status(400).json({ success: false, message });
      }

      const client = new PhantomBusterClient(apiKey);
      
      // Set status to PENDING
      if (config) {
        await storage.updateIntegrationConfig(config.id, {
          lastSyncStatus: 'PENDING',
          lastSyncMessage: 'Sync in progress...',
        });
      }

      // For now, just test connection as a sync placeholder
      const result = await client.sync();
      
      // Update integration config status
      if (config) {
        await storage.updateIntegrationConfig(config.id, {
          lastSyncAt: new Date(),
          lastSyncStatus: result.success ? 'SUCCESS' : 'FAILED',
          lastSyncMessage: result.message,
        });
      }

      res.json({
        success: result.success,
        message: result.message,
      });
    } catch (error: any) {
      const userId = req.session.userId!;
      const config = await storage.getIntegrationConfig(userId, 'PHANTOMBUSTER');
      
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
      
      // Prepare CSV data
      const csvHeader = "ID,Name,SKU,Product Kind,Barcode Value,Barcode Format,Barcode Usage,Barcode Source,External System,External ID,Type,Current Stock,Min Stock\n";
      const csvRows = items.map(item => 
        `${item.id},${item.name},${item.sku},${item.productKind || ''},${item.barcodeValue || ''},${item.barcodeFormat || ''},${item.barcodeUsage || ''},${item.barcodeSource || ''},${item.externalSystem || ''},${item.externalId || ''},${item.type},${item.currentStock},${item.minStock}`
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
  // PURCHASE ORDERS
  // ============================================================================

  app.get("/api/purchase-orders", requireAuth, async (req: Request, res: Response) => {
    try {
      const purchaseOrders = await storage.getAllPurchaseOrders();
      
      // Enrich with line items for table display
      const enrichedPOs = await Promise.all(
        purchaseOrders.map(async (po) => {
          const lines = await storage.getPurchaseOrderLinesByPOId(po.id);
          return { ...po, lines };
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
      const summary = {
        total: allPOs.length,
        draft: allPOs.filter(po => po.status === 'DRAFT').length,
        approvalPending: allPOs.filter(po => po.status === 'APPROVAL_PENDING').length,
        approved: allPOs.filter(po => po.status === 'APPROVED').length,
        sent: allPOs.filter(po => po.status === 'SENT').length,
        partialReceived: allPOs.filter(po => po.status === 'PARTIAL_RECEIVED').length,
        received: allPOs.filter(po => po.status === 'RECEIVED').length,
        closed: allPOs.filter(po => po.status === 'CLOSED').length,
        cancelled: allPOs.filter(po => po.status === 'CANCELLED').length,
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
      res.json({ ...purchaseOrder, lines });
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

      // Create the PO
      const purchaseOrder = await storage.createPurchaseOrder({
        poNumber,
        supplierId: finalSupplierId,
        status: 'DRAFT',
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

      res.json(updated);
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
      const validatedLine = insertPurchaseOrderLineSchema.parse(req.body);
      const line = await storage.createPurchaseOrderLine(validatedLine);
      res.status(201).json(line);
    } catch (error: any) {
      console.error("[PurchaseOrderLine] Error creating line:", error);
      res.status(400).json({ error: error.message || "Failed to create line" });
    }
  });

  app.patch("/api/purchase-order-lines/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const validatedUpdates = insertPurchaseOrderLineSchema.partial().parse(req.body);
      
      const updated = await storage.updatePurchaseOrderLine(id, validatedUpdates);
      
      if (!updated) {
        return res.status(404).json({ error: "Line not found" });
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
      const deleted = await storage.deletePurchaseOrderLine(id);
      
      if (!deleted) {
        return res.status(404).json({ error: "Line not found" });
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

  // Send PO
  app.post("/api/purchase-orders/:id/send", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const po = await storage.getPurchaseOrder(id);
      
      if (!po) {
        return res.status(404).json({ error: "Purchase order not found" });
      }

      if (po.status !== 'APPROVED') {
        return res.status(409).json({ error: `Cannot send PO in ${po.status} status. Must be APPROVED.` });
      }

      const updated = await storage.updatePurchaseOrder(id, {
        status: 'SENT',
        sentAt: new Date(),
      });

      res.json(updated);
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

  // PhantomBuster Supplier Discovery Routes
  // GET - Get available phantoms/agents
  app.get("/api/suppliers/discovery/phantombuster/agents", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const settings = await storage.getSettings(userId);
      const apiKey = settings?.phantombusterApiKey;

      if (!apiKey) {
        return res.status(400).json({ 
          success: false, 
          error: "PhantomBuster API key not configured" 
        });
      }

      const client = new PhantomBusterClient(apiKey);
      const result = await client.getAgents();
      
      res.json(result);
    } catch (error: any) {
      console.error("[SupplierDiscovery] Error fetching agents:", error);
      res.status(500).json({ 
        success: false, 
        error: error.message || "Failed to fetch agents" 
      });
    }
  });

  // POST - Launch a supplier discovery job
  app.post("/api/suppliers/discovery/phantombuster/run", requireAuth, async (req: Request, res: Response) => {
    try {
      const { agentId, keywords, location, tags, notes } = req.body;

      if (!agentId || !keywords) {
        return res.status(400).json({ 
          success: false, 
          error: "agentId and keywords are required" 
        });
      }

      const userId = req.session.userId!;
      const settings = await storage.getSettings(userId);
      const apiKey = settings?.phantombusterApiKey;

      if (!apiKey) {
        return res.status(400).json({ 
          success: false, 
          error: "PhantomBuster API key not configured" 
        });
      }

      const client = new PhantomBusterClient(apiKey);
      
      // Launch the discovery job
      const launchResult = await client.launchDiscoveryJob(agentId, {
        keywords,
        location,
        tags,
        notes,
      });

      if (!launchResult.success || !launchResult.containerId) {
        return res.status(400).json(launchResult);
      }

      // Return immediately with containerId for polling
      res.json({
        success: true,
        containerId: launchResult.containerId,
        message: "Discovery job started. Poll for results using the containerId.",
      });
    } catch (error: any) {
      console.error("[SupplierDiscovery] Error launching discovery:", error);
      res.status(500).json({ 
        success: false, 
        error: error.message || "Failed to launch discovery job" 
      });
    }
  });

  // POST - Poll for discovery results and save leads
  app.post("/api/suppliers/discovery/phantombuster/results", requireAuth, async (req: Request, res: Response) => {
    try {
      const { agentId, containerId, keywords, location, tags, notes } = req.body;

      if (!agentId || !containerId) {
        return res.status(400).json({ 
          success: false, 
          error: "agentId and containerId are required" 
        });
      }

      const userId = req.session.userId!;
      const settings = await storage.getSettings(userId);
      const apiKey = settings?.phantombusterApiKey;

      if (!apiKey) {
        return res.status(400).json({ 
          success: false, 
          error: "PhantomBuster API key not configured" 
        });
      }

      const client = new PhantomBusterClient(apiKey);
      
      // Poll for results
      const pollResult = await client.pollDiscoveryResults(agentId, containerId, {
        keywords: keywords || '',
        location,
        tags,
        notes,
      });

      if (!pollResult.success) {
        return res.status(400).json(pollResult);
      }

      // Save leads to database with deduplication
      const savedLeads = [];
      for (const lead of pollResult.leads) {
        try {
          const savedLead = await storage.upsertSupplierLead({
            name: lead.name,
            companyName: lead.companyName,
            websiteUrl: lead.websiteUrl,
            contactEmail: lead.contactEmail,
            contactPhone: lead.contactPhone,
            location: lead.location,
            source: lead.source,
            status: 'NEW',
            category: tags?.join(', '),
            notes: notes,
            rawData: lead.rawData,
            phantomRunId: containerId,
          });
          savedLeads.push(savedLead);
        } catch (err: any) {
          console.warn("[SupplierDiscovery] Error saving lead:", lead.name, err.message);
        }
      }

      res.json({
        success: true,
        leadsFound: pollResult.leads.length,
        leadsSaved: savedLeads.length,
        leads: savedLeads,
        message: `Found ${pollResult.leads.length} leads, saved ${savedLeads.length} (deduplicated)`,
      });
    } catch (error: any) {
      console.error("[SupplierDiscovery] Error polling results:", error);
      res.status(500).json({ 
        success: false, 
        error: error.message || "Failed to poll discovery results" 
      });
    }
  });

  // Legacy endpoint - redirect to new pattern
  app.post("/api/supplier-leads/import-phantombuster", requireAuth, async (req: Request, res: Response) => {
    res.status(301).json({ 
      error: "This endpoint has been replaced",
      redirect: "POST /api/suppliers/discovery/phantombuster/run",
      note: "Use the new discovery endpoints for PhantomBuster integration."
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
      const returnRequests = await storage.getAllReturnRequests();
      res.json(returnRequests);
    } catch (error: any) {
      console.error("[Returns] Error fetching returns:", error);
      res.status(500).json({ error: error.message || "Failed to fetch returns" });
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

  // ============================================================================
  // SALES ORDERS & BACKORDERS
  // ============================================================================

  // Get all sales orders with summary info
  // GET /api/sales-orders
  app.get("/api/sales-orders", requireAuth, async (req: Request, res: Response) => {
    try {
      const orders = await storage.getAllSalesOrders();
      
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

  // POST /api/quickbooks/sync-sales - Sync historical sales data
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

      // Redirect to settings page with success
      res.redirect('/settings?quickbooks=connected');
    } catch (error: any) {
      console.error('[QuickBooks] OAuth callback error:', error);
      res.redirect('/settings?quickbooks=error');
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

  const httpServer = createServer(app);
  return httpServer;
}
