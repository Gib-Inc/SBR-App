import {
  type User,
  type InsertUser,
  type Item,
  type InsertItem,
  type Bin,
  type InsertBin,
  type InventoryByBin,
  type InsertInventoryByBin,
  type BillOfMaterials,
  type InsertBillOfMaterials,
  type Supplier,
  type InsertSupplier,
  type SupplierItem,
  type InsertSupplierItem,
  type PurchaseOrder,
  type InsertPurchaseOrder,
  type PurchaseOrderLine,
  type InsertPurchaseOrderLine,
  type SupplierLead,
  type InsertSupplierLead,
  type SalesHistory,
  type InsertSalesHistory,
  type FinishedInventorySnapshot,
  type InsertFinishedInventorySnapshot,
  type IntegrationHealth,
  type InsertIntegrationHealth,
  type Settings,
  type InsertSettings,
  type Barcode,
  type InsertBarcode,
  type BarcodeSettings,
  type InsertBarcodeSettings,
  type ImportProfile,
  type InsertImportProfile,
  type ImportJob,
  type InsertImportJob,
  type InventoryTransaction,
  type InsertInventoryTransaction,
} from "@shared/schema";
import { randomUUID } from "crypto";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, and, count, sql as drizzleSql } from "drizzle-orm";
import * as schema from "@shared/schema";

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, user: Partial<InsertUser>): Promise<User | undefined>;

  // Items
  getAllItems(): Promise<Item[]>;
  getItemsWithBOMCounts(): Promise<Array<Item & { componentsCount?: number; forecastQty?: number; totalOwned?: number }>>;
  getItem(id: string): Promise<Item | undefined>;
  getItemBySku(sku: string): Promise<Item | undefined>;
  createItem(item: InsertItem): Promise<Item>;
  updateItem(id: string, item: Partial<InsertItem>): Promise<Item | undefined>;
  deleteItem(id: string): Promise<boolean>;

  // Bins
  getAllBins(): Promise<Bin[]>;
  getBin(id: string): Promise<Bin | undefined>;
  createBin(bin: InsertBin): Promise<Bin>;
  updateBin(id: string, bin: Partial<InsertBin>): Promise<Bin | undefined>;
  deleteBin(id: string): Promise<boolean>;

  // Inventory By Bin
  getAllInventoryByBin(): Promise<InventoryByBin[]>;
  getInventoryByBin(id: string): Promise<InventoryByBin | undefined>;
  getInventoryByItemId(itemId: string): Promise<InventoryByBin[]>;
  createInventoryByBin(inventory: InsertInventoryByBin): Promise<InventoryByBin>;
  updateInventoryByBin(id: string, inventory: Partial<InsertInventoryByBin>): Promise<InventoryByBin | undefined>;
  deleteInventoryByBin(id: string): Promise<boolean>;

  // Bill of Materials
  getAllBillOfMaterials(): Promise<BillOfMaterials[]>;
  getBillOfMaterialsByProductId(finishedProductId: string): Promise<BillOfMaterials[]>;
  createBillOfMaterials(bom: InsertBillOfMaterials): Promise<BillOfMaterials>;
  deleteBillOfMaterials(id: string): Promise<boolean>;

  // Suppliers
  getAllSuppliers(): Promise<Supplier[]>;
  getSupplier(id: string): Promise<Supplier | undefined>;
  createSupplier(supplier: InsertSupplier): Promise<Supplier>;
  updateSupplier(id: string, supplier: Partial<InsertSupplier>): Promise<Supplier | undefined>;
  deleteSupplier(id: string): Promise<boolean>;

  // Supplier Items
  getAllSupplierItems(): Promise<SupplierItem[]>;
  getSupplierItemsByItemId(itemId: string): Promise<SupplierItem[]>;
  createSupplierItem(supplierItem: InsertSupplierItem): Promise<SupplierItem>;
  updateSupplierItem(id: string, supplierItem: Partial<InsertSupplierItem>): Promise<SupplierItem | undefined>;
  deleteSupplierItem(id: string): Promise<boolean>;

  // Sales History
  getAllSalesHistory(): Promise<SalesHistory[]>;
  getSalesHistoryByItemId(itemId: string): Promise<SalesHistory[]>;
  createSalesHistory(sale: InsertSalesHistory): Promise<SalesHistory>;

  // Finished Inventory Snapshot
  getAllFinishedInventorySnapshots(): Promise<FinishedInventorySnapshot[]>;
  createFinishedInventorySnapshot(snapshot: InsertFinishedInventorySnapshot): Promise<FinishedInventorySnapshot>;

  // Integration Health
  getAllIntegrationHealth(): Promise<IntegrationHealth[]>;
  getIntegrationHealth(integrationName: string): Promise<IntegrationHealth | undefined>;
  createOrUpdateIntegrationHealth(health: InsertIntegrationHealth): Promise<IntegrationHealth>;

  // Settings
  getSettings(userId: string): Promise<Settings | undefined>;
  createOrUpdateSettings(settings: InsertSettings): Promise<Settings>;
  updateSettings(userId: string, updates: Partial<Omit<InsertSettings, 'userId'>>): Promise<Settings | undefined>;

  // Barcodes
  getAllBarcodes(): Promise<Barcode[]>;
  getBarcode(id: string): Promise<Barcode | undefined>;
  getBarcodeByValue(value: string): Promise<Barcode | undefined>;
  createBarcode(barcode: InsertBarcode): Promise<Barcode>;
  updateBarcode(id: string, barcode: Partial<InsertBarcode>): Promise<Barcode | undefined>;
  deleteBarcode(id: string): Promise<boolean>;

  // Barcode Settings
  getBarcodeSettings(): Promise<BarcodeSettings | undefined>;
  createOrUpdateBarcodeSettings(settings: Partial<InsertBarcodeSettings>): Promise<BarcodeSettings>;
  incrementItemRef(): Promise<number>;
  incrementInternalCode(): Promise<number>;

  // Import Profiles
  getAllImportProfiles(): Promise<ImportProfile[]>;
  getImportProfile(id: string): Promise<ImportProfile | undefined>;
  createImportProfile(profile: InsertImportProfile): Promise<ImportProfile>;
  updateImportProfile(id: string, profile: Partial<InsertImportProfile>): Promise<ImportProfile | undefined>;
  deleteImportProfile(id: string): Promise<boolean>;

  // Import Jobs
  getAllImportJobs(): Promise<ImportJob[]>;
  getImportJob(id: string): Promise<ImportJob | undefined>;
  createImportJob(job: InsertImportJob): Promise<ImportJob>;
  updateImportJob(id: string, job: Partial<InsertImportJob>): Promise<ImportJob | undefined>;
  deleteImportJob(id: string): Promise<boolean>;

  // Inventory Transactions
  getAllInventoryTransactions(): Promise<InventoryTransaction[]>;
  getInventoryTransactionsByItem(itemId: string): Promise<InventoryTransaction[]>;
  createInventoryTransaction(transaction: InsertInventoryTransaction): Promise<InventoryTransaction>;

  // Purchase Orders
  getAllPurchaseOrders(): Promise<PurchaseOrder[]>;
  getPurchaseOrder(id: string): Promise<PurchaseOrder | undefined>;
  getPurchaseOrdersBySupplierId(supplierId: string): Promise<PurchaseOrder[]>;
  createPurchaseOrder(po: InsertPurchaseOrder): Promise<PurchaseOrder>;
  updatePurchaseOrder(id: string, po: Partial<InsertPurchaseOrder>): Promise<PurchaseOrder | undefined>;
  deletePurchaseOrder(id: string): Promise<boolean>;

  // Purchase Order Lines
  getAllPurchaseOrderLines(): Promise<PurchaseOrderLine[]>;
  getPurchaseOrderLinesByPOId(purchaseOrderId: string): Promise<PurchaseOrderLine[]>;
  createPurchaseOrderLine(line: InsertPurchaseOrderLine): Promise<PurchaseOrderLine>;
  updatePurchaseOrderLine(id: string, line: Partial<InsertPurchaseOrderLine>): Promise<PurchaseOrderLine | undefined>;
  deletePurchaseOrderLine(id: string): Promise<boolean>;

  // Supplier Leads
  getAllSupplierLeads(): Promise<SupplierLead[]>;
  getSupplierLead(id: string): Promise<SupplierLead | undefined>;
  getSupplierLeadsByStatus(status: string): Promise<SupplierLead[]>;
  createSupplierLead(lead: InsertSupplierLead): Promise<SupplierLead>;
  updateSupplierLead(id: string, lead: Partial<InsertSupplierLead>): Promise<SupplierLead | undefined>;
  deleteSupplierLead(id: string): Promise<boolean>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private items: Map<string, Item>;
  private bins: Map<string, Bin>;
  private inventoryByBin: Map<string, InventoryByBin>;
  private billOfMaterials: Map<string, BillOfMaterials>;
  private suppliers: Map<string, Supplier>;
  private supplierItems: Map<string, SupplierItem>;
  private salesHistory: Map<string, SalesHistory>;
  private finishedInventorySnapshots: Map<string, FinishedInventorySnapshot>;
  private integrationHealth: Map<string, IntegrationHealth>;
  private settings: Map<string, Settings>;
  private barcodes: Map<string, Barcode>;
  private barcodeSettings: BarcodeSettings | null;
  private importProfiles: Map<string, ImportProfile>;
  private importJobs: Map<string, ImportJob>;
  private inventoryTransactions: Map<string, InventoryTransaction>;
  private purchaseOrders: Map<string, PurchaseOrder>;
  private purchaseOrderLines: Map<string, PurchaseOrderLine>;
  private supplierLeads: Map<string, SupplierLead>;

  constructor() {
    this.users = new Map();
    this.items = new Map();
    this.bins = new Map();
    this.inventoryByBin = new Map();
    this.billOfMaterials = new Map();
    this.suppliers = new Map();
    this.supplierItems = new Map();
    this.salesHistory = new Map();
    this.finishedInventorySnapshots = new Map();
    this.integrationHealth = new Map();
    this.settings = new Map();
    this.barcodes = new Map();
    this.barcodeSettings = null;
    this.importProfiles = new Map();
    this.importJobs = new Map();
    this.inventoryTransactions = new Map();
    this.purchaseOrders = new Map();
    this.purchaseOrderLines = new Map();
    this.supplierLeads = new Map();
    this.seedData();
  }

  private seedData() {
    // Seed some initial data for demo purposes
    const demoUserId = randomUUID();
    this.users.set(demoUserId, {
      id: demoUserId,
      email: "demo@inventory.com",
      password: "$2b$10$K7L1OJ45/4Y2nIvhRVpCe.FSmhDdWoXehVzJptJ/op0lSsvqNu/1u", // "password"
    });

    // Demo items (components)
    const nutId = randomUUID();
    const boltId = randomUUID();
    const springId = randomUUID();
    const barId = randomUUID();

    this.items.set(nutId, {
      id: nutId,
      name: "M6 Hex Nut",
      sku: "NUT-M6-001",
      type: "component",
      unit: "units",
      currentStock: 150,
      minStock: 50,
      dailyUsage: 12,
      barcode: "COMP-NUT-001",
      location: null,
      hildaleQty: 0,
      pivotQty: 0,
      productKind: "RAW",
      barcodeValue: "COMP-NUT-001",
      barcodeFormat: "CODE128",
      barcodeUsage: "INTERNAL_STOCK",
      barcodeSource: "AUTO_GENERATED",
      externalSystem: null,
      externalId: null,
      forecastDirty: true,
      lastForecastAt: null,
      forecastData: null,
    });

    this.items.set(boltId, {
      id: boltId,
      name: "M6x20 Bolt",
      sku: "BOLT-M6-20",
      type: "component",
      unit: "units",
      currentStock: 200,
      minStock: 75,
      dailyUsage: 15,
      barcode: "COMP-BOLT-001",
      location: null,
      hildaleQty: 0,
      pivotQty: 0,
      productKind: "RAW",
      barcodeValue: "COMP-BOLT-001",
      barcodeFormat: "CODE128",
      barcodeUsage: "INTERNAL_STOCK",
      barcodeSource: "AUTO_GENERATED",
      externalSystem: null,
      externalId: null,
      forecastDirty: true,
      lastForecastAt: null,
      forecastData: null,
    });

    this.items.set(springId, {
      id: springId,
      name: "Compression Spring",
      sku: "SPR-COMP-001",
      type: "component",
      unit: "units",
      currentStock: 80,
      minStock: 40,
      dailyUsage: 8,
      barcode: "COMP-SPR-001",
      location: null,
      hildaleQty: 0,
      pivotQty: 0,
      productKind: "RAW",
      barcodeValue: "COMP-SPR-001",
      barcodeFormat: "CODE128",
      barcodeUsage: "INTERNAL_STOCK",
      barcodeSource: "AUTO_GENERATED",
      externalSystem: null,
      externalId: null,
      forecastDirty: true,
      lastForecastAt: null,
      forecastData: null,
    });

    this.items.set(barId, {
      id: barId,
      name: "Steel Bar 10mm",
      sku: "BAR-STL-10",
      type: "component",
      unit: "units",
      currentStock: 60,
      minStock: 30,
      dailyUsage: 6,
      barcode: "COMP-BAR-001",
      location: null,
      hildaleQty: 0,
      pivotQty: 0,
      productKind: "RAW",
      barcodeValue: "COMP-BAR-001",
      barcodeFormat: "CODE128",
      barcodeUsage: "INTERNAL_STOCK",
      barcodeSource: "AUTO_GENERATED",
      externalSystem: null,
      externalId: null,
      forecastDirty: true,
      lastForecastAt: null,
      forecastData: null,
    });

    // Demo finished product
    const rollerId = randomUUID();
    this.items.set(rollerId, {
      id: rollerId,
      name: "Sticker Bur Roller",
      sku: "SBR-001",
      type: "finished_product",
      unit: "units",
      currentStock: 25,
      minStock: 10,
      dailyUsage: 3,
      barcode: "PROD-SBR-001",
      location: "Spanish Fork",
      hildaleQty: 0,
      pivotQty: 25,
      productKind: "FINISHED",
      barcodeValue: "PROD-SBR-001",
      barcodeFormat: "CODE128",
      barcodeUsage: "EXTERNAL_GS1",
      barcodeSource: "AUTO_GENERATED",
      externalSystem: null,
      externalId: null,
      forecastDirty: false,
      lastForecastAt: new Date(),
      forecastData: { shouldReorder: false, urgency: "low", daysOfCover: 90, recommendedOrderQuantity: 0, reasoning: "Demo seed data" },
    });

    // BOM for Sticker Bur Roller
    this.billOfMaterials.set(randomUUID(), {
      id: randomUUID(),
      finishedProductId: rollerId,
      componentId: nutId,
      quantityRequired: 4,
    });
    this.billOfMaterials.set(randomUUID(), {
      id: randomUUID(),
      finishedProductId: rollerId,
      componentId: boltId,
      quantityRequired: 4,
    });
    this.billOfMaterials.set(randomUUID(), {
      id: randomUUID(),
      finishedProductId: rollerId,
      componentId: springId,
      quantityRequired: 2,
    });
    this.billOfMaterials.set(randomUUID(), {
      id: randomUUID(),
      finishedProductId: rollerId,
      componentId: barId,
      quantityRequired: 3,
    });

    // Demo suppliers
    const supplier1Id = randomUUID();
    const supplier2Id = randomUUID();

    this.suppliers.set(supplier1Id, {
      id: supplier1Id,
      name: "FastenPro Supplies",
      catalogUrl: "https://fastenpro.example.com",
      logoUrl: null,
    });

    this.suppliers.set(supplier2Id, {
      id: supplier2Id,
      name: "Metal Works Co",
      catalogUrl: "https://metalworks.example.com",
      logoUrl: null,
    });

    // Integration health
    this.integrationHealth.set("gohighlevel", {
      id: randomUUID(),
      integrationName: "gohighlevel",
      lastSuccessAt: new Date(Date.now() - 3600000),
      lastStatus: "success",
      lastAlertAt: null,
      errorMessage: null,
    });

    this.integrationHealth.set("extensiv", {
      id: randomUUID(),
      integrationName: "extensiv",
      lastSuccessAt: new Date(Date.now() - 7200000),
      lastStatus: "success",
      lastAlertAt: null,
      errorMessage: null,
    });

    // Barcode Settings
    this.barcodeSettings = {
      id: randomUUID(),
      gs1Prefix: null, // To be configured by user
      itemRefDigits: 6,
      nextItemRef: 1,
      nextInternalCode: 1000,
    };
  }

  // Users
  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find((user) => user.email === email);
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

  async updateUser(id: string, updateData: Partial<InsertUser>): Promise<User | undefined> {
    const user = this.users.get(id);
    if (!user) return undefined;
    const updated = { ...user, ...updateData };
    this.users.set(id, updated);
    return updated;
  }

  // Items
  async getAllItems(): Promise<Item[]> {
    return Array.from(this.items.values());
  }

  private calculateProductionForecast(finishedProductId: string): number {
    // Get BOM entries for this finished product
    const bomEntries = Array.from(this.billOfMaterials.values()).filter(
      (bom) => bom.finishedProductId === finishedProductId
    );

    // If no BOM components, forecast is 0
    if (bomEntries.length === 0) {
      return 0;
    }

    // Calculate capacity for each component
    let minCapacity = Infinity;
    
    for (const bomEntry of bomEntries) {
      const component = this.items.get(bomEntry.componentId);
      
      if (!component || bomEntry.quantityRequired <= 0) {
        // Missing component or invalid quantity = can't produce any
        return 0;
      }

      const componentStock = component.currentStock ?? 0;
      const requiredPerUnit = bomEntry.quantityRequired;
      
      // Calculate how many units this component allows
      const capacityForComponent = Math.floor(componentStock / requiredPerUnit);
      
      minCapacity = Math.min(minCapacity, capacityForComponent);
    }

    return minCapacity === Infinity ? 0 : minCapacity;
  }

  async getItemsWithBOMCounts(): Promise<Array<Item & { componentsCount?: number; forecastQty?: number; totalOwned?: number }>> {
    const items = Array.from(this.items.values());
    const itemsWithCounts = items.map((item) => {
      if (item.type === "finished_product") {
        const bomEntries = Array.from(this.billOfMaterials.values()).filter(
          (bom) => bom.finishedProductId === item.id
        );
        const forecast = this.calculateProductionForecast(item.id);
        const totalOwned = (item.pivotQty ?? 0) + (item.hildaleQty ?? 0);
        return { ...item, componentsCount: bomEntries.length, forecastQty: forecast, totalOwned };
      }
      // For components, explicitly return undefined to match PostgresStorage behavior
      return { ...item, componentsCount: undefined, forecastQty: undefined, totalOwned: undefined };
    });
    return itemsWithCounts;
  }

  async getItem(id: string): Promise<Item | undefined> {
    return this.items.get(id);
  }

  async getItemBySku(sku: string): Promise<Item | undefined> {
    return Array.from(this.items.values()).find((item) => item.sku === sku);
  }

  async createItem(insertItem: InsertItem): Promise<Item> {
    const id = randomUUID();
    
    // Storage-level guard: Force currentStock to 0 for finished products
    // Finished products MUST use only pivotQty and hildaleQty as sources of truth
    
    // Normalize type/productKind to keep them in sync during creation
    let normalizedType = insertItem.type;
    let normalizedProductKind = insertItem.productKind ?? null;
    
    // Step 1: Fill in missing partner field
    if (insertItem.type === 'finished_product' && !insertItem.productKind) {
      normalizedProductKind = 'FINISHED';
    } else if (insertItem.type === 'component' && !insertItem.productKind) {
      normalizedProductKind = 'RAW';
    } else if (insertItem.productKind === 'FINISHED' && !insertItem.type) {
      normalizedType = 'finished_product';
    } else if (insertItem.productKind === 'RAW' && !insertItem.type) {
      normalizedType = 'component';
    }
    
    // Step 2: Fix mismatches by ALWAYS favoring finished_product classification
    // This ensures NO bypass: any signal of finished product → enforce finished product rules
    if (normalizedType === 'finished_product' || normalizedProductKind === 'FINISHED') {
      // ALWAYS favor finished_product: force both fields to finished state
      normalizedType = 'finished_product';
      normalizedProductKind = 'FINISHED';
    } else if (normalizedType === 'component' || normalizedProductKind === 'RAW') {
      // Both indicate component: normalize to component/RAW
      normalizedType = 'component';
      normalizedProductKind = 'RAW';
    }
    
    const isFinishedProduct = normalizedType === 'finished_product' || normalizedProductKind === 'FINISHED';
    const currentStock = isFinishedProduct ? 0 : (insertItem.currentStock ?? 0);
    
    const item: Item = {
      id,
      name: insertItem.name,
      sku: insertItem.sku,
      type: normalizedType,
      unit: insertItem.unit || 'units',
      currentStock,
      minStock: insertItem.minStock ?? 0,
      dailyUsage: insertItem.dailyUsage ?? 0,
      barcode: insertItem.barcode ?? null,
      location: insertItem.location ?? null,
      hildaleQty: insertItem.hildaleQty ?? 0,
      pivotQty: insertItem.pivotQty ?? 0,
      productKind: normalizedProductKind,
      barcodeValue: insertItem.barcodeValue ?? null,
      barcodeFormat: insertItem.barcodeFormat ?? null,
      barcodeUsage: insertItem.barcodeUsage ?? null,
      barcodeSource: insertItem.barcodeSource ?? null,
      externalSystem: insertItem.externalSystem ?? null,
      externalId: insertItem.externalId ?? null,
      forecastDirty: insertItem.forecastDirty ?? true,
      lastForecastAt: insertItem.lastForecastAt ?? null,
      forecastData: insertItem.forecastData ?? null,
    };
    this.items.set(id, item);
    return item;
  }

  async updateItem(id: string, updateData: Partial<InsertItem>): Promise<Item | undefined> {
    const item = this.items.get(id);
    if (!item) return undefined;
    
    // Storage-level guard: Force currentStock to 0 for finished products
    // Finished products MUST use only pivotQty and hildaleQty as sources of truth
    
    // Normalize type/productKind in update data to keep them in sync
    let normalizedUpdateData = { ...updateData };
    if (updateData.type === 'finished_product' && !updateData.productKind) {
      normalizedUpdateData.productKind = 'FINISHED';
    } else if (updateData.type === 'component' && !updateData.productKind) {
      normalizedUpdateData.productKind = 'RAW';
    } else if (updateData.productKind === 'FINISHED' && !updateData.type) {
      normalizedUpdateData.type = 'finished_product';
    } else if (updateData.productKind === 'RAW' && !updateData.type) {
      normalizedUpdateData.type = 'component';
    }
    
    // Merge to get preliminary final state
    let mergedItem = { ...item, ...normalizedUpdateData };
    
    // Normalize FINAL merged state by ALWAYS favoring finished_product classification
    // This fixes pre-existing inconsistencies and ensures NO bypass
    if (mergedItem.type === 'finished_product' || mergedItem.productKind === 'FINISHED') {
      // ALWAYS favor finished_product: force both fields to finished state
      mergedItem.type = 'finished_product';
      mergedItem.productKind = 'FINISHED';
    } else if (mergedItem.type === 'component' || mergedItem.productKind === 'RAW') {
      // Both indicate component: normalize to component/RAW
      mergedItem.type = 'component';
      mergedItem.productKind = 'RAW';
    }
    
    // Determine if final state is finished product
    const willBeFinished = mergedItem.type === 'finished_product' || mergedItem.productKind === 'FINISHED';
    
    if (willBeFinished) {
      // Force currentStock to 0 and ensure type/productKind are fully synced
      mergedItem.currentStock = 0;
      mergedItem.type = 'finished_product';
      mergedItem.productKind = 'FINISHED';
    }
    
    this.items.set(id, mergedItem);
    return mergedItem;
  }

  async deleteItem(id: string): Promise<boolean> {
    return this.items.delete(id);
  }

  // Bins
  async getAllBins(): Promise<Bin[]> {
    return Array.from(this.bins.values());
  }

  async getBin(id: string): Promise<Bin | undefined> {
    return this.bins.get(id);
  }

  async createBin(insertBin: InsertBin): Promise<Bin> {
    const id = randomUUID();
    const bin: Bin = {
      id,
      code: insertBin.code,
      name: insertBin.name,
      location: insertBin.location ?? null,
      barcode: insertBin.barcode ?? null,
    };
    this.bins.set(id, bin);
    return bin;
  }

  async updateBin(id: string, updateData: Partial<InsertBin>): Promise<Bin | undefined> {
    const bin = this.bins.get(id);
    if (!bin) return undefined;
    const updated = { ...bin, ...updateData };
    this.bins.set(id, updated);
    return updated;
  }

  async deleteBin(id: string): Promise<boolean> {
    return this.bins.delete(id);
  }

  // Inventory By Bin
  async getAllInventoryByBin(): Promise<InventoryByBin[]> {
    return Array.from(this.inventoryByBin.values());
  }

  async getInventoryByBin(id: string): Promise<InventoryByBin | undefined> {
    return this.inventoryByBin.get(id);
  }

  async getInventoryByItemId(itemId: string): Promise<InventoryByBin[]> {
    return Array.from(this.inventoryByBin.values()).filter((inv) => inv.itemId === itemId);
  }

  async createInventoryByBin(insertInventory: InsertInventoryByBin): Promise<InventoryByBin> {
    const id = randomUUID();
    const inventory: InventoryByBin = {
      id,
      itemId: insertInventory.itemId,
      binId: insertInventory.binId,
      quantity: insertInventory.quantity ?? 0,
    };
    this.inventoryByBin.set(id, inventory);
    return inventory;
  }

  async updateInventoryByBin(id: string, updateData: Partial<InsertInventoryByBin>): Promise<InventoryByBin | undefined> {
    const inventory = this.inventoryByBin.get(id);
    if (!inventory) return undefined;
    const updated = { ...inventory, ...updateData };
    this.inventoryByBin.set(id, updated);
    return updated;
  }

  async deleteInventoryByBin(id: string): Promise<boolean> {
    return this.inventoryByBin.delete(id);
  }

  // Bill of Materials
  async getAllBillOfMaterials(): Promise<BillOfMaterials[]> {
    return Array.from(this.billOfMaterials.values());
  }

  async getBillOfMaterialsByProductId(finishedProductId: string): Promise<BillOfMaterials[]> {
    return Array.from(this.billOfMaterials.values()).filter(
      (bom) => bom.finishedProductId === finishedProductId
    );
  }

  async createBillOfMaterials(insertBom: InsertBillOfMaterials): Promise<BillOfMaterials> {
    const id = randomUUID();
    const bom: BillOfMaterials = {
      id,
      finishedProductId: insertBom.finishedProductId,
      componentId: insertBom.componentId,
      quantityRequired: insertBom.quantityRequired,
    };
    this.billOfMaterials.set(id, bom);
    return bom;
  }

  async deleteBillOfMaterials(id: string): Promise<boolean> {
    return this.billOfMaterials.delete(id);
  }

  // Suppliers
  async getAllSuppliers(): Promise<Supplier[]> {
    return Array.from(this.suppliers.values());
  }

  async getSupplier(id: string): Promise<Supplier | undefined> {
    return this.suppliers.get(id);
  }

  async createSupplier(insertSupplier: InsertSupplier): Promise<Supplier> {
    const id = randomUUID();
    const supplier: Supplier = {
      id,
      name: insertSupplier.name,
      catalogUrl: insertSupplier.catalogUrl ?? null,
      logoUrl: insertSupplier.logoUrl ?? null,
    };
    this.suppliers.set(id, supplier);
    return supplier;
  }

  async updateSupplier(id: string, updateData: Partial<InsertSupplier>): Promise<Supplier | undefined> {
    const supplier = this.suppliers.get(id);
    if (!supplier) return undefined;
    const updated = { ...supplier, ...updateData };
    this.suppliers.set(id, updated);
    return updated;
  }

  async deleteSupplier(id: string): Promise<boolean> {
    return this.suppliers.delete(id);
  }

  // Supplier Items
  async getAllSupplierItems(): Promise<SupplierItem[]> {
    return Array.from(this.supplierItems.values());
  }

  async getSupplierItemsByItemId(itemId: string): Promise<SupplierItem[]> {
    return Array.from(this.supplierItems.values()).filter((si) => si.itemId === itemId);
  }

  async createSupplierItem(insertSupplierItem: InsertSupplierItem): Promise<SupplierItem> {
    const id = randomUUID();
    const supplierItem: SupplierItem = {
      id,
      supplierId: insertSupplierItem.supplierId,
      itemId: insertSupplierItem.itemId,
      supplierSku: insertSupplierItem.supplierSku ?? null,
      price: insertSupplierItem.price ?? null,
      minimumOrderQuantity: insertSupplierItem.minimumOrderQuantity ?? null,
      availableQuantity: insertSupplierItem.availableQuantity ?? null,
      leadTimeDays: insertSupplierItem.leadTimeDays ?? null,
      isDesignatedSupplier: insertSupplierItem.isDesignatedSupplier ?? false,
    };
    this.supplierItems.set(id, supplierItem);
    return supplierItem;
  }

  async updateSupplierItem(id: string, updateData: Partial<InsertSupplierItem>): Promise<SupplierItem | undefined> {
    const supplierItem = this.supplierItems.get(id);
    if (!supplierItem) return undefined;
    const updated = { ...supplierItem, ...updateData };
    this.supplierItems.set(id, updated);
    return updated;
  }

  async deleteSupplierItem(id: string): Promise<boolean> {
    return this.supplierItems.delete(id);
  }

  // Sales History
  async getAllSalesHistory(): Promise<SalesHistory[]> {
    return Array.from(this.salesHistory.values());
  }

  async getSalesHistoryByItemId(itemId: string): Promise<SalesHistory[]> {
    return Array.from(this.salesHistory.values()).filter(s => s.itemId === itemId);
  }

  async createSalesHistory(insertSale: InsertSalesHistory): Promise<SalesHistory> {
    const id = randomUUID();
    const sale: SalesHistory = {
      id,
      itemId: insertSale.itemId,
      quantitySold: insertSale.quantitySold,
      saleDate: insertSale.saleDate,
      externalOrderId: insertSale.externalOrderId ?? null,
    };
    this.salesHistory.set(id, sale);
    return sale;
  }

  // Finished Inventory Snapshot
  async getAllFinishedInventorySnapshots(): Promise<FinishedInventorySnapshot[]> {
    return Array.from(this.finishedInventorySnapshots.values());
  }

  async createFinishedInventorySnapshot(insertSnapshot: InsertFinishedInventorySnapshot): Promise<FinishedInventorySnapshot> {
    const id = randomUUID();
    const snapshot: FinishedInventorySnapshot = {
      id,
      itemId: insertSnapshot.itemId,
      quantity: insertSnapshot.quantity,
      location: insertSnapshot.location ?? null,
      snapshotDate: insertSnapshot.snapshotDate ?? new Date(),
    };
    this.finishedInventorySnapshots.set(id, snapshot);
    return snapshot;
  }

  // Integration Health
  async getAllIntegrationHealth(): Promise<IntegrationHealth[]> {
    return Array.from(this.integrationHealth.values());
  }

  async getIntegrationHealth(integrationName: string): Promise<IntegrationHealth | undefined> {
    return this.integrationHealth.get(integrationName);
  }

  async createOrUpdateIntegrationHealth(health: InsertIntegrationHealth): Promise<IntegrationHealth> {
    const existing = this.integrationHealth.get(health.integrationName);
    if (existing) {
      const updated: IntegrationHealth = {
        ...existing,
        integrationName: health.integrationName,
        lastSuccessAt: health.lastSuccessAt ?? existing.lastSuccessAt,
        lastStatus: health.lastStatus ?? existing.lastStatus,
        lastAlertAt: health.lastAlertAt ?? existing.lastAlertAt,
        errorMessage: health.errorMessage ?? existing.errorMessage,
      };
      this.integrationHealth.set(health.integrationName, updated);
      return updated;
    }
    const id = randomUUID();
    const newHealth: IntegrationHealth = {
      id,
      integrationName: health.integrationName,
      lastSuccessAt: health.lastSuccessAt ?? null,
      lastStatus: health.lastStatus ?? null,
      lastAlertAt: health.lastAlertAt ?? null,
      errorMessage: health.errorMessage ?? null,
    };
    this.integrationHealth.set(health.integrationName, newHealth);
    return newHealth;
  }

  // Settings
  async getSettings(userId: string): Promise<Settings | undefined> {
    return Array.from(this.settings.values()).find((s) => s.userId === userId);
  }

  async createOrUpdateSettings(insertSettings: InsertSettings): Promise<Settings> {
    const existing = await this.getSettings(insertSettings.userId);
    if (existing) {
      const updated: Settings = { ...existing, ...insertSettings };
      this.settings.set(existing.id, updated);
      return updated;
    }
    const id = randomUUID();
    const settings: Settings = {
      id,
      userId: insertSettings.userId,
      gohighlevelApiKey: insertSettings.gohighlevelApiKey ?? null,
      shopifyApiKey: insertSettings.shopifyApiKey ?? null,
      extensivApiKey: insertSettings.extensivApiKey ?? null,
      phantombusterApiKey: insertSettings.phantombusterApiKey ?? null,
      llmProvider: insertSettings.llmProvider ?? null,
      llmApiKey: insertSettings.llmApiKey ?? null,
      llmModel: insertSettings.llmModel ?? null,
      llmCustomEndpoint: insertSettings.llmCustomEndpoint ?? null,
      llmPromptTemplate: insertSettings.llmPromptTemplate ?? null,
      enableLlmOrderRecommendations: insertSettings.enableLlmOrderRecommendations ?? false,
      enableLlmSupplierRanking: insertSettings.enableLlmSupplierRanking ?? false,
      enableLlmForecasting: insertSettings.enableLlmForecasting ?? false,
      enableVisionCapture: insertSettings.enableVisionCapture ?? false,
      visionProvider: insertSettings.visionProvider ?? null,
      visionModel: insertSettings.visionModel ?? null,
    };
    this.settings.set(id, settings);
    return settings;
  }

  async updateSettings(userId: string, updates: Partial<Omit<InsertSettings, 'userId'>>): Promise<Settings | undefined> {
    const existing = await this.getSettings(userId);
    if (!existing) return undefined;
    
    // Normalize empty strings to null
    const normalized = Object.fromEntries(
      Object.entries(updates).map(([key, value]) => [
        key,
        typeof value === 'string' && value.trim() === '' ? null : value
      ])
    ) as Partial<Omit<InsertSettings, 'userId'>>;
    
    const updated: Settings = { ...existing, ...normalized };
    this.settings.set(existing.id, updated);
    return updated;
  }

  // Barcodes
  async getAllBarcodes(): Promise<Barcode[]> {
    return Array.from(this.barcodes.values());
  }

  async getBarcode(id: string): Promise<Barcode | undefined> {
    return this.barcodes.get(id);
  }

  async getBarcodeByValue(value: string): Promise<Barcode | undefined> {
    return Array.from(this.barcodes.values()).find((b) => b.value === value);
  }

  async createBarcode(insertBarcode: InsertBarcode): Promise<Barcode> {
    const id = randomUUID();
    const barcode: Barcode = {
      id,
      value: insertBarcode.value,
      name: insertBarcode.name,
      sku: insertBarcode.sku ?? null,
      purpose: insertBarcode.purpose,
      referenceId: insertBarcode.referenceId ?? null,
    };
    this.barcodes.set(id, barcode);
    return barcode;
  }

  async updateBarcode(id: string, updateData: Partial<InsertBarcode>): Promise<Barcode | undefined> {
    const barcode = this.barcodes.get(id);
    if (!barcode) return undefined;
    const updated = { ...barcode, ...updateData };
    this.barcodes.set(id, updated);
    return updated;
  }

  async deleteBarcode(id: string): Promise<boolean> {
    return this.barcodes.delete(id);
  }

  // Barcode Settings
  async getBarcodeSettings(): Promise<BarcodeSettings | undefined> {
    return this.barcodeSettings || undefined;
  }

  async createOrUpdateBarcodeSettings(settings: Partial<InsertBarcodeSettings>): Promise<BarcodeSettings> {
    if (!this.barcodeSettings) {
      this.barcodeSettings = {
        id: randomUUID(),
        gs1Prefix: settings.gs1Prefix ?? null,
        itemRefDigits: settings.itemRefDigits ?? 6,
        nextItemRef: settings.nextItemRef ?? 1,
        nextInternalCode: settings.nextInternalCode ?? 1000,
      };
    } else {
      this.barcodeSettings = {
        ...this.barcodeSettings,
        ...settings,
      };
    }
    return this.barcodeSettings;
  }

  async incrementItemRef(): Promise<number> {
    if (!this.barcodeSettings) {
      this.barcodeSettings = {
        id: randomUUID(),
        gs1Prefix: null,
        itemRefDigits: 6,
        nextItemRef: 1,
        nextInternalCode: 1000,
      };
    }
    const current = this.barcodeSettings.nextItemRef;
    this.barcodeSettings.nextItemRef = current + 1;
    return current;
  }

  async incrementInternalCode(): Promise<number> {
    if (!this.barcodeSettings) {
      this.barcodeSettings = {
        id: randomUUID(),
        gs1Prefix: null,
        itemRefDigits: 6,
        nextItemRef: 1,
        nextInternalCode: 1000,
      };
    }
    const current = this.barcodeSettings.nextInternalCode;
    this.barcodeSettings.nextInternalCode = current + 1;
    return current;
  }

  // Import Profiles
  async getAllImportProfiles(): Promise<ImportProfile[]> {
    return Array.from(this.importProfiles.values());
  }

  async getImportProfile(id: string): Promise<ImportProfile | undefined> {
    return this.importProfiles.get(id);
  }

  async createImportProfile(insertProfile: InsertImportProfile): Promise<ImportProfile> {
    const id = randomUUID();
    const profile: ImportProfile = {
      id,
      name: insertProfile.name,
      description: insertProfile.description ?? null,
      columnMappings: insertProfile.columnMappings,
      createdAt: new Date(),
    };
    this.importProfiles.set(id, profile);
    return profile;
  }

  async updateImportProfile(id: string, updateData: Partial<InsertImportProfile>): Promise<ImportProfile | undefined> {
    const profile = this.importProfiles.get(id);
    if (!profile) return undefined;
    const updated = { ...profile, ...updateData };
    this.importProfiles.set(id, updated);
    return updated;
  }

  async deleteImportProfile(id: string): Promise<boolean> {
    return this.importProfiles.delete(id);
  }

  // Import Jobs
  async getAllImportJobs(): Promise<ImportJob[]> {
    return Array.from(this.importJobs.values());
  }

  async getImportJob(id: string): Promise<ImportJob | undefined> {
    return this.importJobs.get(id);
  }

  async createImportJob(insertJob: InsertImportJob): Promise<ImportJob> {
    const id = randomUUID();
    const job: ImportJob = {
      id,
      profileId: insertJob.profileId ?? null,
      fileName: insertJob.fileName,
      status: insertJob.status ?? 'pending',
      startedAt: new Date(),
      finishedAt: insertJob.finishedAt ?? null,
      summary: insertJob.summary ?? null,
      errors: insertJob.errors ?? null,
    };
    this.importJobs.set(id, job);
    return job;
  }

  async updateImportJob(id: string, updateData: Partial<InsertImportJob>): Promise<ImportJob | undefined> {
    const job = this.importJobs.get(id);
    if (!job) return undefined;
    const updated = { ...job, ...updateData };
    this.importJobs.set(id, updated);
    return updated;
  }

  async deleteImportJob(id: string): Promise<boolean> {
    return this.importJobs.delete(id);
  }

  async getAllInventoryTransactions(): Promise<InventoryTransaction[]> {
    return Array.from(this.inventoryTransactions.values());
  }

  async getInventoryTransactionsByItem(itemId: string): Promise<InventoryTransaction[]> {
    return Array.from(this.inventoryTransactions.values())
      .filter(t => t.itemId === itemId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async createInventoryTransaction(insertTransaction: InsertInventoryTransaction): Promise<InventoryTransaction> {
    const id = randomUUID();
    const transaction: InventoryTransaction = {
      id,
      itemId: insertTransaction.itemId,
      itemType: insertTransaction.itemType,
      type: insertTransaction.type,
      location: insertTransaction.location,
      quantity: insertTransaction.quantity,
      createdAt: new Date(),
      createdBy: insertTransaction.createdBy ?? null,
      notes: insertTransaction.notes ?? null,
    };
    this.inventoryTransactions.set(id, transaction);
    return transaction;
  }

  // Purchase Orders
  async getAllPurchaseOrders(): Promise<PurchaseOrder[]> {
    return Array.from(this.purchaseOrders.values());
  }

  async getPurchaseOrder(id: string): Promise<PurchaseOrder | undefined> {
    return this.purchaseOrders.get(id);
  }

  async getPurchaseOrdersBySupplierId(supplierId: string): Promise<PurchaseOrder[]> {
    return Array.from(this.purchaseOrders.values())
      .filter(po => po.supplierId === supplierId);
  }

  async createPurchaseOrder(insertPO: InsertPurchaseOrder): Promise<PurchaseOrder> {
    const id = randomUUID();
    const po: PurchaseOrder = {
      id,
      ...insertPO,
      orderDate: insertPO.orderDate ?? new Date(),
      approvedAt: insertPO.approvedAt ?? null,
      sentAt: insertPO.sentAt ?? null,
      expectedDate: insertPO.expectedDate ?? null,
      receivedAt: insertPO.receivedAt ?? null,
      paidAt: insertPO.paidAt ?? null,
      status: insertPO.status ?? 'DRAFT',
      hasIssue: insertPO.hasIssue ?? false,
      issueStatus: insertPO.issueStatus ?? 'NONE',
      issueType: insertPO.issueType ?? null,
      issueNotes: insertPO.issueNotes ?? null,
      refundStatus: insertPO.refundStatus ?? 'NONE',
      refundAmount: insertPO.refundAmount ?? 0,
      notes: insertPO.notes ?? null,
    };
    this.purchaseOrders.set(id, po);
    return po;
  }

  async updatePurchaseOrder(id: string, updates: Partial<InsertPurchaseOrder>): Promise<PurchaseOrder | undefined> {
    const po = this.purchaseOrders.get(id);
    if (!po) return undefined;
    const updated = { ...po, ...updates };
    this.purchaseOrders.set(id, updated);
    return updated;
  }

  async deletePurchaseOrder(id: string): Promise<boolean> {
    return this.purchaseOrders.delete(id);
  }

  // Purchase Order Lines
  async getAllPurchaseOrderLines(): Promise<PurchaseOrderLine[]> {
    return Array.from(this.purchaseOrderLines.values());
  }

  async getPurchaseOrderLinesByPOId(purchaseOrderId: string): Promise<PurchaseOrderLine[]> {
    return Array.from(this.purchaseOrderLines.values())
      .filter(line => line.purchaseOrderId === purchaseOrderId);
  }

  async createPurchaseOrderLine(insertLine: InsertPurchaseOrderLine): Promise<PurchaseOrderLine> {
    const id = randomUUID();
    const line: PurchaseOrderLine = {
      id,
      ...insertLine,
      qtyReceived: insertLine.qtyReceived ?? 0,
      unitCost: insertLine.unitCost ?? null,
    };
    this.purchaseOrderLines.set(id, line);
    return line;
  }

  async updatePurchaseOrderLine(id: string, updates: Partial<InsertPurchaseOrderLine>): Promise<PurchaseOrderLine | undefined> {
    const line = this.purchaseOrderLines.get(id);
    if (!line) return undefined;
    const updated = { ...line, ...updates };
    this.purchaseOrderLines.set(id, updated);
    return updated;
  }

  async deletePurchaseOrderLine(id: string): Promise<boolean> {
    return this.purchaseOrderLines.delete(id);
  }

  // Supplier Leads
  async getAllSupplierLeads(): Promise<SupplierLead[]> {
    return Array.from(this.supplierLeads.values());
  }

  async getSupplierLead(id: string): Promise<SupplierLead | undefined> {
    return this.supplierLeads.get(id);
  }

  async getSupplierLeadsByStatus(status: string): Promise<SupplierLead[]> {
    return Array.from(this.supplierLeads.values())
      .filter(lead => lead.status === status);
  }

  async createSupplierLead(insertLead: InsertSupplierLead): Promise<SupplierLead> {
    const id = randomUUID();
    const lead: SupplierLead = {
      id,
      ...insertLead,
      source: insertLead.source ?? 'MANUAL',
      status: insertLead.status ?? 'NEW',
      websiteUrl: insertLead.websiteUrl ?? null,
      contactEmail: insertLead.contactEmail ?? null,
      contactPhone: insertLead.contactPhone ?? null,
      category: insertLead.category ?? null,
      notes: insertLead.notes ?? null,
      lastContactedAt: insertLead.lastContactedAt ?? null,
      aiOutreachDraft: insertLead.aiOutreachDraft ?? null,
      convertedSupplierId: insertLead.convertedSupplierId ?? null,
      createdAt: new Date(),
    };
    this.supplierLeads.set(id, lead);
    return lead;
  }

  async updateSupplierLead(id: string, updates: Partial<InsertSupplierLead>): Promise<SupplierLead | undefined> {
    const lead = this.supplierLeads.get(id);
    if (!lead) return undefined;
    const updated = { ...lead, ...updates };
    this.supplierLeads.set(id, updated);
    return updated;
  }

  async deleteSupplierLead(id: string): Promise<boolean> {
    return this.supplierLeads.delete(id);
  }
}

export class PostgresStorage implements IStorage {
  private db;

  constructor(connectionString: string) {
    const sql = neon(connectionString);
    this.db = drizzle(sql, { schema });
  }

  // Users
  async getUser(id: string): Promise<User | undefined> {
    const results = await this.db.select().from(schema.users).where(eq(schema.users.id, id));
    return results[0];
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const results = await this.db.select().from(schema.users).where(eq(schema.users.email, email));
    return results[0];
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const results = await this.db.insert(schema.users).values(insertUser).returning();
    return results[0];
  }

  async updateUser(id: string, updateData: Partial<InsertUser>): Promise<User | undefined> {
    const results = await this.db.update(schema.users).set(updateData).where(eq(schema.users.id, id)).returning();
    return results[0];
  }

  // Items
  async getAllItems(): Promise<Item[]> {
    return await this.db.select().from(schema.items);
  }

  private async calculateProductionForecast(finishedProductId: string): Promise<number> {
    // Get BOM entries for this finished product with component stock info
    // Use LEFT JOIN to detect missing components
    const bomWithStock = await this.db
      .select({
        componentId: schema.billOfMaterials.componentId,
        quantityRequired: schema.billOfMaterials.quantityRequired,
        currentStock: schema.items.currentStock,
      })
      .from(schema.billOfMaterials)
      .leftJoin(schema.items, eq(schema.billOfMaterials.componentId, schema.items.id))
      .where(eq(schema.billOfMaterials.finishedProductId, finishedProductId));

    // If no BOM components, forecast is 0
    if (bomWithStock.length === 0) {
      return 0;
    }

    // Calculate capacity for each component
    let minCapacity = Infinity;
    
    for (const bomEntry of bomWithStock) {
      // Check for missing component (LEFT JOIN returned null)
      if (bomEntry.currentStock === null) {
        // Missing component = can't produce any
        return 0;
      }

      if (bomEntry.quantityRequired <= 0) {
        // Invalid quantity = can't produce any
        return 0;
      }

      const componentStock = bomEntry.currentStock ?? 0;
      const requiredPerUnit = bomEntry.quantityRequired;
      
      // Calculate how many units this component allows
      const capacityForComponent = Math.floor(componentStock / requiredPerUnit);
      
      minCapacity = Math.min(minCapacity, capacityForComponent);
    }

    return minCapacity === Infinity ? 0 : minCapacity;
  }

  async getItemsWithBOMCounts(): Promise<Array<Item & { componentsCount?: number; forecastQty?: number; totalOwned?: number; primarySupplier?: any }>> {
    // Use LEFT JOIN + COUNT to efficiently get BOM counts and supplier info in a single query
    // Cast COUNT to integer explicitly to ensure consistent numeric type
    const results = await this.db
      .select({
        items: schema.items,
        componentsCount: drizzleSql<number>`CAST(COUNT(DISTINCT ${schema.billOfMaterials.id}) AS INTEGER)`,
        supplierItem: schema.supplierItems,
        supplier: schema.suppliers,
      })
      .from(schema.items)
      .leftJoin(
        schema.billOfMaterials,
        eq(schema.items.id, schema.billOfMaterials.finishedProductId)
      )
      .leftJoin(
        schema.supplierItems,
        and(
          eq(schema.items.id, schema.supplierItems.itemId),
          eq(schema.supplierItems.isDesignatedSupplier, true)
        )
      )
      .leftJoin(
        schema.suppliers,
        eq(schema.supplierItems.supplierId, schema.suppliers.id)
      )
      .groupBy(schema.items.id, schema.supplierItems.id, schema.suppliers.id);
    
    // Calculate forecast and totalOwned for each finished product
    const itemsWithForecast = await Promise.all(
      results.map(async (row) => {
        const primarySupplier = row.supplierItem && row.supplier ? {
          supplierName: row.supplier.name,
          supplierSku: row.supplierItem.supplierSku,
          unitCost: row.supplierItem.price,
          minimumOrderQuantity: row.supplierItem.minimumOrderQuantity,
          leadTimeDays: row.supplierItem.leadTimeDays,
        } : null;
        
        if (row.items.type === "finished_product") {
          const forecast = await this.calculateProductionForecast(row.items.id);
          const totalOwned = (row.items.pivotQty ?? 0) + (row.items.hildaleQty ?? 0);
          return {
            ...row.items,
            componentsCount: row.componentsCount,
            forecastQty: forecast,
            totalOwned,
            primarySupplier,
          };
        }
        // For components (non-finished products), return undefined instead of 0
        return {
          ...row.items,
          componentsCount: undefined,
          forecastQty: undefined,
          totalOwned: undefined,
          primarySupplier,
        };
      })
    );

    return itemsWithForecast;
  }

  async getItem(id: string): Promise<Item | undefined> {
    const results = await this.db.select().from(schema.items).where(eq(schema.items.id, id));
    return results[0];
  }

  async getItemBySku(sku: string): Promise<Item | undefined> {
    const results = await this.db.select().from(schema.items).where(eq(schema.items.sku, sku));
    return results[0];
  }

  async createItem(insertItem: InsertItem): Promise<Item> {
    // Storage-level guard: Force currentStock to 0 for finished products
    // Finished products MUST use only pivotQty and hildaleQty as sources of truth
    
    // Normalize type/productKind to keep them in sync during creation
    let normalizedInsert = { ...insertItem };
    
    // Step 1: Fill in missing partner field
    if (insertItem.type === 'finished_product' && !insertItem.productKind) {
      normalizedInsert.productKind = 'FINISHED';
    } else if (insertItem.type === 'component' && !insertItem.productKind) {
      normalizedInsert.productKind = 'RAW';
    } else if (insertItem.productKind === 'FINISHED' && !insertItem.type) {
      normalizedInsert.type = 'finished_product';
    } else if (insertItem.productKind === 'RAW' && !insertItem.type) {
      normalizedInsert.type = 'component';
    }
    
    // Step 2: Fix mismatches by ALWAYS favoring finished_product classification
    // This ensures NO bypass: any signal of finished product → enforce finished product rules
    if (normalizedInsert.type === 'finished_product' || normalizedInsert.productKind === 'FINISHED') {
      // ALWAYS favor finished_product: force both fields to finished state
      normalizedInsert.type = 'finished_product';
      normalizedInsert.productKind = 'FINISHED';
    } else if (normalizedInsert.type === 'component' || normalizedInsert.productKind === 'RAW') {
      // Both indicate component: normalize to component/RAW
      normalizedInsert.type = 'component';
      normalizedInsert.productKind = 'RAW';
    }
    
    const isFinishedProduct = normalizedInsert.type === 'finished_product' || normalizedInsert.productKind === 'FINISHED';
    if (isFinishedProduct) {
      normalizedInsert.currentStock = 0;
      normalizedInsert.type = 'finished_product';
      normalizedInsert.productKind = 'FINISHED';
    }
    
    const results = await this.db.insert(schema.items).values(normalizedInsert).returning();
    return results[0];
  }

  async updateItem(id: string, updateData: Partial<InsertItem>): Promise<Item | undefined> {
    // Storage-level guard: Force currentStock to 0 for finished products
    // Finished products MUST use only pivotQty and hildaleQty as sources of truth
    // Get the existing item to check its type
    const existingItem = await this.getItem(id);
    if (!existingItem) return undefined;
    
    // Normalize type/productKind in update data to keep them in sync
    let normalizedUpdateData = { ...updateData };
    if (updateData.type === 'finished_product' && !updateData.productKind) {
      normalizedUpdateData.productKind = 'FINISHED';
    } else if (updateData.type === 'component' && !updateData.productKind) {
      normalizedUpdateData.productKind = 'RAW';
    } else if (updateData.productKind === 'FINISHED' && !updateData.type) {
      normalizedUpdateData.type = 'finished_product';
    } else if (updateData.productKind === 'RAW' && !updateData.type) {
      normalizedUpdateData.type = 'component';
    }
    
    // Merge to get preliminary final state
    let mergedItem = { ...existingItem, ...normalizedUpdateData };
    
    // Normalize FINAL merged state by ALWAYS favoring finished_product classification
    // This fixes pre-existing inconsistencies and ensures NO bypass
    if (mergedItem.type === 'finished_product' || mergedItem.productKind === 'FINISHED') {
      // ALWAYS favor finished_product: force both fields to finished state
      mergedItem.type = 'finished_product';
      mergedItem.productKind = 'FINISHED';
    } else if (mergedItem.type === 'component' || mergedItem.productKind === 'RAW') {
      // Both indicate component: normalize to component/RAW
      mergedItem.type = 'component';
      mergedItem.productKind = 'RAW';
    }
    
    // Determine if final state is finished product
    const willBeFinished = mergedItem.type === 'finished_product' || mergedItem.productKind === 'FINISHED';
    
    if (willBeFinished) {
      // Force currentStock to 0 and ensure type/productKind are fully synced
      mergedItem.currentStock = 0;
      mergedItem.type = 'finished_product';
      mergedItem.productKind = 'FINISHED';
    }
    
    // Prepare final update data with all normalized fields
    const finalUpdateData = {
      ...normalizedUpdateData,
      type: mergedItem.type,
      productKind: mergedItem.productKind,
      currentStock: mergedItem.currentStock,
    };
    
    const results = await this.db.update(schema.items).set(finalUpdateData).where(eq(schema.items.id, id)).returning();
    return results[0];
  }

  async deleteItem(id: string): Promise<boolean> {
    const results = await this.db.delete(schema.items).where(eq(schema.items.id, id)).returning();
    return results.length > 0;
  }

  // Bins
  async getAllBins(): Promise<Bin[]> {
    return await this.db.select().from(schema.bins);
  }

  async getBin(id: string): Promise<Bin | undefined> {
    const results = await this.db.select().from(schema.bins).where(eq(schema.bins.id, id));
    return results[0];
  }

  async createBin(insertBin: InsertBin): Promise<Bin> {
    const results = await this.db.insert(schema.bins).values(insertBin).returning();
    return results[0];
  }

  async updateBin(id: string, updateData: Partial<InsertBin>): Promise<Bin | undefined> {
    const results = await this.db.update(schema.bins).set(updateData).where(eq(schema.bins.id, id)).returning();
    return results[0];
  }

  async deleteBin(id: string): Promise<boolean> {
    const results = await this.db.delete(schema.bins).where(eq(schema.bins.id, id)).returning();
    return results.length > 0;
  }

  // Inventory By Bin
  async getAllInventoryByBin(): Promise<InventoryByBin[]> {
    return await this.db.select().from(schema.inventoryByBin);
  }

  async getInventoryByBin(id: string): Promise<InventoryByBin | undefined> {
    const results = await this.db.select().from(schema.inventoryByBin).where(eq(schema.inventoryByBin.id, id));
    return results[0];
  }

  async getInventoryByItemId(itemId: string): Promise<InventoryByBin[]> {
    return await this.db.select().from(schema.inventoryByBin).where(eq(schema.inventoryByBin.itemId, itemId));
  }

  async createInventoryByBin(insertInventory: InsertInventoryByBin): Promise<InventoryByBin> {
    const results = await this.db.insert(schema.inventoryByBin).values(insertInventory).returning();
    return results[0];
  }

  async updateInventoryByBin(id: string, updateData: Partial<InsertInventoryByBin>): Promise<InventoryByBin | undefined> {
    const results = await this.db.update(schema.inventoryByBin).set(updateData).where(eq(schema.inventoryByBin.id, id)).returning();
    return results[0];
  }

  async deleteInventoryByBin(id: string): Promise<boolean> {
    const results = await this.db.delete(schema.inventoryByBin).where(eq(schema.inventoryByBin.id, id)).returning();
    return results.length > 0;
  }

  // Bill of Materials
  async getAllBillOfMaterials(): Promise<BillOfMaterials[]> {
    return await this.db.select().from(schema.billOfMaterials);
  }

  async getBillOfMaterialsByProductId(finishedProductId: string): Promise<BillOfMaterials[]> {
    return await this.db.select().from(schema.billOfMaterials).where(eq(schema.billOfMaterials.finishedProductId, finishedProductId));
  }

  async createBillOfMaterials(insertBom: InsertBillOfMaterials): Promise<BillOfMaterials> {
    const results = await this.db.insert(schema.billOfMaterials).values(insertBom).returning();
    return results[0];
  }

  async deleteBillOfMaterials(id: string): Promise<boolean> {
    const results = await this.db.delete(schema.billOfMaterials).where(eq(schema.billOfMaterials.id, id)).returning();
    return results.length > 0;
  }

  // Suppliers
  async getAllSuppliers(): Promise<Supplier[]> {
    return await this.db.select().from(schema.suppliers);
  }

  async getSupplier(id: string): Promise<Supplier | undefined> {
    const results = await this.db.select().from(schema.suppliers).where(eq(schema.suppliers.id, id));
    return results[0];
  }

  async createSupplier(insertSupplier: InsertSupplier): Promise<Supplier> {
    const results = await this.db.insert(schema.suppliers).values(insertSupplier).returning();
    return results[0];
  }

  async updateSupplier(id: string, updateData: Partial<InsertSupplier>): Promise<Supplier | undefined> {
    const results = await this.db.update(schema.suppliers).set(updateData).where(eq(schema.suppliers.id, id)).returning();
    return results[0];
  }

  async deleteSupplier(id: string): Promise<boolean> {
    const results = await this.db.delete(schema.suppliers).where(eq(schema.suppliers.id, id)).returning();
    return results.length > 0;
  }

  // Supplier Items
  async getAllSupplierItems(): Promise<SupplierItem[]> {
    return await this.db.select().from(schema.supplierItems);
  }

  async getSupplierItemsByItemId(itemId: string): Promise<SupplierItem[]> {
    return await this.db.select().from(schema.supplierItems).where(eq(schema.supplierItems.itemId, itemId));
  }

  async createSupplierItem(insertSupplierItem: InsertSupplierItem): Promise<SupplierItem> {
    const results = await this.db.insert(schema.supplierItems).values(insertSupplierItem).returning();
    return results[0];
  }

  async updateSupplierItem(id: string, updateData: Partial<InsertSupplierItem>): Promise<SupplierItem | undefined> {
    const results = await this.db.update(schema.supplierItems).set(updateData).where(eq(schema.supplierItems.id, id)).returning();
    return results[0];
  }

  async deleteSupplierItem(id: string): Promise<boolean> {
    const results = await this.db.delete(schema.supplierItems).where(eq(schema.supplierItems.id, id)).returning();
    return results.length > 0;
  }

  // Sales History
  async getAllSalesHistory(): Promise<SalesHistory[]> {
    return await this.db.select().from(schema.salesHistory);
  }

  async getSalesHistoryByItemId(itemId: string): Promise<SalesHistory[]> {
    return await this.db.select().from(schema.salesHistory).where(eq(schema.salesHistory.itemId, itemId));
  }

  async createSalesHistory(insertSale: InsertSalesHistory): Promise<SalesHistory> {
    const results = await this.db.insert(schema.salesHistory).values(insertSale).returning();
    return results[0];
  }

  // Finished Inventory Snapshot
  async getAllFinishedInventorySnapshots(): Promise<FinishedInventorySnapshot[]> {
    return await this.db.select().from(schema.finishedInventorySnapshot);
  }

  async createFinishedInventorySnapshot(insertSnapshot: InsertFinishedInventorySnapshot): Promise<FinishedInventorySnapshot> {
    const results = await this.db.insert(schema.finishedInventorySnapshot).values(insertSnapshot).returning();
    return results[0];
  }

  // Integration Health
  async getAllIntegrationHealth(): Promise<IntegrationHealth[]> {
    return await this.db.select().from(schema.integrationHealth);
  }

  async getIntegrationHealth(integrationName: string): Promise<IntegrationHealth | undefined> {
    const results = await this.db.select().from(schema.integrationHealth).where(eq(schema.integrationHealth.integrationName, integrationName));
    return results[0];
  }

  async createOrUpdateIntegrationHealth(health: InsertIntegrationHealth): Promise<IntegrationHealth> {
    const existing = await this.getIntegrationHealth(health.integrationName);
    if (existing) {
      const results = await this.db.update(schema.integrationHealth).set(health).where(eq(schema.integrationHealth.integrationName, health.integrationName)).returning();
      return results[0];
    }
    const results = await this.db.insert(schema.integrationHealth).values(health).returning();
    return results[0];
  }

  // Settings
  async getSettings(userId: string): Promise<Settings | undefined> {
    const results = await this.db.select().from(schema.settings).where(eq(schema.settings.userId, userId));
    return results[0];
  }

  async createOrUpdateSettings(insertSettings: InsertSettings): Promise<Settings> {
    const existing = await this.getSettings(insertSettings.userId);
    if (existing) {
      const results = await this.db.update(schema.settings).set(insertSettings).where(eq(schema.settings.userId, insertSettings.userId)).returning();
      return results[0];
    }
    const results = await this.db.insert(schema.settings).values(insertSettings).returning();
    return results[0];
  }

  async updateSettings(userId: string, updates: Partial<Omit<InsertSettings, 'userId'>>): Promise<Settings | undefined> {
    // Normalize empty strings to null
    const normalized = Object.fromEntries(
      Object.entries(updates).map(([key, value]) => [
        key,
        typeof value === 'string' && value.trim() === '' ? null : value
      ])
    ) as Partial<Omit<InsertSettings, 'userId'>>;
    
    // Check if settings exist
    const existing = await this.getSettings(userId);
    if (!existing) {
      // Create new settings row with the updates
      const insertData: InsertSettings = {
        userId,
        ...normalized
      };
      const results = await this.db.insert(schema.settings).values(insertData).returning();
      return results[0];
    }
    
    // Apply only the validated updates (Drizzle only updates provided columns)
    const results = await this.db.update(schema.settings).set(normalized).where(eq(schema.settings.userId, userId)).returning();
    return results[0];
  }

  // Barcodes
  async getAllBarcodes(): Promise<Barcode[]> {
    return await this.db.select().from(schema.barcodes);
  }

  async getBarcode(id: string): Promise<Barcode | undefined> {
    const results = await this.db.select().from(schema.barcodes).where(eq(schema.barcodes.id, id));
    return results[0];
  }

  async getBarcodeByValue(value: string): Promise<Barcode | undefined> {
    const results = await this.db.select().from(schema.barcodes).where(eq(schema.barcodes.value, value));
    return results[0];
  }

  async createBarcode(insertBarcode: InsertBarcode): Promise<Barcode> {
    const results = await this.db.insert(schema.barcodes).values(insertBarcode).returning();
    return results[0];
  }

  async updateBarcode(id: string, updateData: Partial<InsertBarcode>): Promise<Barcode | undefined> {
    const results = await this.db.update(schema.barcodes).set(updateData).where(eq(schema.barcodes.id, id)).returning();
    return results[0];
  }

  async deleteBarcode(id: string): Promise<boolean> {
    const results = await this.db.delete(schema.barcodes).where(eq(schema.barcodes.id, id)).returning();
    return results.length > 0;
  }

  // Barcode Settings
  async getBarcodeSettings(): Promise<BarcodeSettings | undefined> {
    const results = await this.db.select().from(schema.barcodeSettings).limit(1);
    return results[0];
  }

  async createOrUpdateBarcodeSettings(settings: Partial<InsertBarcodeSettings>): Promise<BarcodeSettings> {
    const existing = await this.getBarcodeSettings();
    if (existing) {
      const updated = await this.db
        .update(schema.barcodeSettings)
        .set(settings)
        .where(eq(schema.barcodeSettings.id, existing.id))
        .returning();
      return updated[0];
    } else {
      const created = await this.db.insert(schema.barcodeSettings).values({
        gs1Prefix: settings.gs1Prefix ?? null,
        itemRefDigits: settings.itemRefDigits ?? 6,
        nextItemRef: settings.nextItemRef ?? 1,
        nextInternalCode: settings.nextInternalCode ?? 1000,
      }).returning();
      return created[0];
    }
  }

  async incrementItemRef(): Promise<number> {
    const existing = await this.getBarcodeSettings();
    if (!existing) {
      await this.createOrUpdateBarcodeSettings({});
      return 1;
    }
    const current = existing.nextItemRef;
    await this.db
      .update(schema.barcodeSettings)
      .set({ nextItemRef: current + 1 })
      .where(eq(schema.barcodeSettings.id, existing.id));
    return current;
  }

  async incrementInternalCode(): Promise<number> {
    const existing = await this.getBarcodeSettings();
    if (!existing) {
      await this.createOrUpdateBarcodeSettings({});
      return 1000;
    }
    const current = existing.nextInternalCode;
    await this.db
      .update(schema.barcodeSettings)
      .set({ nextInternalCode: current + 1 })
      .where(eq(schema.barcodeSettings.id, existing.id));
    return current;
  }

  // Import Profiles
  async getAllImportProfiles(): Promise<ImportProfile[]> {
    return await this.db.select().from(schema.importProfiles);
  }

  async getImportProfile(id: string): Promise<ImportProfile | undefined> {
    const results = await this.db.select().from(schema.importProfiles).where(eq(schema.importProfiles.id, id));
    return results[0];
  }

  async createImportProfile(profile: InsertImportProfile): Promise<ImportProfile> {
    const results = await this.db.insert(schema.importProfiles).values(profile).returning();
    return results[0];
  }

  async updateImportProfile(id: string, updates: Partial<InsertImportProfile>): Promise<ImportProfile | undefined> {
    const results = await this.db
      .update(schema.importProfiles)
      .set(updates)
      .where(eq(schema.importProfiles.id, id))
      .returning();
    return results[0];
  }

  async deleteImportProfile(id: string): Promise<boolean> {
    const results = await this.db.delete(schema.importProfiles).where(eq(schema.importProfiles.id, id)).returning();
    return results.length > 0;
  }

  // Import Jobs
  async getAllImportJobs(): Promise<ImportJob[]> {
    return await this.db.select().from(schema.importJobs);
  }

  async getImportJob(id: string): Promise<ImportJob | undefined> {
    const results = await this.db.select().from(schema.importJobs).where(eq(schema.importJobs.id, id));
    return results[0];
  }

  async createImportJob(job: InsertImportJob): Promise<ImportJob> {
    const results = await this.db.insert(schema.importJobs).values(job).returning();
    return results[0];
  }

  async updateImportJob(id: string, updates: Partial<InsertImportJob>): Promise<ImportJob | undefined> {
    const results = await this.db
      .update(schema.importJobs)
      .set(updates)
      .where(eq(schema.importJobs.id, id))
      .returning();
    return results[0];
  }

  async deleteImportJob(id: string): Promise<boolean> {
    const results = await this.db.delete(schema.importJobs).where(eq(schema.importJobs.id, id)).returning();
    return results.length > 0;
  }

  async getAllInventoryTransactions(): Promise<InventoryTransaction[]> {
    return await this.db.select().from(schema.inventoryTransactions);
  }

  async getInventoryTransactionsByItem(itemId: string): Promise<InventoryTransaction[]> {
    const results = await this.db
      .select()
      .from(schema.inventoryTransactions)
      .where(eq(schema.inventoryTransactions.itemId, itemId))
      .orderBy(drizzleSql`${schema.inventoryTransactions.createdAt} DESC`);
    return results;
  }

  async createInventoryTransaction(insertTransaction: InsertInventoryTransaction): Promise<InventoryTransaction> {
    const results = await this.db.insert(schema.inventoryTransactions).values(insertTransaction).returning();
    return results[0];
  }

  // Purchase Orders
  async getAllPurchaseOrders(): Promise<PurchaseOrder[]> {
    return await this.db.select().from(schema.purchaseOrders);
  }

  async getPurchaseOrder(id: string): Promise<PurchaseOrder | undefined> {
    const results = await this.db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, id));
    return results[0];
  }

  async getPurchaseOrdersBySupplierId(supplierId: string): Promise<PurchaseOrder[]> {
    return await this.db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.supplierId, supplierId));
  }

  async createPurchaseOrder(po: InsertPurchaseOrder): Promise<PurchaseOrder> {
    const results = await this.db.insert(schema.purchaseOrders).values(po).returning();
    return results[0];
  }

  async updatePurchaseOrder(id: string, updates: Partial<InsertPurchaseOrder>): Promise<PurchaseOrder | undefined> {
    const results = await this.db.update(schema.purchaseOrders).set(updates).where(eq(schema.purchaseOrders.id, id)).returning();
    return results[0];
  }

  async deletePurchaseOrder(id: string): Promise<boolean> {
    const results = await this.db.delete(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, id)).returning();
    return results.length > 0;
  }

  // Purchase Order Lines
  async getAllPurchaseOrderLines(): Promise<PurchaseOrderLine[]> {
    return await this.db.select().from(schema.purchaseOrderLines);
  }

  async getPurchaseOrderLinesByPOId(purchaseOrderId: string): Promise<PurchaseOrderLine[]> {
    return await this.db.select().from(schema.purchaseOrderLines).where(eq(schema.purchaseOrderLines.purchaseOrderId, purchaseOrderId));
  }

  async createPurchaseOrderLine(line: InsertPurchaseOrderLine): Promise<PurchaseOrderLine> {
    const results = await this.db.insert(schema.purchaseOrderLines).values(line).returning();
    return results[0];
  }

  async updatePurchaseOrderLine(id: string, updates: Partial<InsertPurchaseOrderLine>): Promise<PurchaseOrderLine | undefined> {
    const results = await this.db.update(schema.purchaseOrderLines).set(updates).where(eq(schema.purchaseOrderLines.id, id)).returning();
    return results[0];
  }

  async deletePurchaseOrderLine(id: string): Promise<boolean> {
    const results = await this.db.delete(schema.purchaseOrderLines).where(eq(schema.purchaseOrderLines.id, id)).returning();
    return results.length > 0;
  }

  // Supplier Leads
  async getAllSupplierLeads(): Promise<SupplierLead[]> {
    return await this.db.select().from(schema.supplierLeads);
  }

  async getSupplierLead(id: string): Promise<SupplierLead | undefined> {
    const results = await this.db.select().from(schema.supplierLeads).where(eq(schema.supplierLeads.id, id));
    return results[0];
  }

  async getSupplierLeadsByStatus(status: string): Promise<SupplierLead[]> {
    return await this.db.select().from(schema.supplierLeads).where(eq(schema.supplierLeads.status, status));
  }

  async createSupplierLead(lead: InsertSupplierLead): Promise<SupplierLead> {
    const results = await this.db.insert(schema.supplierLeads).values(lead).returning();
    return results[0];
  }

  async updateSupplierLead(id: string, updates: Partial<InsertSupplierLead>): Promise<SupplierLead | undefined> {
    const results = await this.db.update(schema.supplierLeads).set(updates).where(eq(schema.supplierLeads.id, id)).returning();
    return results[0];
  }

  async deleteSupplierLead(id: string): Promise<boolean> {
    const results = await this.db.delete(schema.supplierLeads).where(eq(schema.supplierLeads.id, id)).returning();
    return results.length > 0;
  }
}

// Use PostgreSQL storage with DATABASE_URL from environment
export const storage = process.env.DATABASE_URL 
  ? new PostgresStorage(process.env.DATABASE_URL)
  : new MemStorage();
