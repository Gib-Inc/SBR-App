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
} from "@shared/schema";
import { randomUUID } from "crypto";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, count, sql as drizzleSql } from "drizzle-orm";
import * as schema from "@shared/schema";

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, user: Partial<InsertUser>): Promise<User | undefined>;

  // Items
  getAllItems(): Promise<Item[]>;
  getItemsWithBOMCounts(): Promise<Array<Item & { componentsCount?: number }>>;
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
      productKind: "RAW",
      barcodeValue: "COMP-NUT-001",
      barcodeFormat: "CODE128",
      barcodeUsage: "INTERNAL_STOCK",
      barcodeSource: "AUTO_GENERATED",
      externalSystem: null,
      externalId: null,
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
      productKind: "RAW",
      barcodeValue: "COMP-BOLT-001",
      barcodeFormat: "CODE128",
      barcodeUsage: "INTERNAL_STOCK",
      barcodeSource: "AUTO_GENERATED",
      externalSystem: null,
      externalId: null,
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
      productKind: "RAW",
      barcodeValue: "COMP-SPR-001",
      barcodeFormat: "CODE128",
      barcodeUsage: "INTERNAL_STOCK",
      barcodeSource: "AUTO_GENERATED",
      externalSystem: null,
      externalId: null,
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
      productKind: "RAW",
      barcodeValue: "COMP-BAR-001",
      barcodeFormat: "CODE128",
      barcodeUsage: "INTERNAL_STOCK",
      barcodeSource: "AUTO_GENERATED",
      externalSystem: null,
      externalId: null,
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
      productKind: "FINISHED",
      barcodeValue: "PROD-SBR-001",
      barcodeFormat: "CODE128",
      barcodeUsage: "EXTERNAL_GS1",
      barcodeSource: "AUTO_GENERATED",
      externalSystem: null,
      externalId: null,
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

  async getItemsWithBOMCounts(): Promise<Array<Item & { componentsCount?: number }>> {
    const items = Array.from(this.items.values());
    const itemsWithCounts = items.map((item) => {
      if (item.type === "finished_product") {
        const bomEntries = Array.from(this.billOfMaterials.values()).filter(
          (bom) => bom.finishedProductId === item.id
        );
        return { ...item, componentsCount: bomEntries.length };
      }
      // For components, explicitly return undefined to match PostgresStorage behavior
      return { ...item, componentsCount: undefined };
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
    const item: Item = {
      id,
      name: insertItem.name,
      sku: insertItem.sku,
      type: insertItem.type,
      unit: insertItem.unit || 'units',
      currentStock: insertItem.currentStock ?? 0,
      minStock: insertItem.minStock ?? 0,
      dailyUsage: insertItem.dailyUsage ?? 0,
      barcode: insertItem.barcode ?? null,
      location: insertItem.location ?? null,
      productKind: insertItem.productKind ?? null,
      barcodeValue: insertItem.barcodeValue ?? null,
      barcodeFormat: insertItem.barcodeFormat ?? null,
      barcodeUsage: insertItem.barcodeUsage ?? null,
      barcodeSource: insertItem.barcodeSource ?? null,
      externalSystem: insertItem.externalSystem ?? null,
      externalId: insertItem.externalId ?? null,
    };
    this.items.set(id, item);
    return item;
  }

  async updateItem(id: string, updateData: Partial<InsertItem>): Promise<Item | undefined> {
    const item = this.items.get(id);
    if (!item) return undefined;
    const updated = { ...item, ...updateData };
    this.items.set(id, updated);
    return updated;
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
      price: insertSupplierItem.price ?? null,
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

  async getItemsWithBOMCounts(): Promise<Array<Item & { componentsCount?: number }>> {
    // Use LEFT JOIN + COUNT to efficiently get BOM counts in a single query
    // Cast COUNT to integer explicitly to ensure consistent numeric type
    const results = await this.db
      .select({
        items: schema.items,
        componentsCount: drizzleSql<number>`CAST(COUNT(${schema.billOfMaterials.id}) AS INTEGER)`,
      })
      .from(schema.items)
      .leftJoin(
        schema.billOfMaterials,
        eq(schema.items.id, schema.billOfMaterials.finishedProductId)
      )
      .groupBy(schema.items.id);
    
    // Map results to include componentsCount only for finished products
    // For components (non-finished products), return undefined instead of 0
    return results.map((row) => ({
      ...row.items,
      componentsCount: row.items.type === "finished_product" ? row.componentsCount : undefined,
    }));
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
    const results = await this.db.insert(schema.items).values(insertItem).returning();
    return results[0];
  }

  async updateItem(id: string, updateData: Partial<InsertItem>): Promise<Item | undefined> {
    const results = await this.db.update(schema.items).set(updateData).where(eq(schema.items.id, id)).returning();
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
}

// Use PostgreSQL storage with DATABASE_URL from environment
export const storage = process.env.DATABASE_URL 
  ? new PostgresStorage(process.env.DATABASE_URL)
  : new MemStorage();
