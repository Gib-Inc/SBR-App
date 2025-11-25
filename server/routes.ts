import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { LLMService, type LLMProvider } from "./services/llm";
import { BarcodeService } from "./services/barcode";
import { BarcodeGenerator } from "./barcode-generator";
import { ImportService } from "./import-service";
import { TransactionService } from "./transaction-service";
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
  type Item,
} from "@shared/schema";
import { createReturnLabelService } from "./return-label-service";

const SALT_ROUNDS = 10;

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
      req.session.destroy((err) => {
        if (err) {
          console.error("Error destroying session:", err);
          return res.status(500).json({ error: "Failed to logout" });
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
      res.status(201).json(supplier);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Invalid supplier data" });
    }
  });

  app.patch("/api/suppliers/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const validated = updateSupplierSchema.parse(req.body);
      const supplier = await storage.updateSupplier(req.params.id, validated);
      if (!supplier) {
        return res.status(404).json({ error: "Supplier not found" });
      }
      res.json(supplier);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to update supplier" });
    }
  });

  app.delete("/api/suppliers/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const success = await storage.deleteSupplier(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Supplier not found" });
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
      const success = await storage.deleteSupplierItem(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Supplier item not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete supplier item" });
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
      res.json(settings || {});
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
      
      res.json(updated);
    } catch (error: any) {
      console.error("Settings update error:", error);
      res.status(400).json({ error: error.message || "Invalid settings data" });
    }
  });

  // ============================================================================
  // INTEGRATIONS (Stubs)
  // ============================================================================
  
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

  // Extensiv/Pivot - Sync finished inventory
  app.post("/api/integrations/extensiv/sync", requireAuth, async (req: Request, res: Response) => {
    try {
      // Stub implementation - would call Extensiv API
      
      // Simulate successful connection
      await storage.createOrUpdateIntegrationHealth({
        integrationName: "extensiv",
        lastSuccessAt: new Date(),
        lastStatus: "connected",
        lastAlertAt: null,
        errorMessage: null,
      });
      
      res.json({ success: true, message: "Finished inventory sync initiated (stub)" });
    } catch (error: any) {
      // Record failure in integration health
      await storage.createOrUpdateIntegrationHealth({
        integrationName: "extensiv",
        lastStatus: "failed",
        errorMessage: error.message || "Integration sync failed",
      });
      res.status(500).json({ error: error.message || "Integration sync failed" });
    }
  });

  // PhantomBuster - Update supplier data
  app.post("/api/integrations/phantombuster/sync", requireAuth, async (req: Request, res: Response) => {
    try {
      // Stub implementation - would call PhantomBuster API
      
      // Simulate successful connection
      await storage.createOrUpdateIntegrationHealth({
        integrationName: "phantombuster",
        lastSuccessAt: new Date(),
        lastStatus: "connected",
        lastAlertAt: null,
        errorMessage: null,
      });
      
      res.json({ success: true, message: "Supplier data sync initiated (stub)" });
    } catch (error: any) {
      // Record failure in integration health
      await storage.createOrUpdateIntegrationHealth({
        integrationName: "phantombuster",
        lastStatus: "failed",
        errorMessage: error.message || "Integration sync failed",
      });
      res.status(500).json({ error: error.message || "Integration sync failed" });
    }
  });

  // ============================================================================
  // LLM
  // ============================================================================
  
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

      if (lines && Array.isArray(lines)) {
        for (const line of lines) {
          // Determine location based on item type for proper AI recommendation lookup
          const item = await storage.getItem(line.itemId);
          const location = item?.type === 'finished_product' ? 'PIVOT' : null;
          
          // Find the latest AI recommendation for this item using the storage helper
          const latestRecommendation = await storage.getLatestAIRecommendationForItem(
            line.itemId,
            location
          );
          
          const validatedLine = insertPurchaseOrderLineSchema.parse({
            ...line,
            purchaseOrderId: purchaseOrder.id,
            aiRecommendationId: latestRecommendation?.id || null,
            recommendedQtyAtOrderTime: latestRecommendation?.recommendedQty || null,
            finalOrderedQty: line.quantity,
          });
          await storage.createPurchaseOrderLine(validatedLine);
        }
      }

      const createdLines = await storage.getPurchaseOrderLinesByPOId(purchaseOrder.id);
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

        // Create RECEIVE transaction
        const item = await storage.getItem(line.itemId);
        if (item) {
          await transactionService.applyTransaction({
            itemId: line.itemId,
            itemType: item.type === 'finished_product' ? 'FINISHED' : 'RAW',
            type: 'RECEIVE',
            location: 'HILDALE', // Default to HILDALE for PO receipts
            quantity: qtyToReceive,
            notes: `Received from PO ${po.poNumber}`,
            createdBy: req.session.userId || 'system',
          });

          // Mark item for forecast refresh
          await storage.updateItem(line.itemId, { forecastDirty: true });
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
      
      // Create RECEIVE transactions for any remaining unreceived quantities
      for (const line of lines) {
        const remaining = line.qtyOrdered - line.qtyReceived;
        if (remaining > 0) {
          const item = await storage.getItem(line.itemId);
          if (item) {
            await transactionService.applyTransaction({
              itemId: line.itemId,
              itemType: item.type === 'finished_product' ? 'FINISHED' : 'RAW',
              type: 'RECEIVE',
              location: 'HILDALE', // Default location
              quantity: remaining,
              notes: `Auto-confirmed receipt from PO ${po.poNumber}`,
              createdBy: req.session.userId || 'system',
            });

            // Mark item for forecast refresh
            await storage.updateItem(line.itemId, { forecastDirty: true });
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
          const itemType = item.type === 'finished_product' ? 'FINISHED' as const : 'RAW' as const;
          const location = itemType === 'RAW' ? 'N/A' as const : 'HILDALE' as const;
          
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

      // Step 2: Apply all transactions atomically
      const processedLines = [];
      for (const { line, item, itemType, location, remaining } of linesToProcess) {
        try {
          // Use TransactionService to apply RECEIVE transaction
          const result = await transactionService.applyTransaction({
            itemId: line.itemId,
            itemType,
            type: 'RECEIVE',
            location,
            quantity: remaining,
            notes: `Bulk confirm receipt for PO ${po.poNumber}`,
            createdBy: 'system',
          });

          if (!result.success) {
            // If any transaction fails, abort and return error
            return res.status(400).json({ 
              success: false,
              error: `Failed to receive item "${item.name}": ${result.error}`,
            });
          }

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

  app.post("/api/supplier-leads/import-phantombuster", requireAuth, async (req: Request, res: Response) => {
    try {
      res.status(501).json({ 
        error: "PhantomBuster integration not implemented yet",
        note: "This endpoint is a placeholder for PhantomBuster web scraping integration. Implementation must comply with PhantomBuster Terms of Service and target website robots.txt/terms."
      });
    } catch (error: any) {
      console.error("[SupplierLead] Error importing from PhantomBuster:", error);
      res.status(500).json({ error: "Failed to import from PhantomBuster" });
    }
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
  // Body: { externalOrderId, salesChannel, customerName, customerEmail?, customerPhone?, ghlContactId?, resolutionRequested, reason, items: [{ inventoryItemId or sku, qtyRequested }] }
  // Returns: ReturnRequest with id for GHL to store
  app.post("/api/returns", requireAuth, async (req: Request, res: Response) => {
    try {
      const { items: itemsData, ...requestData } = req.body;

      // Validate return request data
      const validatedRequest = insertReturnRequestSchema.parse(requestData);
      
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
          inventoryItemId,
          sku: item.sku,
          qtyRequested: itemData.qtyRequested,
          qtyApproved: itemData.qtyRequested, // Default: approve requested qty
        });

        returnItems.push(returnItem);
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
      if (!['OPEN', 'LABEL_ISSUED'].includes(returnRequest.status)) {
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
      await storage.updateReturnRequest(id, {
        status: 'LABEL_ISSUED',
      });

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
  // Body: { items: [{ returnItemId, qtyReceived, disposition }], resolutionFinal? }
  // Updates inventory for RESTOCK items using TransactionService
  app.post("/api/returns/:id/receive", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { items: receivedItems, resolutionFinal } = req.body;

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

      // Process each received item
      // TODO: For true atomicity, wrap in database transaction
      // For now, validate everything first, then apply (same pattern as PO bulk receive)
      for (const receivedItem of receivedItems) {
        const returnItem = returnItems.find(ri => ri.id === receivedItem.returnItemId);
        if (!returnItem) continue;

        // Update return item with received qty and disposition
        await storage.updateReturnItem(receivedItem.returnItemId, {
          qtyReceived: receivedItem.qtyReceived,
          disposition: receivedItem.disposition,
          notes: receivedItem.notes || null,
        });

        // If disposition is RESTOCK, update inventory using TransactionService
        if (receivedItem.disposition === 'RESTOCK') {
          const item = await storage.getItem(returnItem.inventoryItemId);
          if (!item) continue;

          // For finished products, restock to Hildale (buffer stock)
          // For components, update currentStock
          if (item.type === 'finished_product') {
            await TransactionService.createTransaction({
              itemId: item.id,
              type: 'RECEIVE',
              quantity: receivedItem.qtyReceived,
              location: 'HILDALE',
              referenceType: 'RETURN',
              referenceId: id,
              notes: `Restocked from return ${returnRequest.externalOrderId}`,
            });
          } else {
            await TransactionService.createTransaction({
              itemId: item.id,
              type: 'RECEIVE',
              quantity: receivedItem.qtyReceived,
              referenceType: 'RETURN',
              referenceId: id,
              notes: `Restocked from return ${returnRequest.externalOrderId}`,
            });
          }
        }
      }

      // Update return request status
      const updates: any = { status: 'RECEIVED' };
      if (resolutionFinal) {
        updates.resolutionFinal = resolutionFinal;
        if (resolutionFinal === 'REFUNDED') {
          updates.status = 'REFUNDED';
        } else if (resolutionFinal === 'REPLACED') {
          updates.status = 'REPLACED';
        }
      }

      const updatedRequest = await storage.updateReturnRequest(id, updates);

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

  const httpServer = createServer(app);
  return httpServer;
}
