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

    // Create demo items (components)
    const nut = await storage.createItem({
      name: "Hex Nut M8",
      sku: "NUT-M8",
      type: "component",
      unit: "units",
      currentStock: 500,
      minStock: 100,
      dailyUsage: 25,
    });

    const bolt = await storage.createItem({
      name: "Hex Bolt M8x50",
      sku: "BOLT-M8-50",
      type: "component",
      unit: "units",
      currentStock: 450,
      minStock: 100,
      dailyUsage: 30,
    });

    const spring = await storage.createItem({
      name: "Compression Spring 20mm",
      sku: "SPRING-20",
      type: "component",
      unit: "units",
      currentStock: 200,
      minStock: 50,
      dailyUsage: 15,
    });

    const bar = await storage.createItem({
      name: "Steel Bar 500mm",
      sku: "BAR-500",
      type: "component",
      unit: "units",
      currentStock: 150,
      minStock: 30,
      dailyUsage: 10,
    });

    console.log("✓ Created components");

    // Create finished products
    const widgetA = await storage.createItem({
      name: "Widget A",
      sku: "WIDGET-A",
      type: "finished_product",
      unit: "units",
      currentStock: 25,
      minStock: 10,
      dailyUsage: 5,
    });

    const gadgetB = await storage.createItem({
      name: "Gadget B",
      sku: "GADGET-B",
      type: "finished_product",
      unit: "units",
      currentStock: 15,
      minStock: 5,
      dailyUsage: 3,
    });

    console.log("✓ Created finished products");

    // Create BOM for Widget A (4 nuts, 4 bolts, 2 springs, 1 bar)
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

    // Create BOM for Gadget B (2 nuts, 2 bolts, 3 springs)
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

    console.log("✓ Created Bill of Materials");

    // Create bins
    const binA1 = await storage.createBin({
      code: "A-01",
      name: "Shelf A Row 1",
      location: "Warehouse 1",
    });

    const binA2 = await storage.createBin({
      code: "A-02",
      name: "Shelf A Row 2",
      location: "Warehouse 1",
    });

    const binB1 = await storage.createBin({
      code: "B-01",
      name: "Shelf B Row 1",
      location: "Warehouse 1",
    });

    console.log("✓ Created bins");

    // Create inventory by bin
    await storage.createInventoryByBin({
      itemId: nut.id,
      binId: binA1.id,
      quantity: 300,
    });

    await storage.createInventoryByBin({
      itemId: nut.id,
      binId: binA2.id,
      quantity: 200,
    });

    await storage.createInventoryByBin({
      itemId: bolt.id,
      binId: binA1.id,
      quantity: 450,
    });

    await storage.createInventoryByBin({
      itemId: spring.id,
      binId: binB1.id,
      quantity: 200,
    });

    await storage.createInventoryByBin({
      itemId: bar.id,
      binId: binB1.id,
      quantity: 150,
    });

    console.log("✓ Created inventory by bin records");

    // Create suppliers
    const acmeCorp = await storage.createSupplier({
      name: "Acme Corp",
      catalogUrl: "https://acme-corp.example.com",
    });

    const globalSupply = await storage.createSupplier({
      name: "Global Supply Co",
      catalogUrl: "https://globalsupply.example.com",
    });

    console.log("✓ Created suppliers");

    // Create supplier items
    await storage.createSupplierItem({
      supplierId: acmeCorp.id,
      itemId: nut.id,
      price: 0.15,
      availableQuantity: 10000,
      leadTimeDays: 3,
      isDesignatedSupplier: true,
    });

    await storage.createSupplierItem({
      supplierId: acmeCorp.id,
      itemId: bolt.id,
      price: 0.25,
      availableQuantity: 8000,
      leadTimeDays: 3,
      isDesignatedSupplier: true,
    });

    await storage.createSupplierItem({
      supplierId: globalSupply.id,
      itemId: spring.id,
      price: 1.50,
      availableQuantity: 5000,
      leadTimeDays: 5,
      isDesignatedSupplier: true,
    });

    await storage.createSupplierItem({
      supplierId: globalSupply.id,
      itemId: bar.id,
      price: 3.75,
      availableQuantity: 2000,
      leadTimeDays: 7,
      isDesignatedSupplier: true,
    });

    console.log("✓ Created supplier items");

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

    // Create barcodes
    await storage.createBarcode({
      value: "NUT-M8-BC001",
      name: "Hex Nut M8 Barcode",
      sku: "NUT-M8",
      purpose: "item",
      referenceId: nut.id,
    });

    await storage.createBarcode({
      value: "BOLT-M8-50-BC001",
      name: "Hex Bolt M8x50 Barcode",
      sku: "BOLT-M8-50",
      purpose: "item",
      referenceId: bolt.id,
    });

    await storage.createBarcode({
      value: "BIN-A01-BC001",
      name: "Bin A-01 Barcode",
      purpose: "bin",
      referenceId: binA1.id,
    });

    console.log("✓ Created barcodes");

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
