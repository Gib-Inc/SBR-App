import type { IStorage } from "../storage";
import type { Item } from "@shared/schema";
import { AuditLogger, type AuditSource, type AuditEventType as AuditEventTypeBase } from "./audit-logger";
import { wsInventoryService } from "./websocket-inventory";
import { weightedAverageCost, buildUnitCost } from "./inventory-costing-service";

/**
 * INVENTORY MOVEMENT PATTERN DOCUMENTATION
 * =========================================
 * 
 * This system uses PATTERN B: INTERNAL-DRIVEN inventory movements.
 * 
 * KEY INVARIANTS:
 * 
 * 1. pivotQty is READ-ONLY from Extensiv
 *    - The ONLY place pivotQty changes is EXTENSIV_SYNC
 *    - Sales, returns, transfers, backorders NEVER mutate pivotQty
 *    - pivotQty represents physical stock at Pivot 3PL (as reported by Extensiv)
 * 
 * 2. availableForSaleQty is the working sellable field
 *    - Reduced by sales orders
 *    - Increased by cancellations, returns (resellable), and transfers
 *    - Reconciled when pivotQty is refreshed from Extensiv
 * 
 * 3. hildaleQty is buffer/production stock
 *    - ONLY changed by: production, manual adjustments, transfers (decrement)
 *    - Sales orders NEVER touch hildaleQty
 *    - PO receipts do NOT update hildaleQty (POs are for components only)
 * 
 * 4. POs are ONLY for raw/components
 *    - PURCHASE_ORDER_RECEIVED only affects currentStock for components
 *    - If item is finished_product, PO receipt logs warning and does nothing
 * 
 * Movement Rules:
 * 
 * SALES_ORDER_CREATED (from Shopify/Amazon/Direct):
 *   - Decrements availableForSaleQty ONLY (NOT pivotQty)
 *   - NEVER touches hildaleQty
 *   - ONE movement per order line - no double counting
 * 
 * SALES_ORDER_SHIPPED:
 *   - No additional movement (stock already decremented at create)
 *   - NEVER touches hildaleQty or pivotQty
 * 
 * SALES_ORDER_CANCELLED:
 *   - Restores availableForSaleQty ONLY (NOT pivotQty)
 *   - NEVER touches hildaleQty
 * 
 * RETURN_RECEIVED:
 *   - For finished products: increments hildaleQty (returns land at Hildale for
 *     inspection; NOT sellable until transferred to Pivot)
 *   - For components: increments currentStock
 *   - NEVER touches pivotQty (read-only from Extensiv)
 * 
 * PURCHASE_ORDER_RECEIVED:
 *   - For components (type === 'component'): increments currentStock
 *   - For finished products: NO-OP with warning (POs are for components only)
 *   - NEVER touches hildaleQty, pivotQty, or availableForSaleQty
 * 
 * EXTENSIV_SYNC:
 *   - THE ONLY event that updates pivotQty
 *   - Updates pivotQty to match Extensiv snapshot
 *   - Reconciles availableForSaleQty based on delta
 *   - NO write-back to Extensiv ever
 * 
 * PRODUCTION_COMPLETED:
 *   - Increments hildaleQty for finished products
 *   - This is how finished goods are created
 * 
 * TRANSFER (Hildale → Pivot):
 *   - Decrements hildaleQty
 *   - Increments availableForSaleQty (makes stock sellable)
 *   - Does NOT modify pivotQty (that updates via Extensiv sync)
 * 
 * MANUAL_ADJUSTMENT:
 *   - Location HILDALE: adjusts hildaleQty
 *   - Location PIVOT: adjusts availableForSaleQty
 *   - NEVER touches pivotQty (read-only)
 * 
 * HILDALE INVENTORY CHANGES ONLY FROM:
 *   - Production/BOM builds (increment)
 *   - Hildale → Pivot transfers (decrement)
 *   - Manual adjustments targeting HILDALE
 * 
 * IDEMPOTENCY:
 * - Unique constraint on (channel, externalOrderId) prevents duplicate imports
 * - Shopify/Amazon syncs check getSalesOrdersByExternalId before creating
 * - Each event type results in exactly ONE transaction record
 */

export type InventoryEventType =
  | "SALES_ORDER_CREATED"
  | "SALES_ORDER_SHIPPED"
  | "SALES_ORDER_CANCELLED"
  | "PURCHASE_ORDER_RECEIVED"
  | "RETURN_RECEIVED"
  | "BACKORDER_FULFILLED"
  | "MANUAL_ADJUSTMENT"
  | "PRODUCTION_COMPLETED"
  | "EXTENSIV_SYNC"
  | "TRANSFER"
  | "BOM_CONSUMPTION"
  | "MANUAL_COUNT";

export interface InventoryMovementParams {
  eventType: InventoryEventType;
  itemId: string;
  quantity: number;
  location?: "HILDALE" | "PIVOT" | "N/A";
  source: string;
  // Cost per unit for WAC maintenance. Optional override: PURCHASE_ORDER_RECEIVED
  // resolves it from the PO line (via poId) when absent; PRODUCTION_COMPLETED
  // computes it from the BOM components' WAC when absent.
  unitCost?: number;
  orderId?: string;
  returnId?: string;
  poId?: string;
  salesOrderLineId?: string;
  channel?: string;
  userId?: string | number;
  userName?: string;
  notes?: string;
  // MANUAL_COUNT only: when true, `quantity` is the ABSOLUTE observed level
  // (a count / external re-anchor target), not a delta. The delta is derived
  // from the ROW-LOCKED current value inside the transaction, so callers with
  // stale pre-reads (bulk syncs, webhooks) cannot inject phantom units.
  // Negative targets clamp to 0 and converge (no-op once the field is 0).
  absolute?: boolean;
  // For BOM_CONSUMPTION: when present, the apply() call will FIFO-draw from
  // open inventory_lots and record per-lot draws in lot_consumption_events
  // linked to this production_logs row. Optional so legacy callers still
  // work — without it, lot tracking is silently skipped.
  productionLogId?: string;
}

export interface InventoryMovementResult {
  success: boolean;
  itemId: string;
  sku: string;
  beforeQty: number;
  afterQty: number;
  quantityChanged: number;
  error?: string;
}

interface InventoryState {
  onHand: number;
  hildaleQty: number;
  pivotQty: number;
  availableForSaleQty: number;
  currentStock: number;
}

// Result of the pure movement math run against the (row-locked) item state.
interface MovementComputation {
  beforeState: InventoryState;
  updates: {
    hildaleQty?: number;
    pivotQty?: number;
    availableForSaleQty?: number;
    currentStock?: number;
    wacUnitCost?: number;
    forecastDirty?: boolean;
  } | null;
  quantityDelta: number;
  error?: string;
  // Failure branches historically reported the specific field they checked
  // (hildale, currentStock, onHand) as before/after — preserved here.
  errorBeforeQty?: number;
  reconEntry?: { action: "SHRINKAGE" | "OVERAGE"; valueDelta: number; wac: number };
}

export class InventoryMovement {
  constructor(private storage: IStorage) {}

  private getInventoryState(item: Item): InventoryState {
    const hildaleQty = item.hildaleQty ?? 0;
    const pivotQty = item.pivotQty ?? 0;
    const availableForSaleQty = item.availableForSaleQty ?? 0;
    const currentStock = item.currentStock ?? 0;
    
    const onHand = item.type === "finished_product"
      ? hildaleQty + availableForSaleQty
      : currentStock;
    
    return { onHand, hildaleQty, pivotQty, availableForSaleQty, currentStock };
  }

  async apply(params: InventoryMovementParams): Promise<InventoryMovementResult> {
    try {
      // Pre-read (unlocked): existence check, event routing, and async costing
      // prefetch. The actual stock math re-runs against the ROW-LOCKED current
      // item inside updateItemAtomic, so a concurrent movement between this
      // read and the lock cannot lose a decrement (audit CONC-1).
      const preItem = await this.storage.getItem(params.itemId);
      if (!preItem) {
        return {
          success: false,
          itemId: params.itemId,
          sku: "",
          beforeQty: 0,
          afterQty: 0,
          quantityChanged: 0,
          error: `Item ${params.itemId} not found`,
        };
      }

      const costing = await this.prefetchCosting(preItem, params);

      let computation: MovementComputation | undefined;
      let afterItem: Item | undefined;

      if (typeof this.storage.updateItemAtomic === "function") {
        const outcome = await this.storage.updateItemAtomic(params.itemId, (current) => {
          const c = this.computeMovement(current, params, costing);
          return { updates: c.error ? null : c.updates, result: c };
        });
        computation = outcome.result;
        afterItem = outcome.item;
      } else {
        // Non-locking fallback for storages without atomic support (tests,
        // in-memory). Same math, no serialization guarantee.
        const current = await this.storage.getItem(params.itemId);
        if (current) {
          computation = this.computeMovement(current, params, costing);
          afterItem = !computation.error && computation.updates
            ? await this.storage.updateItem(params.itemId, computation.updates)
            : current;
        }
      }

      if (!computation) {
        return {
          success: false,
          itemId: params.itemId,
          sku: preItem.sku,
          beforeQty: 0,
          afterQty: 0,
          quantityChanged: 0,
          error: `Item ${params.itemId} disappeared during movement`,
        };
      }

      const { beforeState, updates, quantityDelta, error, errorBeforeQty, reconEntry } = computation;

      if (error) {
        const qty = errorBeforeQty ?? beforeState.onHand;
        return {
          success: false,
          itemId: params.itemId,
          sku: preItem.sku,
          beforeQty: qty,
          afterQty: qty,
          quantityChanged: 0,
          error,
        };
      }

      // Zero-drift audit (MANUAL_COUNT): the $ variance row is written after
      // the stock write commits so a rolled-back movement never logs shrinkage.
      if (reconEntry) {
        await this.storage.createDataReconciliationLog([{
          dataType: "inventory_valuation",
          entityKey: preItem.sku,
          action: reconEntry.action,
          field: "asset_value",
          oldValue: null,
          newValue: String(reconEntry.valueDelta),
          reason: `Manual count moved ${preItem.sku} by ${quantityDelta} unit(s) × $${reconEntry.wac.toFixed(2)} WAC = $${reconEntry.valueDelta} balance-sheet adjustment.`,
          source: params.source || "manual-count",
        }]).catch(() => {});
      }

      if (updates && Object.keys(updates).length > 0) {
        // Realtime broadcast: only the fields we actually mutated. forecastDirty
        // is a bookkeeping flag and not relevant to the UI, so we strip it.
        const changedFields = Object.keys(updates).filter((f) => f !== "forecastDirty");
        if (changedFields.length > 0) {
          wsInventoryService.broadcast({
            itemIds: [params.itemId],
            fields: changedFields,
            reason: params.eventType === "TRANSFER" ? "TRANSFER"
              : params.eventType === "SALES_ORDER_SHIPPED" ? "SHIP"
              : "MOVEMENT",
          });
        }
      }

      // Lot traceability: when a build consumes components, draw FIFO from
      // open inventory_lots so a recall can later trace from a specific lot
      // back to the production runs (and ultimately customers) it touched.
      // Only fires when the caller passes productionLogId, so legacy paths
      // (Shopify webhook BOM consumption etc.) keep working unchanged.
      if (
        params.eventType === "BOM_CONSUMPTION" &&
        params.productionLogId &&
        params.quantity > 0
      ) {
        try {
          let remaining = params.quantity;
          const lots = await this.storage.getOpenLotsForItemFIFO(params.itemId);
          for (const lot of lots) {
            if (remaining <= 0) break;
            const draw = Math.min(remaining, lot.remainingQty ?? 0);
            if (draw <= 0) continue;
            await this.storage.decrementLotRemaining(lot.id, draw);
            await this.storage.createLotConsumptionEvent({
              lotId: lot.id,
              productionLogId: params.productionLogId,
              qtyDrawn: draw,
            });
            remaining -= draw;
          }
          // remaining > 0 here means we consumed more than the lots have on
          // record (possible when older receives weren't lot-tracked). The
          // currentStock decrement above already accounted for it; we just
          // can't attribute the surplus to any lot.
        } catch (err) {
          console.warn("[InventoryMovement] FIFO lot draw failed (non-fatal):", err);
        }
      }

      const afterState = afterItem ? this.getInventoryState(afterItem) : beforeState;

      await this.logMovement(params, preItem, beforeState, afterState, quantityDelta);

      return {
        success: true,
        itemId: params.itemId,
        sku: preItem.sku,
        beforeQty: beforeState.onHand,
        afterQty: afterState.onHand,
        quantityChanged: quantityDelta,
      };
    } catch (error: any) {
      console.error(`[InventoryMovement] Error applying ${params.eventType}:`, error);
      return {
        success: false,
        itemId: params.itemId,
        sku: "",
        beforeQty: 0,
        afterQty: 0,
        quantityChanged: 0,
        error: error.message || "Failed to apply inventory movement",
      };
    }
  }

  // Async costing inputs resolved BEFORE the row lock: PO line cost and BOM
  // build cost live in other tables and don't race the item row, so reading
  // them outside the transaction keeps the lock window minimal.
  private async prefetchCosting(
    item: Item,
    params: InventoryMovementParams,
  ): Promise<{ receiptCost?: number; perUnitBuildCost?: number }> {
    const costing: { receiptCost?: number; perUnitBuildCost?: number } = {};
    const isFinished = item.type === "finished_product";
    try {
      if (params.eventType === "PURCHASE_ORDER_RECEIVED" && !isFinished && params.quantity > 0) {
        // Receipt cost: explicit override → PO line unit cost → (compute falls
        // back to the item's default purchase cost).
        let receiptCost = params.unitCost;
        if (receiptCost == null && params.poId) {
          const lines = await this.storage.getPurchaseOrderLinesByPOId(params.poId).catch(() => []);
          const line: any = (lines || []).find((l: any) => l.itemId === params.itemId);
          if (line && Number(line.unitCost) > 0) receiptCost = Number(line.unitCost);
        }
        if (receiptCost != null) costing.receiptCost = receiptCost;
      } else if (params.eventType === "PRODUCTION_COMPLETED" && isFinished && params.quantity > 0) {
        // Build-order cost transition: per-unit build cost = Σ component WAC ×
        // qty-per-unit (incl. wastage).
        let perUnitBuildCost = params.unitCost;
        if (perUnitBuildCost == null) {
          const bom = await this.storage.getBillOfMaterialsByProductId(params.itemId).catch(() => []);
          if (bom && bom.length) {
            const comps: { qtyPerUnit: number; unitCost: number }[] = [];
            for (const b of bom as any[]) {
              const comp: any = await this.storage.getItem(b.componentId).catch(() => undefined);
              const compCost = comp?.wacUnitCost ?? comp?.defaultPurchaseCost;
              if (comp && compCost != null) {
                const qtyPer = Number(b.quantityRequired || 0) * (1 + (Number(b.wastagePercent) || 0) / 100);
                comps.push({ qtyPerUnit: qtyPer, unitCost: Number(compCost) });
              }
            }
            if (comps.length) perUnitBuildCost = buildUnitCost(comps);
          }
        }
        if (perUnitBuildCost != null) costing.perUnitBuildCost = perUnitBuildCost;
      }
    } catch (costingError: any) {
      console.warn(`[InventoryMovement] Costing prefetch skipped for ${item.sku}: ${costingError?.message ?? costingError}`);
    }
    return costing;
  }

  // The movement math against the CURRENT (row-locked) item state. MUST stay
  // synchronous and side-effect free: it runs inside the storage transaction
  // when the storage supports updateItemAtomic. Costing inputs arrive
  // prefetched; the shrinkage recon row is returned as data and written by
  // apply() after commit.
  private computeMovement(
    item: Item,
    params: InventoryMovementParams,
    costing: { receiptCost?: number; perUnitBuildCost?: number },
  ): MovementComputation {
    const beforeState = this.getInventoryState(item);
    const isFinished = item.type === "finished_product";
    const location = params.location || (isFinished ? "PIVOT" : "N/A");

    let updates: {
      hildaleQty?: number;
      pivotQty?: number;
      availableForSaleQty?: number;
      currentStock?: number;
      wacUnitCost?: number;
      forecastDirty?: boolean;
    } = {};
    let quantityDelta = 0;

    switch (params.eventType) {
        case "PURCHASE_ORDER_RECEIVED":
          // INVARIANT: POs are ONLY for raw/components, NOT finished products
          // Finished products are created via PRODUCTION_COMPLETED, not PO receipts
          if (isFinished) {
            // Log warning but do NOT update hildaleQty - this is an invalid configuration
            console.warn(`[InventoryMovement] WARNING: PO receipt attempted for finished product ${item.sku}. POs should only be for components. No inventory change applied.`);
            // Return success with zero change to avoid breaking PO flow, but log the issue
            quantityDelta = 0;
            // No updates applied for finished products
          } else {
            // Components: increment currentStock as expected
            quantityDelta = params.quantity;
            updates.currentStock = beforeState.currentStock + params.quantity;
          }
          break;

        case "RETURN_RECEIVED":
          // Returns for finished products go to HILDALE warehouse for inspection
          // They are NOT immediately sellable - must be transferred to Pivot to become sellable
          // INVARIANT: pivotQty is READ-ONLY from Extensiv
          quantityDelta = params.quantity;
          if (isFinished) {
            // Increment hildaleQty - returned stock arrives at Hildale for processing
            // Stock is NOT sellable until transferred from Hildale to Pivot
            updates.hildaleQty = beforeState.hildaleQty + params.quantity;
          } else {
            // Components: increment currentStock
            updates.currentStock = beforeState.currentStock + params.quantity;
          }
          break;

        case "SALES_ORDER_CREATED":
          // INVARIANT: Sales only decrement availableForSaleQty, NOT pivotQty
          // pivotQty is READ-ONLY from Extensiv - only EXTENSIV_SYNC can change it
          // hildaleQty is NEVER touched by sales orders
          if (isFinished) {
            quantityDelta = -params.quantity;
            // ONLY decrement availableForSaleQty - pivotQty stays unchanged (read-only)
            updates.availableForSaleQty = Math.max(0, beforeState.availableForSaleQty - params.quantity);
          }
          break;

        case "SALES_ORDER_SHIPPED":
          // Finished products: Pivot ships are a no-op because pivotQty is read-only
          // from Extensiv (EXTENSIV_SYNC will catch up). Hildale ships decrement
          // hildaleQty because nothing else will.
          if (isFinished) {
            if (location === "HILDALE") {
              if (beforeState.hildaleQty < params.quantity) {
                return {
                  beforeState,
                  updates: null,
                  quantityDelta: 0,
                  error: `Insufficient Hildale stock for ${item.sku}. Available: ${beforeState.hildaleQty}, Requested: ${params.quantity}`,
                  errorBeforeQty: beforeState.hildaleQty,
                };
              }
              quantityDelta = -params.quantity;
              updates.hildaleQty = beforeState.hildaleQty - params.quantity;
            }
            // PIVOT: no-op — Extensiv sync is source of truth for pivotQty
          } else {
            // Components: decrement currentStock
            quantityDelta = -params.quantity;
            if (beforeState.currentStock >= params.quantity) {
              updates.currentStock = beforeState.currentStock - params.quantity;
            } else {
              return {
                beforeState,
                updates: null,
                quantityDelta: 0,
                error: `Insufficient stock for ${item.sku}. Available: ${beforeState.currentStock}, Requested: ${params.quantity}`,
                errorBeforeQty: beforeState.currentStock,
              };
            }
          }
          break;

        case "SALES_ORDER_CANCELLED":
          // INVARIANT: Cancellations only restore availableForSaleQty, NOT pivotQty
          // pivotQty is READ-ONLY from Extensiv - only EXTENSIV_SYNC can change it
          // hildaleQty is NEVER touched by sales orders
          if (isFinished) {
            quantityDelta = params.quantity;
            // ONLY restore availableForSaleQty - pivotQty stays unchanged (read-only)
            updates.availableForSaleQty = beforeState.availableForSaleQty + params.quantity;
          }
          break;

        case "MANUAL_ADJUSTMENT": {
          // INVARIANT: Manual adjustments NEVER touch pivotQty (read-only from Extensiv)
          // Location determines which field is adjusted for finished products.
          // A decrement below zero is refused INSIDE the row lock (review F5):
          // two concurrent ships can no longer both pass an unlocked pre-check
          // and drive the field negative. Use MANUAL_COUNT to force a level.
          const adjCurrent = isFinished
            ? (location === "HILDALE" ? beforeState.hildaleQty : beforeState.availableForSaleQty)
            : beforeState.currentStock;
          if (adjCurrent + params.quantity < 0) {
            return {
              beforeState,
              updates: null,
              quantityDelta: 0,
              error: `Insufficient stock for adjustment of ${item.sku}: ${adjCurrent} available, adjustment ${params.quantity}. Use a MANUAL_COUNT to set an absolute level.`,
              errorBeforeQty: adjCurrent,
            };
          }
          quantityDelta = params.quantity;
          if (isFinished) {
            if (location === "HILDALE") {
              // Adjust buffer stock at Hildale
              updates.hildaleQty = beforeState.hildaleQty + params.quantity;
            } else {
              // Adjust sellable stock (availableForSaleQty, NOT pivotQty)
              updates.availableForSaleQty = beforeState.availableForSaleQty + params.quantity;
            }
          } else {
            // Components: adjust currentStock
            updates.currentStock = beforeState.currentStock + params.quantity;
          }
          break;
        }

        case "PRODUCTION_COMPLETED":
          quantityDelta = params.quantity;
          if (isFinished) {
            updates.hildaleQty = beforeState.hildaleQty + params.quantity;
          }
          break;

        case "EXTENSIV_SYNC":
          // *** THE ONLY EVENT TYPE THAT MODIFIES pivotQty ***
          // Extensiv is the 3PL system of record for PHYSICAL Pivot stock. We
          // mirror its snapshot into pivotQty and do NOT touch availableForSaleQty.
          // afs is a locally-driven working number (sales, returns, transfers,
          // manual counts). Reconciling afs from the Extensiv delta double-counts
          // every sale: the order already decremented afs at create time, and
          // Extensiv then reports the lower physical count, which would decrement
          // afs a second time. Drift between afs and pivotQty is expected and is
          // surfaced via the variance report rather than auto-corrected here.
          if (isFinished) {
            updates.pivotQty = params.quantity;
            quantityDelta = params.quantity - beforeState.pivotQty;
          }
          break;

        case "BACKORDER_FULFILLED":
          quantityDelta = 0;
          break;

        case "TRANSFER":
          // Hildale → Pivot transfer: decrements hildaleQty, increments availableForSaleQty
          // INVARIANT: pivotQty is READ-ONLY from Extensiv, so we only update availableForSaleQty
          // The physical stock at Pivot will be reflected in pivotQty after next Extensiv sync
          if (isFinished) {
            if (beforeState.hildaleQty >= params.quantity) {
              updates.hildaleQty = beforeState.hildaleQty - params.quantity;
              // ONLY increment availableForSaleQty - pivotQty is read-only from Extensiv
              updates.availableForSaleQty = beforeState.availableForSaleQty + params.quantity;
              quantityDelta = 0; // Net change is zero (moving between locations)
            } else {
              return {
                beforeState,
                updates: null,
                quantityDelta: 0,
                error: `Insufficient Hildale stock for transfer of ${item.sku}. Available: ${beforeState.hildaleQty}, Requested: ${params.quantity}`,
                errorBeforeQty: beforeState.onHand,
              };
            }
          }
          break;

        case "BOM_CONSUMPTION":
          // Triggered by Shopify fulfilled webhook — subtracts raw materials based on BOM
          // Only applies to components (raw materials), not finished products
          // NOTE: If Clarence also logs production via the Production Screen, raw materials
          // would be subtracted there too. Operationally, use ONE path — not both.
          if (!isFinished) {
            quantityDelta = -params.quantity;
            // Production can reveal shortages. Preserve the actual material draw
            // instead of clamping to zero so stock and audit movement agree.
            updates.currentStock = beforeState.currentStock - params.quantity;
          }
          break;

        case "MANUAL_COUNT": {
          // Physical count adjustment. Default: quantity is the DIFFERENCE
          // (actual − expected). With params.absolute: quantity is the TARGET
          // level, and the delta derives from the locked current value.
          // quantityDelta is the APPLIED change (post-clamp), so the shrinkage
          // recon row values what actually moved — a clamped-at-zero field
          // never books phantom shrinkage (review F2).
          const currentLevel = isFinished
            ? (location === "HILDALE" ? beforeState.hildaleQty : beforeState.availableForSaleQty)
            : beforeState.currentStock;
          const target = params.absolute
            ? Math.max(0, Math.trunc(params.quantity))
            : Math.max(0, currentLevel + params.quantity);
          quantityDelta = target - currentLevel;
          if (quantityDelta !== 0) {
            if (isFinished) {
              if (location === "HILDALE") {
                updates.hildaleQty = target;
              } else {
                updates.availableForSaleQty = target;
              }
            } else {
              updates.currentStock = target;
            }
          }
          break;
        }
      }

    // ── Weighted-average cost maintenance (FinOps Pillar 2) ──────────────
    // Costing is additive metadata: it augments the SAME single-row update
    // as the quantity change (atomic per item, inside the row lock). Costs
    // were prefetched; a missing cost must never block the movement itself.
    if (params.eventType === "PURCHASE_ORDER_RECEIVED" && !isFinished && params.quantity > 0) {
      // Receipt cost: prefetched (explicit override → PO line) → default cost.
      let receiptCost = costing.receiptCost;
      if (receiptCost == null && (item as any).defaultPurchaseCost != null) {
        receiptCost = Number((item as any).defaultPurchaseCost);
      }
      if (receiptCost != null && receiptCost >= 0) {
        const priorWac = (item as any).wacUnitCost ?? (item as any).defaultPurchaseCost ?? receiptCost;
        updates.wacUnitCost = weightedAverageCost(
          beforeState.currentStock, Number(priorWac) || 0, params.quantity, receiptCost,
        );
      }
    } else if (params.eventType === "PRODUCTION_COMPLETED" && isFinished && params.quantity > 0) {
      // Build-order cost transition: per-unit build cost (prefetched from the
      // BOM components' WAC) rolled into the finished good's WAC against its
      // physical on-hand (hildale + pivot).
      const perUnitBuildCost = costing.perUnitBuildCost;
      if (perUnitBuildCost != null && perUnitBuildCost > 0) {
        const physicalOnHand = beforeState.hildaleQty + beforeState.pivotQty;
        const priorWac = (item as any).wacUnitCost ?? 0;
        updates.wacUnitCost = weightedAverageCost(
          physicalOnHand, Number(priorWac) || 0, params.quantity, perUnitBuildCost,
        );
      }
    }

    // Zero-drift audit data (MANUAL_COUNT): a recount moves the inventory
    // asset value by qtyDelta × WAC. Returned as data; apply() writes the
    // reconciliation row after the movement commits.
    let reconEntry: MovementComputation["reconEntry"];
    if (params.eventType === "MANUAL_COUNT" && quantityDelta !== 0) {
      const wac = (item as any).wacUnitCost ?? (item as any).defaultPurchaseCost;
      if (wac != null && Number(wac) > 0) {
        reconEntry = {
          action: quantityDelta < 0 ? "SHRINKAGE" : "OVERAGE",
          valueDelta: Math.round(quantityDelta * Number(wac) * 100) / 100,
          wac: Number(wac),
        };
      }
    }

    if (Object.keys(updates).length > 0) {
      updates.forecastDirty = true;
    }

    return {
      beforeState,
      updates: Object.keys(updates).length > 0 ? updates : null,
      quantityDelta,
      reconEntry,
    };
  }

  private async logMovement(
    params: InventoryMovementParams,
    item: Item,
    beforeState: InventoryState,
    afterState: InventoryState,
    quantityDelta: number
  ): Promise<void> {
    try {
      const eventTypeMap: Record<InventoryEventType, AuditEventTypeBase> = {
        SALES_ORDER_CREATED: "SALES_ORDER_CREATED",
        SALES_ORDER_SHIPPED: "SALES_ORDER_FULFILLED",
        SALES_ORDER_CANCELLED: "SALES_ORDER_CANCELLED",
        PURCHASE_ORDER_RECEIVED: "PURCHASE_ORDER_RECEIVED",
        RETURN_RECEIVED: "RETURN_RECEIVED",
        BACKORDER_FULFILLED: "BACKORDER_FULFILLED",
        MANUAL_ADJUSTMENT: "INVENTORY_ADJUSTED",
        PRODUCTION_COMPLETED: "PRODUCTION_COMPLETED",
        EXTENSIV_SYNC: "INTEGRATION_SYNC",
        TRANSFER: "INVENTORY_TRANSFERRED",
        BOM_CONSUMPTION: "BOM_CONSUMPTION",
        MANUAL_COUNT: "MANUAL_COUNT",
      };

      const entityTypeMap: Record<InventoryEventType, string> = {
        SALES_ORDER_CREATED: "SALES_ORDER",
        SALES_ORDER_SHIPPED: "SALES_ORDER",
        SALES_ORDER_CANCELLED: "SALES_ORDER",
        PURCHASE_ORDER_RECEIVED: "PURCHASE_ORDER",
        RETURN_RECEIVED: "RETURN",
        BACKORDER_FULFILLED: "SALES_ORDER",
        MANUAL_ADJUSTMENT: "ITEM",
        PRODUCTION_COMPLETED: "ITEM",
        EXTENSIV_SYNC: "ITEM",
        TRANSFER: "ITEM",
        BOM_CONSUMPTION: "ITEM",
        MANUAL_COUNT: "ITEM",
      };

      const entityId = params.orderId || params.poId || params.returnId || params.itemId;
      const description = this.buildDescription(params, item, quantityDelta);

      const source: AuditSource = params.source === "USER" || params.source === "SYSTEM" 
        ? params.source as AuditSource 
        : "SYSTEM";

      await AuditLogger.logEvent({
        eventType: eventTypeMap[params.eventType],
        entityType: entityTypeMap[params.eventType],
        entityId,
        entityLabel: item.sku,
        source,
        status: "INFO",
        description,
        details: {
          itemId: params.itemId,
          sku: item.sku,
          itemName: item.name,
          itemType: item.type,
          eventType: params.eventType,
          quantityChanged: quantityDelta,
          location: params.location,
          channel: params.channel,
          before: {
            onHand: beforeState.onHand,
            hildaleQty: beforeState.hildaleQty,
            pivotQty: beforeState.pivotQty,
            availableForSaleQty: beforeState.availableForSaleQty,
            currentStock: beforeState.currentStock,
          },
          after: {
            onHand: afterState.onHand,
            hildaleQty: afterState.hildaleQty,
            pivotQty: afterState.pivotQty,
            availableForSaleQty: afterState.availableForSaleQty,
            currentStock: afterState.currentStock,
          },
          orderId: params.orderId,
          poId: params.poId,
          returnId: params.returnId,
          salesOrderLineId: params.salesOrderLineId,
          notes: params.notes,
        },
        performedByUserId: params.userId?.toString(),
        performedByName: params.userName,
        purchaseOrderId: params.poId,
      });
    } catch (error) {
      console.warn("[InventoryMovement] Failed to log movement:", error);
    }
  }

  private buildDescription(
    params: InventoryMovementParams,
    item: Item,
    quantityDelta: number
  ): string {
    const absQty = Math.abs(quantityDelta);
    const direction = quantityDelta >= 0 ? "increased" : "decreased";
    
    switch (params.eventType) {
      case "SALES_ORDER_CREATED":
        return `Sales order created: ${absQty} ${item.sku} allocated from ${params.location || 'PIVOT'}`;
      case "SALES_ORDER_SHIPPED":
        return `Sales order shipped: ${absQty} ${item.sku} ${direction} at ${params.location || 'warehouse'}`;
      case "SALES_ORDER_CANCELLED":
        return `Sales order cancelled: ${absQty} ${item.sku} restored to ${params.location || 'PIVOT'}`;
      case "PURCHASE_ORDER_RECEIVED":
        return `PO received: ${absQty} ${item.sku} added to inventory`;
      case "RETURN_RECEIVED":
        return `Return received: ${absQty} ${item.sku} restocked to Hildale`;
      case "BACKORDER_FULFILLED":
        return `Backorder fulfilled: ${absQty} ${item.sku} allocated`;
      case "MANUAL_ADJUSTMENT":
        return `Manual adjustment: ${item.sku} ${direction} by ${absQty} at ${params.location || 'warehouse'}`;
      case "PRODUCTION_COMPLETED":
        return `Production completed: ${absQty} ${item.sku} added to Hildale`;
      case "EXTENSIV_SYNC":
        return `Extensiv sync: ${item.sku} pivot qty updated by ${quantityDelta}`;
      case "TRANSFER":
        return `Transfer: ${absQty} ${item.sku} moved`;
      case "BOM_CONSUMPTION":
        return `BOM consumption: ${absQty} ${item.sku} subtracted (order fulfillment)`;
      case "MANUAL_COUNT":
        return `Manual count: ${item.sku} ${direction} by ${absQty} at ${params.location || 'warehouse'}`;
      default:
        return `Inventory ${direction} by ${absQty} for ${item.sku}`;
    }
  }
}
