import { storage } from "./storage";
import bcrypt from "bcrypt";

const SALT_ROUNDS = 10;

async function seed() {
  console.log("Seeding database...");

  try {
    // Create demo user
    const existingUser = await storage.getUserByEmail("demo@example.com");
    if (!existingUser) {
      const hashedPassword = await bcrypt.hash("demo123", SALT_ROUNDS);
      await storage.createUser({
        email: "demo@example.com",
        password: hashedPassword,
      });
      console.log("✓ Created demo user (email: demo@example.com, password: demo123)");
    } else {
      console.log("✓ Demo user already exists");
    }

    // Create demo items (components) - idempotent
    let nut = await storage.getItemBySku("NUT-M8");
    if (!nut) {
      nut = await storage.createItem({
        name: "Hex Nut M8",
        sku: "NUT-M8",
        type: "component",
        unit: "units",
        currentStock: 500,
        minStock: 100,
        dailyUsage: 25,
      });
      console.log("✓ Created component: Hex Nut M8");
    } else {
      console.log("✓ Component already exists: Hex Nut M8");
    }

    let bolt = await storage.getItemBySku("BOLT-M8-50");
    if (!bolt) {
      bolt = await storage.createItem({
        name: "Hex Bolt M8x50",
        sku: "BOLT-M8-50",
        type: "component",
        unit: "units",
        currentStock: 450,
        minStock: 100,
        dailyUsage: 30,
      });
      console.log("✓ Created component: Hex Bolt M8x50");
    } else {
      console.log("✓ Component already exists: Hex Bolt M8x50");
    }

    let spring = await storage.getItemBySku("SPRING-20");
    if (!spring) {
      spring = await storage.createItem({
        name: "Compression Spring 20mm",
        sku: "SPRING-20",
        type: "component",
        unit: "units",
        currentStock: 200,
        minStock: 50,
        dailyUsage: 15,
      });
      console.log("✓ Created component: Compression Spring 20mm");
    } else {
      console.log("✓ Component already exists: Compression Spring 20mm");
    }

    let bar = await storage.getItemBySku("BAR-500");
    if (!bar) {
      bar = await storage.createItem({
        name: "Steel Bar 500mm",
        sku: "BAR-500",
        type: "component",
        unit: "units",
        currentStock: 150,
        minStock: 30,
        dailyUsage: 10,
      });
      console.log("✓ Created component: Steel Bar 500mm");
    } else {
      console.log("✓ Component already exists: Steel Bar 500mm");
    }

    // Create finished products - idempotent
    let widgetA = await storage.getItemBySku("WIDGET-A");
    if (!widgetA) {
      widgetA = await storage.createItem({
        name: "Widget A",
        sku: "WIDGET-A",
        type: "finished_product",
        unit: "units",
        currentStock: 25,
        minStock: 10,
        dailyUsage: 5,
      });
      console.log("✓ Created finished product: Widget A");
    } else {
      console.log("✓ Finished product already exists: Widget A");
    }

    let gadgetB = await storage.getItemBySku("GADGET-B");
    if (!gadgetB) {
      gadgetB = await storage.createItem({
        name: "Gadget B",
        sku: "GADGET-B",
        type: "finished_product",
        unit: "units",
        currentStock: 15,
        minStock: 5,
        dailyUsage: 3,
      });
      console.log("✓ Created finished product: Gadget B");
    } else {
      console.log("✓ Finished product already exists: Gadget B");
    }

    // Create BOM for Widget A (4 nuts, 4 bolts, 2 springs, 1 bar) - idempotent
    const widgetABom = await storage.getBillOfMaterialsByProductId(widgetA.id);
    if (widgetABom.length === 0) {
      await storage.createBillOfMaterials({
        finishedProductId: widgetA.id,
        componentId: nut.id,
        quantityRequired: 4,
      });

      await storage.createBillOfMaterials({
        finishedProductId: widgetA.id,
        componentId: bolt.id,
        quantityRequired: 4,
      });

      await storage.createBillOfMaterials({
        finishedProductId: widgetA.id,
        componentId: spring.id,
        quantityRequired: 2,
      });

      await storage.createBillOfMaterials({
        finishedProductId: widgetA.id,
        componentId: bar.id,
        quantityRequired: 1,
      });
      console.log("✓ Created BOM for Widget A");
    } else {
      console.log("✓ BOM for Widget A already exists");
    }

    // Create BOM for Gadget B (2 nuts, 2 bolts, 3 springs) - idempotent
    const gadgetBBom = await storage.getBillOfMaterialsByProductId(gadgetB.id);
    if (gadgetBBom.length === 0) {
      await storage.createBillOfMaterials({
        finishedProductId: gadgetB.id,
        componentId: nut.id,
        quantityRequired: 2,
      });

      await storage.createBillOfMaterials({
        finishedProductId: gadgetB.id,
        componentId: bolt.id,
        quantityRequired: 2,
      });

      await storage.createBillOfMaterials({
        finishedProductId: gadgetB.id,
        componentId: spring.id,
        quantityRequired: 3,
      });
      console.log("✓ Created BOM for Gadget B");
    } else {
      console.log("✓ BOM for Gadget B already exists");
    }

    // Create bins - idempotent
    const allBins = await storage.getAllBins();
    let binA1 = allBins.find(b => b.code === "A-01");
    if (!binA1) {
      binA1 = await storage.createBin({
        code: "A-01",
        name: "Shelf A Row 1",
        location: "Warehouse 1",
      });
      console.log("✓ Created bin: A-01");
    } else {
      console.log("✓ Bin already exists: A-01");
    }

    let binA2 = allBins.find(b => b.code === "A-02");
    if (!binA2) {
      binA2 = await storage.createBin({
        code: "A-02",
        name: "Shelf A Row 2",
        location: "Warehouse 1",
      });
      console.log("✓ Created bin: A-02");
    } else {
      console.log("✓ Bin already exists: A-02");
    }

    let binB1 = allBins.find(b => b.code === "B-01");
    if (!binB1) {
      binB1 = await storage.createBin({
        code: "B-01",
        name: "Shelf B Row 1",
        location: "Warehouse 1",
      });
      console.log("✓ Created bin: B-01");
    } else {
      console.log("✓ Bin already exists: B-01");
    }

    // Create inventory by bin - idempotent
    const allInventoryByBin = await storage.getAllInventoryByBin();
    const createInventoryIfNotExists = async (itemId: string, binId: string, quantity: number, itemName: string, binCode: string) => {
      const exists = allInventoryByBin.find(inv => inv.itemId === itemId && inv.binId === binId);
      if (!exists) {
        await storage.createInventoryByBin({ itemId, binId, quantity });
        console.log(`✓ Created inventory: ${itemName} in ${binCode}`);
      } else {
        console.log(`✓ Inventory already exists: ${itemName} in ${binCode}`);
      }
    };

    await createInventoryIfNotExists(nut.id, binA1.id, 300, "Hex Nut M8", "A-01");
    await createInventoryIfNotExists(nut.id, binA2.id, 200, "Hex Nut M8", "A-02");
    await createInventoryIfNotExists(bolt.id, binA1.id, 450, "Hex Bolt M8x50", "A-01");
    await createInventoryIfNotExists(spring.id, binB1.id, 200, "Compression Spring 20mm", "B-01");
    await createInventoryIfNotExists(bar.id, binB1.id, 150, "Steel Bar 500mm", "B-01");

    // Create suppliers - idempotent
    const allSuppliers = await storage.getAllSuppliers();
    let acmeCorp = allSuppliers.find(s => s.name === "Acme Corp");
    if (!acmeCorp) {
      acmeCorp = await storage.createSupplier({
        name: "Acme Corp",
        catalogUrl: "https://acme-corp.example.com",
      });
      console.log("✓ Created supplier: Acme Corp");
    } else {
      console.log("✓ Supplier already exists: Acme Corp");
    }

    let globalSupply = allSuppliers.find(s => s.name === "Global Supply Co");
    if (!globalSupply) {
      globalSupply = await storage.createSupplier({
        name: "Global Supply Co",
        catalogUrl: "https://globalsupply.example.com",
      });
      console.log("✓ Created supplier: Global Supply Co");
    } else {
      console.log("✓ Supplier already exists: Global Supply Co");
    }

    // Create supplier items - idempotent
    const allSupplierItems = await storage.getAllSupplierItems();
    const createSupplierItemIfNotExists = async (supplierId: string, itemId: string, price: number, availableQuantity: number, leadTimeDays: number, supplierName: string, itemName: string) => {
      const exists = allSupplierItems.find(si => si.supplierId === supplierId && si.itemId === itemId);
      if (!exists) {
        await storage.createSupplierItem({
          supplierId,
          itemId,
          price,
          availableQuantity,
          leadTimeDays,
          isDesignatedSupplier: true,
        });
        console.log(`✓ Created supplier item: ${supplierName} - ${itemName}`);
      } else {
        console.log(`✓ Supplier item already exists: ${supplierName} - ${itemName}`);
      }
    };

    await createSupplierItemIfNotExists(acmeCorp.id, nut.id, 0.15, 10000, 3, "Acme Corp", "Hex Nut M8");
    await createSupplierItemIfNotExists(acmeCorp.id, bolt.id, 0.25, 8000, 3, "Acme Corp", "Hex Bolt M8x50");
    await createSupplierItemIfNotExists(globalSupply.id, spring.id, 1.50, 5000, 5, "Global Supply Co", "Compression Spring 20mm");
    await createSupplierItemIfNotExists(globalSupply.id, bar.id, 3.75, 2000, 7, "Global Supply Co", "Steel Bar 500mm");

    // Create sales history
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const twoDaysAgo = new Date(today);
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

    await storage.createSalesHistory({
      itemId: widgetA.id,
      quantitySold: 5,
      saleDate: today,
      externalOrderId: "GHL-001",
    });

    await storage.createSalesHistory({
      itemId: widgetA.id,
      quantitySold: 3,
      saleDate: yesterday,
      externalOrderId: "GHL-002",
    });

    await storage.createSalesHistory({
      itemId: gadgetB.id,
      quantitySold: 2,
      saleDate: twoDaysAgo,
      externalOrderId: "GHL-003",
    });

    console.log("✓ Created sales history");

    // Create integration health records
    await storage.createOrUpdateIntegrationHealth({
      integrationName: "gohighlevel",
      lastSuccessAt: today,
      lastStatus: "connected",
    });

    await storage.createOrUpdateIntegrationHealth({
      integrationName: "extensiv",
      lastSuccessAt: yesterday,
      lastStatus: "connected",
    });

    await storage.createOrUpdateIntegrationHealth({
      integrationName: "phantombuster",
      lastSuccessAt: null,
      lastStatus: "pending_setup",
    });

    await storage.createOrUpdateIntegrationHealth({
      integrationName: "shopify",
      lastSuccessAt: null,
      lastStatus: "pending_setup",
    });

    console.log("✓ Created integration health records");

    // Create finished inventory snapshots
    await storage.createFinishedInventorySnapshot({
      itemId: widgetA.id,
      quantity: 50,
      location: "Extensiv Warehouse",
      snapshotDate: today,
    });

    await storage.createFinishedInventorySnapshot({
      itemId: gadgetB.id,
      quantity: 30,
      location: "Extensiv Warehouse",
      snapshotDate: today,
    });

    console.log("✓ Created finished inventory snapshots");

    // Create barcodes - idempotent
    const createBarcodeIfNotExists = async (value: string, name: string, sku: string | undefined, purpose: string, referenceId: string) => {
      const exists = await storage.getBarcodeByValue(value);
      if (!exists) {
        await storage.createBarcode({ value, name, sku, purpose, referenceId });
        console.log(`✓ Created barcode: ${name}`);
      } else {
        console.log(`✓ Barcode already exists: ${name}`);
      }
    };

    await createBarcodeIfNotExists("NUT-M8-BC001", "Hex Nut M8 Barcode", "NUT-M8", "item", nut.id);
    await createBarcodeIfNotExists("BOLT-M8-50-BC001", "Hex Bolt M8x50 Barcode", "BOLT-M8-50", "item", bolt.id);
    await createBarcodeIfNotExists("BIN-A01-BC001", "Bin A-01 Barcode", undefined, "bin", binA1.id);

    console.log("\n✅ Database seeded successfully!");
  } catch (error) {
    console.error("❌ Error seeding database:", error);
    throw error;
  }
}

// Run seed if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  seed()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

export { seed };
