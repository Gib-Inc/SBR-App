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
        barcodeValue: "NUT-M8",
        productKind: "RAW",
        barcodeFormat: "CODE128",
        barcodeUsage: "INTERNAL_STOCK",
        barcodeSource: "AUTO_GENERATED",
      });
    } else if (!nut.barcodeValue) {
      await storage.updateItem(nut.id, {
        barcodeValue: "NUT-M8",
        productKind: "RAW",
        barcodeFormat: "CODE128",
        barcodeUsage: "INTERNAL_STOCK",
        barcodeSource: "AUTO_GENERATED",
      });
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
        barcodeValue: "BOLT-M8-50",
        productKind: "RAW",
        barcodeFormat: "CODE128",
        barcodeUsage: "INTERNAL_STOCK",
        barcodeSource: "AUTO_GENERATED",
      });
    } else if (!bolt.barcodeValue) {
      await storage.updateItem(bolt.id, {
        barcodeValue: "BOLT-M8-50",
        productKind: "RAW",
        barcodeFormat: "CODE128",
        barcodeUsage: "INTERNAL_STOCK",
        barcodeSource: "AUTO_GENERATED",
      });
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
        barcodeValue: "SPRING-20",
        productKind: "RAW",
        barcodeFormat: "CODE128",
        barcodeUsage: "INTERNAL_STOCK",
        barcodeSource: "AUTO_GENERATED",
      });
    } else if (!spring.barcodeValue) {
      await storage.updateItem(spring.id, {
        barcodeValue: "SPRING-20",
        productKind: "RAW",
        barcodeFormat: "CODE128",
        barcodeUsage: "INTERNAL_STOCK",
        barcodeSource: "AUTO_GENERATED",
      });
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
        barcodeValue: "BAR-500",
        productKind: "RAW",
        barcodeFormat: "CODE128",
        barcodeUsage: "INTERNAL_STOCK",
        barcodeSource: "AUTO_GENERATED",
      });
    } else if (!bar.barcodeValue) {
      await storage.updateItem(bar.id, {
        barcodeValue: "BAR-500",
        productKind: "RAW",
        barcodeFormat: "CODE128",
        barcodeUsage: "INTERNAL_STOCK",
        barcodeSource: "AUTO_GENERATED",
      });
    }

    console.log("✓ Components ready");

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
        barcodeValue: "WIDGET-A",
        productKind: "FINISHED",
        barcodeFormat: "CODE128",
        barcodeUsage: "EXTERNAL_GS1",
        barcodeSource: "AUTO_GENERATED",
      });
    } else if (!widgetA.barcodeValue) {
      await storage.updateItem(widgetA.id, {
        barcodeValue: "WIDGET-A",
        productKind: "FINISHED",
        barcodeFormat: "CODE128",
        barcodeUsage: "EXTERNAL_GS1",
        barcodeSource: "AUTO_GENERATED",
      });
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
        barcodeValue: "GADGET-B",
        productKind: "FINISHED",
        barcodeFormat: "CODE128",
        barcodeUsage: "EXTERNAL_GS1",
        barcodeSource: "AUTO_GENERATED",
      });
    } else if (!gadgetB.barcodeValue) {
      await storage.updateItem(gadgetB.id, {
        barcodeValue: "GADGET-B",
        productKind: "FINISHED",
        barcodeFormat: "CODE128",
        barcodeUsage: "EXTERNAL_GS1",
        barcodeSource: "AUTO_GENERATED",
      });
    }

    console.log("✓ Finished products ready");

    // Create BOM - idempotent (skip if BOMs already exist for products)
    const existingWidgetABom = await storage.getBillOfMaterialsByProductId(widgetA.id);
    if (existingWidgetABom.length === 0) {
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
    }

    const existingGadgetBBom = await storage.getBillOfMaterialsByProductId(gadgetB.id);
    if (existingGadgetBBom.length === 0) {
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
    }

    console.log("✓ Bill of Materials ready");

    // Create bins - idempotent (skip if bins already exist)
    const existingBins = await storage.getAllBins();
    let binA1, binA2, binB1;
    
    if (existingBins.length === 0) {
      binA1 = await storage.createBin({
        code: "A-01",
        name: "Shelf A Row 1",
        location: "Warehouse 1",
      });

      binA2 = await storage.createBin({
        code: "A-02",
        name: "Shelf A Row 2",
        location: "Warehouse 1",
      });

      binB1 = await storage.createBin({
        code: "B-01",
        name: "Shelf B Row 1",
        location: "Warehouse 1",
      });
    } else {
      binA1 = existingBins.find(b => b.code === "A-01") || existingBins[0];
      binA2 = existingBins.find(b => b.code === "A-02") || existingBins[1] || existingBins[0];
      binB1 = existingBins.find(b => b.code === "B-01") || existingBins[2] || existingBins[0];
    }

    console.log("✓ Bins ready");

    // Create inventory by bin - idempotent (skip if data exists)
    const existingInventory = await storage.getAllInventoryByBin();
    if (existingInventory.length === 0) {
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
    }

    console.log("✓ Inventory by bin ready");

    // Create suppliers - idempotent (skip if data exists)
    const existingSuppliers = await storage.getAllSuppliers();
    let acmeCorp, globalSupply;
    
    if (existingSuppliers.length === 0) {
      acmeCorp = await storage.createSupplier({
        name: "Acme Corp",
        catalogUrl: "https://acme-corp.example.com",
      });

      globalSupply = await storage.createSupplier({
        name: "Global Supply Co",
        catalogUrl: "https://globalsupply.example.com",
      });
    } else {
      acmeCorp = existingSuppliers.find(s => s.name === "Acme Corp") || existingSuppliers[0];
      globalSupply = existingSuppliers.find(s => s.name === "Global Supply Co") || existingSuppliers[1] || existingSuppliers[0];
    }

    console.log("✓ Suppliers ready");

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

    console.log("✓ Supplier items ready");

    // Define date variables for seeding
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    // Create sales history - idempotent (skip if data exists)
    const existingSalesHistory = await storage.getAllSalesHistory();
    if (existingSalesHistory.length === 0) {
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
    }

    console.log("✓ Sales history ready");

    // Create integration health records (createOrUpdate is already idempotent)
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

    console.log("✓ Integration health records ready");

    // Create finished inventory snapshots - idempotent (skip if data exists)
    const existingSnapshots = await storage.getAllFinishedInventorySnapshots();
    if (existingSnapshots.length === 0) {
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
    }

    console.log("✓ Finished inventory snapshots ready");

    // Create barcodes - idempotent (skip if data exists)
    const existingBarcodes = await storage.getAllBarcodes();
    if (existingBarcodes.length === 0) {
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
    }

    console.log("✓ Barcodes ready");

    // Create sample purchase orders - idempotent
    const existingPOs = await storage.getAllPurchaseOrders();
    if (existingPOs.length === 0) {
      // PO 1: Draft status
      const po1 = await storage.createPurchaseOrder({
        poNumber: "PO-2025-0001",
        supplierId: acmeCorp.id,
        status: "DRAFT",
        orderDate: new Date("2025-11-20"),
        expectedDate: new Date("2025-12-05"),
        ghlRepName: "Sarah Chen",
      });
      await storage.createPurchaseOrderLine({
        purchaseOrderId: po1.id,
        itemId: nut.id,
        qtyOrdered: 1000,
        qtyReceived: 0,
        unitCost: 0.15,
      });
      await storage.createPurchaseOrderLine({
        purchaseOrderId: po1.id,
        itemId: bolt.id,
        qtyOrdered: 500,
        qtyReceived: 0,
        unitCost: 0.25,
      });

      // PO 2: Sent status (awaiting delivery)
      const po2 = await storage.createPurchaseOrder({
        poNumber: "PO-2025-0002",
        supplierId: globalSupply.id,
        status: "SENT",
        orderDate: new Date("2025-11-15"),
        expectedDate: new Date("2025-11-30"),
        ghlRepName: "Mike Johnson",
      });
      await storage.createPurchaseOrderLine({
        purchaseOrderId: po2.id,
        itemId: spring.id,
        qtyOrdered: 300,
        qtyReceived: 0,
        unitCost: 1.50,
      });
      await storage.createPurchaseOrderLine({
        purchaseOrderId: po2.id,
        itemId: bar.id,
        qtyOrdered: 200,
        qtyReceived: 0,
        unitCost: 5.00,
      });

      // PO 3: Partial Received status
      const po3 = await storage.createPurchaseOrder({
        poNumber: "PO-2025-0003",
        supplierId: acmeCorp.id,
        status: "PARTIAL_RECEIVED",
        orderDate: new Date("2025-11-10"),
        expectedDate: new Date("2025-11-25"),
        ghlRepName: "Sarah Chen",
      });
      await storage.createPurchaseOrderLine({
        purchaseOrderId: po3.id,
        itemId: nut.id,
        qtyOrdered: 2000,
        qtyReceived: 1000,
        unitCost: 0.14,
      });
      await storage.createPurchaseOrderLine({
        purchaseOrderId: po3.id,
        itemId: bolt.id,
        qtyOrdered: 1500,
        qtyReceived: 0,
        unitCost: 0.24,
      });

      // PO 4: Received status (ready to confirm)
      const po4 = await storage.createPurchaseOrder({
        poNumber: "PO-2025-0004",
        supplierId: globalSupply.id,
        status: "RECEIVED",
        orderDate: new Date("2025-11-05"),
        expectedDate: new Date("2025-11-20"),
        receivedAt: new Date("2025-11-18"),
        ghlRepName: "Mike Johnson",
      });
      await storage.createPurchaseOrderLine({
        purchaseOrderId: po4.id,
        itemId: spring.id,
        qtyOrdered: 500,
        qtyReceived: 500,
        unitCost: 1.45,
      });
      await storage.createPurchaseOrderLine({
        purchaseOrderId: po4.id,
        itemId: bar.id,
        qtyOrdered: 100,
        qtyReceived: 100,
        unitCost: 4.95,
      });

      console.log("✓ Created 4 sample purchase orders (Draft, Sent, Partial Received, Received)");
    } else {
      console.log("✓ Purchase orders already exist");
    }

    // Create sample sales orders from Shopify and Amazon - idempotent
    const existingSalesOrders = await storage.getAllSalesOrders();
    if (existingSalesOrders.length === 0) {
      // Shopify Order 1 - Fulfilled
      const shopifyOrder1 = await storage.createSalesOrder({
        externalOrderId: "SHOP-4567890123",
        externalCustomerId: "cust_shopify_12345",
        channel: "SHOPIFY",
        customerName: "Emily Rodriguez",
        customerEmail: "emily.r@example.com",
        customerPhone: "+1-555-0123",
        status: "FULFILLED",
        orderDate: new Date("2025-11-22"),
        totalAmount: 149.99,
        currency: "USD",
        rawPayload: { source: "demo_seed", platform: "shopify" },
      });
      await storage.createSalesOrderLine({
        salesOrderId: shopifyOrder1.id,
        productId: widgetA.id,
        sku: widgetA.sku,
        qtyOrdered: 3,
        qtyAllocated: 3,
        qtyShipped: 3,
        unitPrice: 49.99,
      });

      // Shopify Order 2 - Partially Fulfilled
      const shopifyOrder2 = await storage.createSalesOrder({
        externalOrderId: "SHOP-4567890124",
        externalCustomerId: "cust_shopify_67890",
        channel: "SHOPIFY",
        customerName: "Michael Chen",
        customerEmail: "m.chen@example.com",
        status: "PARTIALLY_FULFILLED",
        orderDate: new Date("2025-11-23"),
        totalAmount: 269.95,
        currency: "USD",
        rawPayload: { source: "demo_seed", platform: "shopify" },
      });
      await storage.createSalesOrderLine({
        salesOrderId: shopifyOrder2.id,
        productId: widgetA.id,
        sku: widgetA.sku,
        qtyOrdered: 2,
        qtyAllocated: 2,
        qtyShipped: 1,
        unitPrice: 49.99,
      });
      await storage.createSalesOrderLine({
        salesOrderId: shopifyOrder2.id,
        productId: gadgetB.id,
        sku: gadgetB.sku,
        qtyOrdered: 3,
        qtyAllocated: 3,
        qtyShipped: 2,
        unitPrice: 56.99,
      });

      // Shopify Order 3 - Open (new order)
      const shopifyOrder3 = await storage.createSalesOrder({
        externalOrderId: "SHOP-4567890125",
        externalCustomerId: "cust_shopify_11111",
        channel: "SHOPIFY",
        customerName: "Sarah Johnson",
        customerEmail: "sarah.j@example.com",
        customerPhone: "+1-555-0198",
        status: "OPEN",
        orderDate: today,
        totalAmount: 99.98,
        currency: "USD",
        rawPayload: { source: "demo_seed", platform: "shopify" },
      });
      await storage.createSalesOrderLine({
        salesOrderId: shopifyOrder3.id,
        productId: widgetA.id,
        sku: widgetA.sku,
        qtyOrdered: 2,
        qtyAllocated: 2,
        qtyShipped: 0,
        unitPrice: 49.99,
      });

      // Amazon Order 1 - Fulfilled
      const amazonOrder1 = await storage.createSalesOrder({
        externalOrderId: "AMZ-113-7654321-9876543",
        channel: "AMAZON",
        customerName: "James Anderson",
        customerEmail: "j.anderson@marketplace.amazon.com",
        status: "FULFILLED",
        orderDate: new Date("2025-11-21"),
        totalAmount: 113.98,
        currency: "USD",
        rawPayload: { source: "demo_seed", platform: "amazon" },
      });
      await storage.createSalesOrderLine({
        salesOrderId: amazonOrder1.id,
        productId: gadgetB.id,
        sku: gadgetB.sku,
        qtyOrdered: 2,
        qtyAllocated: 2,
        qtyShipped: 2,
        unitPrice: 56.99,
      });

      // Amazon Order 2 - Open
      const amazonOrder2 = await storage.createSalesOrder({
        externalOrderId: "AMZ-113-8765432-1234567",
        channel: "AMAZON",
        customerName: "Maria Garcia",
        customerEmail: "m.garcia@marketplace.amazon.com",
        customerPhone: "+1-555-0234",
        status: "OPEN",
        orderDate: yesterday,
        totalAmount: 219.94,
        currency: "USD",
        rawPayload: { source: "demo_seed", platform: "amazon" },
      });
      await storage.createSalesOrderLine({
        salesOrderId: amazonOrder2.id,
        productId: widgetA.id,
        sku: widgetA.sku,
        qtyOrdered: 2,
        qtyAllocated: 2,
        qtyShipped: 0,
        unitPrice: 49.99,
      });
      await storage.createSalesOrderLine({
        salesOrderId: amazonOrder2.id,
        productId: gadgetB.id,
        sku: gadgetB.sku,
        qtyOrdered: 2,
        qtyAllocated: 1,
        qtyShipped: 0,
        unitPrice: 59.98,
      });

      // Amazon Order 3 - Cancelled
      const amazonOrder3 = await storage.createSalesOrder({
        externalOrderId: "AMZ-113-9876543-2345678",
        channel: "AMAZON",
        customerName: "David Kim",
        customerEmail: "d.kim@marketplace.amazon.com",
        status: "CANCELLED",
        orderDate: new Date("2025-11-19"),
        totalAmount: 49.99,
        currency: "USD",
        rawPayload: { source: "demo_seed", platform: "amazon" },
      });
      await storage.createSalesOrderLine({
        salesOrderId: amazonOrder3.id,
        productId: widgetA.id,
        sku: widgetA.sku,
        qtyOrdered: 1,
        qtyAllocated: 0,
        qtyShipped: 0,
        unitPrice: 49.99,
      });

      console.log("✓ Created 6 sample sales orders (3 Shopify, 3 Amazon)");

      // Create sample return requests linked to sales orders - idempotent
      // Return 1: Shopify return for defective product
      const shopifyReturn1 = await storage.createReturnRequest({
        externalOrderId: shopifyOrder1.externalOrderId!,
        salesChannel: "SHOPIFY",
        salesOrderId: shopifyOrder1.id,
        customerName: shopifyOrder1.customerName,
        customerEmail: shopifyOrder1.customerEmail,
        customerPhone: shopifyOrder1.customerPhone,
        status: "RECEIVED",
        resolutionRequested: "REFUND",
        resolutionFinal: "REFUND",
        reason: "Product arrived damaged",
        initiatedVia: "CUSTOMER_PORTAL",
        labelProvider: "SHOPIFY",
      });
      const shopifyOrder1Lines = await storage.getSalesOrderLines(shopifyOrder1.id);
      await storage.createReturnItem({
        returnRequestId: shopifyReturn1.id,
        salesOrderLineId: shopifyOrder1Lines[0].id,
        inventoryItemId: widgetA.id,
        sku: widgetA.sku,
        qtyOrdered: 3,
        qtyRequested: 1,
        qtyApproved: 1,
        qtyReceived: 1,
        itemReason: "DEFECTIVE",
        disposition: "SCRAP",
        notes: "Product damaged during shipping",
      });

      // Return 2: Amazon return for wrong item
      const amazonReturn1 = await storage.createReturnRequest({
        externalOrderId: amazonOrder1.externalOrderId!,
        salesChannel: "AMAZON",
        salesOrderId: amazonOrder1.id,
        customerName: amazonOrder1.customerName,
        customerEmail: amazonOrder1.customerEmail,
        status: "LABEL_ISSUED",
        resolutionRequested: "REPLACEMENT",
        reason: "Wrong item received",
        initiatedVia: "AMAZON_PORTAL",
        labelProvider: "AMAZON",
      });
      const amazonOrder1Lines = await storage.getSalesOrderLines(amazonOrder1.id);
      await storage.createReturnItem({
        returnRequestId: amazonReturn1.id,
        salesOrderLineId: amazonOrder1Lines[0].id,
        inventoryItemId: gadgetB.id,
        sku: gadgetB.sku,
        qtyOrdered: 2,
        qtyRequested: 1,
        qtyApproved: 1,
        qtyReceived: 0,
        itemReason: "WRONG_ITEM",
        disposition: "RETURN_TO_STOCK",
        notes: "Customer wants replacement",
      });

      console.log("✓ Created 2 sample return requests (1 Shopify, 1 Amazon)");
    } else {
      console.log("✓ Sales orders already exist");
    }

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
