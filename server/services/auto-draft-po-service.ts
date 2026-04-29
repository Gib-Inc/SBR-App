// Auto-draft purchase order generator.
//
// Mirrors the deterministic reorder math in /api/raw-materials/dashboard:
//   dailyUsage  = Σ (BOM.qtyPerUnit × wastage × dailySales) per component
//   orderQty    = max(0, ceil(dailyUsage × 30) − onHand) when dailyUsage > 0
//
// For every component with orderQty > 0 we pick a supplier and stack the line
// onto a per-supplier draft PO. Supplier tiebreak: isDesignatedSupplier first,
// then lowest supplier_items.price. If no supplier_items row exists for an
// item we surface it in `skipped` rather than creating a broken PO.
//
// Idempotent within a calendar day: if a DRAFT / isAutoDraft=true PO already
// exists for the supplier with createdAt today, we report it in
// `alreadyExists` and add no new lines.

import { storage } from "../storage";

export interface AutoDraftPoCreated {
  supplierId: string;
  supplierName: string;
  poId: string;
  poNumber: string;
  lineCount: number;
  totalValue: number;
}

export interface AutoDraftPoSkipped {
  itemId: string;
  itemName: string;
  reason: string;
}

export interface AutoDraftPoAlreadyExists {
  supplierId: string;
  supplierName: string;
  poId: string;
  poNumber: string;
}

export interface AutoDraftPoResult {
  created: AutoDraftPoCreated[];
  skipped: AutoDraftPoSkipped[];
  alreadyExists: AutoDraftPoAlreadyExists[];
}

interface PendingLine {
  itemId: string;
  itemName: string;
  sku: string;
  unit: string;
  qtyOrdered: number;
  unitCost: number;
  priceUnknown: boolean;
}

const TARGET_DAYS_OF_SUPPLY = 30;
const SALES_VELOCITY_WINDOW_DAYS = 90;

function isSameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export async function runAutoDraftPoGeneration(): Promise<AutoDraftPoResult> {
  const result: AutoDraftPoResult = { created: [], skipped: [], alreadyExists: [] };

  const allItems = await storage.getItemsWithBOMCounts();
  const components = allItems.filter((i) => i.type === "component");
  const finishedProducts = allItems.filter((i) => i.type === "finished_product");

  const velocity = await storage.getSkuSalesVelocity(SALES_VELOCITY_WINDOW_DAYS);
  const velocityMap = new Map(velocity.map((v) => [v.sku, v.unitsSold]));

  // componentId → totalDailyUsage (matches /api/raw-materials/dashboard)
  const componentUsage = new Map<string, number>();
  for (const product of finishedProducts) {
    const bom = await storage.getBillOfMaterialsByProductId(product.id);
    if (!bom || bom.length === 0) continue;
    const unitsSold = velocityMap.get(product.sku) || 0;
    const dailySales = unitsSold / SALES_VELOCITY_WINDOW_DAYS;
    for (const entry of bom) {
      const wastage = (entry as any).wastagePercent ?? 0;
      const effectiveQty = entry.quantityRequired * (1 + wastage / 100);
      const dailyComponentUsage = effectiveQty * dailySales;
      componentUsage.set(
        entry.componentId,
        (componentUsage.get(entry.componentId) ?? 0) + dailyComponentUsage,
      );
    }
  }

  // Group lines by supplier as we walk components.
  const linesBySupplier = new Map<string, PendingLine[]>();

  for (const comp of components) {
    const dailyUsage = componentUsage.get(comp.id) ?? 0;
    if (dailyUsage <= 0) continue;

    const onHand = comp.currentStock ?? 0;
    const orderQty = Math.max(0, Math.ceil(dailyUsage * TARGET_DAYS_OF_SUPPLY) - onHand);
    if (orderQty <= 0) continue;

    const supplierItems = await storage.getSupplierItemsByItemId(comp.id);
    if (supplierItems.length === 0) {
      result.skipped.push({
        itemId: comp.id,
        itemName: comp.name,
        reason: "no supplier linked",
      });
      continue;
    }

    // Tiebreak: designated supplier wins; otherwise lowest non-null/non-zero
    // price; if every row has null/zero price, fall back to the first row so
    // we can still emit the line and flag price-unknown.
    const designated = supplierItems.find((si) => si.isDesignatedSupplier);
    let chosen = designated;
    if (!chosen) {
      const priced = supplierItems
        .filter((si) => si.price != null && si.price > 0)
        .sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
      chosen = priced[0] ?? supplierItems[0];
    }

    const supplierItemsPrice = chosen.price ?? 0;
    const fallbackPrice = comp.defaultPurchaseCost ?? 0;
    const unitCost = supplierItemsPrice > 0
      ? supplierItemsPrice
      : fallbackPrice > 0
        ? fallbackPrice
        : 0;
    const priceUnknown = unitCost === 0;

    const lines = linesBySupplier.get(chosen.supplierId) ?? [];
    lines.push({
      itemId: comp.id,
      itemName: comp.name,
      sku: comp.sku,
      unit: comp.unit ?? "EA",
      qtyOrdered: orderQty,
      unitCost,
      priceUnknown,
    });
    linesBySupplier.set(chosen.supplierId, lines);
  }

  const today = new Date();

  for (const [supplierId, lines] of linesBySupplier.entries()) {
    const supplier = await storage.getSupplier(supplierId);
    if (!supplier) {
      // Orphan supplier_items row pointing at a deleted supplier — surface
      // every line we would have stacked onto it.
      for (const line of lines) {
        result.skipped.push({
          itemId: line.itemId,
          itemName: line.itemName,
          reason: "supplier no longer exists",
        });
      }
      continue;
    }

    // Idempotency: same supplier + isAutoDraft + DRAFT + createdAt today.
    const existing = await storage.getPurchaseOrdersBySupplierId(supplierId);
    const todaysAutoDraft = existing.find(
      (po) =>
        po.isAutoDraft &&
        po.status === "DRAFT" &&
        po.createdAt &&
        isSameCalendarDay(new Date(po.createdAt), today),
    );
    if (todaysAutoDraft) {
      result.alreadyExists.push({
        supplierId,
        supplierName: supplier.name,
        poId: todaysAutoDraft.id,
        poNumber: todaysAutoDraft.poNumber,
      });
      continue;
    }

    const subtotal = lines.reduce(
      (sum, l) => sum + l.qtyOrdered * l.unitCost,
      0,
    );
    const totalItemsOrdered = lines.reduce((sum, l) => sum + l.qtyOrdered, 0);
    const priceUnknownLines = lines.filter((l) => l.priceUnknown);

    const noteParts: string[] = [
      `Auto-drafted ${today.toISOString().slice(0, 10)} from reorder calculation (30-day target).`,
    ];
    if (priceUnknownLines.length > 0) {
      noteParts.push(
        `price unknown: ${priceUnknownLines.map((l) => l.sku).join(", ")}`,
      );
    }

    const poNumber = await storage.getNextPONumber();
    const po = await storage.createPurchaseOrder({
      poNumber,
      supplierId: supplier.id,
      supplierName: supplier.name,
      supplierEmail: supplier.email ?? null,
      supplierAddress: [
        supplier.streetAddress,
        supplier.city,
        supplier.stateRegion,
        supplier.postalCode,
        supplier.country,
      ]
        .filter(Boolean)
        .join(", ") || null,
      currency: "USD",
      status: "DRAFT",
      isAutoDraft: true,
      subtotal: Math.round(subtotal * 100) / 100,
      total: Math.round(subtotal * 100) / 100,
      totalItemsOrdered,
      notes: noteParts.join(" "),
      paymentTerms: supplier.paymentTerms ?? null,
    });

    for (const line of lines) {
      const lineTotal = Math.round(line.qtyOrdered * line.unitCost * 100) / 100;
      await storage.createPurchaseOrderLine({
        purchaseOrderId: po.id,
        itemId: line.itemId,
        sku: line.sku,
        itemName: line.itemName,
        unitOfMeasure: line.unit,
        qtyOrdered: line.qtyOrdered,
        unitCost: line.unitCost,
        lineTotal,
        recommendedQtyAtOrderTime: line.qtyOrdered,
      });
    }

    result.created.push({
      supplierId: supplier.id,
      supplierName: supplier.name,
      poId: po.id,
      poNumber: po.poNumber,
      lineCount: lines.length,
      totalValue: Math.round(subtotal * 100) / 100,
    });
  }

  return result;
}
