import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { LLMService } from "./services/llm";
import { BarcodeService } from "./services/barcode";
import bcrypt from "bcrypt";
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
  insertBarcodeSchema,
} from "@shared/schema";

const SALT_ROUNDS = 10;

export async function registerRoutes(app: Express): Promise<Server> {
  // ============================================================================
  // DASHBOARD
  // ============================================================================
  
  app.get("/api/dashboard", async (req: Request, res: Response) => {
    try {
      const items = await storage.getAllItems();
      const suppliers = await storage.getAllSuppliers();
      const integrations = await storage.getAllIntegrationHealth();
      const components = items.filter(item => item.type === "component");
      const finishedProducts = items.filter(item => item.type === "finished_product");

      // Calculate metrics
      const inventoryValue = items.reduce((sum, item) => sum + (item.currentStock * 10), 0); // Mock pricing
      
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

      // Get at-risk items
      const atRiskItems = components
        .map(item => ({
          ...item,
          daysOfCover: item.dailyUsage > 0 ? Math.floor(item.currentStock / item.dailyUsage) : 999,
        }))
        .filter(item => item.daysOfCover < 30)
        .sort((a, b) => a.daysOfCover - b.daysOfCover)
        .slice(0, 5);

      // Count active alerts
      const activeAlerts = atRiskItems.filter(item => item.daysOfCover < 7).length;

      // Format integrations
      const formattedIntegrations = integrations.map(integration => ({
        name: integration.integrationName.charAt(0).toUpperCase() + integration.integrationName.slice(1),
        status: integration.lastStatus || "unknown",
        lastSync: integration.lastSuccessAt 
          ? new Date(integration.lastSuccessAt).toLocaleString()
          : "Never",
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
  // ITEMS
  // ============================================================================
  
  app.get("/api/items", async (req: Request, res: Response) => {
    try {
      const items = await storage.getAllItems();
      res.json(items);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch items" });
    }
  });

  app.get("/api/items/:id", async (req: Request, res: Response) => {
    try {
      const item = await storage.getItem(req.params.id);
      if (!item) {
        return res.status(404).json({ error: "Item not found" });
      }
      res.json(item);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch item" });
    }
  });

  app.post("/api/items", async (req: Request, res: Response) => {
    try {
      const validated = insertItemSchema.parse(req.body);
      const item = await storage.createItem(validated);
      res.status(201).json(item);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Invalid item data" });
    }
  });

  app.patch("/api/items/:id", async (req: Request, res: Response) => {
    try {
      const item = await storage.updateItem(req.params.id, req.body);
      if (!item) {
        return res.status(404).json({ error: "Item not found" });
      }
      res.json(item);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to update item" });
    }
  });

  app.delete("/api/items/:id", async (req: Request, res: Response) => {
    try {
      const success = await storage.deleteItem(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Item not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete item" });
    }
  });

  // ============================================================================
  // PRODUCTS (Finished Products with BOM)
  // ============================================================================
  
  app.get("/api/products", async (req: Request, res: Response) => {
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

  app.post("/api/products", async (req: Request, res: Response) => {
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
  
  app.get("/api/bins", async (req: Request, res: Response) => {
    try {
      const bins = await storage.getAllBins();
      res.json(bins);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch bins" });
    }
  });

  app.post("/api/bins", async (req: Request, res: Response) => {
    try {
      const validated = insertBinSchema.parse(req.body);
      const bin = await storage.createBin(validated);
      res.status(201).json(bin);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Invalid bin data" });
    }
  });

  // ============================================================================
  // BARCODES
  // ============================================================================
  
  app.get("/api/barcodes", async (req: Request, res: Response) => {
    try {
      const barcodes = await storage.getAllBarcodes();
      res.json(barcodes);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch barcodes" });
    }
  });

  app.post("/api/barcodes", async (req: Request, res: Response) => {
    try {
      const validated = insertBarcodeSchema.parse(req.body);
      const barcode = await storage.createBarcode(validated);
      res.status(201).json(barcode);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Invalid barcode data" });
    }
  });

  app.get("/api/barcodes/:id/image", async (req: Request, res: Response) => {
    try {
      const barcode = await storage.getBarcode(req.params.id);
      if (!barcode) {
        return res.status(404).json({ error: "Barcode not found" });
      }
      
      const image = await BarcodeService.generateBarcode({ value: barcode.value });
      res.json(image);
    } catch (error) {
      res.status(500).json({ error: "Failed to generate barcode image" });
    }
  });

  app.get("/api/barcodes/lookup/:value", async (req: Request, res: Response) => {
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

  // ============================================================================
  // SUPPLIERS
  // ============================================================================
  
  app.get("/api/suppliers", async (req: Request, res: Response) => {
    try {
      const suppliers = await storage.getAllSuppliers();
      res.json(suppliers);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch suppliers" });
    }
  });

  app.post("/api/suppliers", async (req: Request, res: Response) => {
    try {
      const validated = insertSupplierSchema.parse(req.body);
      const supplier = await storage.createSupplier(validated);
      res.status(201).json(supplier);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Invalid supplier data" });
    }
  });

  // ============================================================================
  // SETTINGS
  // ============================================================================
  
  app.get("/api/settings", async (req: Request, res: Response) => {
    try {
      // For demo, use first user
      const users = await storage.getAllItems();
      const userId = "demo-user-id"; // In production, get from session
      
      const settings = await storage.getSettings(userId);
      res.json(settings || {});
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  app.post("/api/settings", async (req: Request, res: Response) => {
    try {
      const userId = "demo-user-id"; // In production, get from session
      const validated = insertSettingsSchema.parse({ ...req.body, userId });
      const settings = await storage.createOrUpdateSettings(validated);
      res.json(settings);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Invalid settings data" });
    }
  });

  // ============================================================================
  // INTEGRATIONS (Stubs)
  // ============================================================================
  
  // GoHighLevel - Sync sales history
  app.post("/api/integrations/gohighlevel/sync", async (req: Request, res: Response) => {
    try {
      // Stub implementation - would call GoHighLevel API
      await storage.createOrUpdateIntegrationHealth({
        integrationName: "gohighlevel",
        lastSuccessAt: new Date(),
        lastStatus: "success",
        lastAlertAt: null,
        errorMessage: null,
      });
      
      res.json({ success: true, message: "Sales history sync initiated (stub)" });
    } catch (error) {
      res.status(500).json({ error: "Integration sync failed" });
    }
  });

  // Extensiv/Pivot - Sync finished inventory
  app.post("/api/integrations/extensiv/sync", async (req: Request, res: Response) => {
    try {
      // Stub implementation - would call Extensiv API
      await storage.createOrUpdateIntegrationHealth({
        integrationName: "extensiv",
        lastSuccessAt: new Date(),
        lastStatus: "success",
        lastAlertAt: null,
        errorMessage: null,
      });
      
      res.json({ success: true, message: "Finished inventory sync initiated (stub)" });
    } catch (error) {
      res.status(500).json({ error: "Integration sync failed" });
    }
  });

  // PhantomBuster - Update supplier data
  app.post("/api/integrations/phantombuster/sync", async (req: Request, res: Response) => {
    try {
      // Stub implementation - would call PhantomBuster API
      await storage.createOrUpdateIntegrationHealth({
        integrationName: "phantombuster",
        lastSuccessAt: new Date(),
        lastStatus: "success",
        lastAlertAt: null,
        errorMessage: null,
      });
      
      res.json({ success: true, message: "Supplier data sync initiated (stub)" });
    } catch (error) {
      res.status(500).json({ error: "Integration sync failed" });
    }
  });

  // ============================================================================
  // LLM
  // ============================================================================
  
  app.post("/api/llm/ask", async (req: Request, res: Response) => {
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

  const httpServer = createServer(app);
  return httpServer;
}
