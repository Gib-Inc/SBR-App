import type { IStorage } from "./storage";
import type { InsertInventoryTransaction, Item } from "@shared/schema";
import { InventoryMovement, type InventoryEventType } from "./services/inventory-movement";

export interface TransactionResult {
  success: boolean;
  transaction?: any;
  error?: string;
}

export interface TransferRequest {
  itemId: string;
  fromLocation: "HILDALE" | "PIVOT";
  toLocation: "HILDALE" | "PIVOT";
  quantity: number;
  notes?: string;
  createdBy?: string;
}

export interface ProductionRequest {
  finishedProductId: string;
  quantity: number;
  notes?: string;
  createdBy?: string;
}

export class TransactionService {
  private movement: InventoryMovement;

  constructor(private storage: IStorage) {
    this.movement = new InventoryMovement(storage);
  }

  // AUDIT MGI-3/RCV-4: this service used to be a SECOND inventory gateway with
  // its own read-compute-overwrite math — it wrote the Extensiv-owned pivotQty
  // directly, skipped WAC, skipped the audit ledger, and raced the real
  // gateway. It now delegates every stock write to InventoryMovement (atomic,
  // ledgered, costed) and only keeps its public API + the
  // inventory_transactions history row for its 9 existing call sites.
  //
  // Semantics change vs the legacy math, deliberate and invariant-restoring:
  // PIVOT-side writes no longer touch pivotQty (read-only from Extensiv) —
  // they adjust availableForSaleQty, the working sellable field, and the next
  // Extensiv sync reconciles physical pivot stock.
  async applyTransaction(
    transaction: InsertInventoryTransaction
  ): Promise<TransactionResult> {
    try {
      const item = await this.storage.getItem(transaction.itemId);
      if (!item) {
        return {
          success: false,
          error: `Item with ID ${transaction.itemId} not found`,
        };
      }

      const transactionType = transaction.type;
      const location = (transaction.location ?? "N/A") as "HILDALE" | "PIVOT" | "N/A";
      const quantity = transaction.quantity;

      if (quantity <= 0) {
        return {
          success: false,
          error: "Quantity must be positive",
        };
      }

      // Normalize itemType to handle both formats: "finished_product"/"component" and "FINISHED"/"RAW"
      const normalizedItemType =
        transaction.itemType === "finished_product" || transaction.itemType === "FINISHED"
          ? "FINISHED"
          : "RAW";

      // Map the legacy transaction vocabulary onto gateway events. `signedQty`
      // carries direction for MANUAL_ADJUSTMENT (the gateway adds it as-is).
      let eventType: InventoryEventType;
      let signedQty = quantity;

      if (normalizedItemType === "FINISHED") {
        if (transactionType === "TRANSFER_OUT") {
          const available = location === "HILDALE" ? (item.hildaleQty ?? 0) : (item.availableForSaleQty ?? 0);
          if (available < quantity) {
            return {
              success: false,
              error: location === "HILDALE"
                ? `Insufficient stock at Hildale. Available: ${available}, Requested: ${quantity}`
                : `Insufficient sellable stock at Pivot. Available: ${available}, Requested: ${quantity}. If Pivot AFS is wrong, fix it on /inventory-integrity first.`,
            };
          }
          eventType = "MANUAL_ADJUSTMENT";
          signedQty = -quantity;
        } else if (transactionType === "TRANSFER_IN" || transactionType === "RECEIVE" || transactionType === "ADJUST") {
          eventType = "MANUAL_ADJUSTMENT";
        } else if (transactionType === "PRODUCE") {
          eventType = "PRODUCTION_COMPLETED";
        } else if (transactionType === "SHIP") {
          if (location !== "PIVOT") {
            return {
              success: false,
              error: "Finished products can only be shipped from PIVOT location",
            };
          }
          const sellable = item.availableForSaleQty ?? 0;
          if (sellable < quantity) {
            return {
              success: false,
              error: `Insufficient sellable stock at Pivot to ship. Available: ${sellable}, Requested: ${quantity}. If Pivot AFS is wrong, fix it on /inventory-integrity first.`,
            };
          }
          eventType = "MANUAL_ADJUSTMENT";
          signedQty = -quantity;
        } else {
          return { success: false, error: `Unsupported transaction type: ${transactionType}` };
        }
      } else {
        if (transactionType === "PRODUCE") {
          if ((item.currentStock ?? 0) < quantity) {
            return {
              success: false,
              error: `Insufficient raw material stock. Available: ${item.currentStock ?? 0}, Required: ${quantity}`,
            };
          }
          eventType = "BOM_CONSUMPTION";
        } else if (transactionType === "RECEIVE") {
          // PURCHASE_ORDER_RECEIVED keeps WAC alive on component receipts
          // (unit cost falls back to the item's default purchase cost).
          eventType = "PURCHASE_ORDER_RECEIVED";
        } else if (transactionType === "ADJUST") {
          eventType = "MANUAL_ADJUSTMENT";
        } else if (transactionType === "SHIP") {
          // Gateway validates sufficiency for component ships itself.
          eventType = "SALES_ORDER_SHIPPED";
        } else {
          return { success: false, error: `Unsupported transaction type: ${transactionType}` };
        }
      }

      const moveResult = await this.movement.apply({
        eventType,
        itemId: transaction.itemId,
        quantity: eventType === "MANUAL_ADJUSTMENT" ? signedQty : quantity,
        location,
        source: "SYSTEM",
        userId: transaction.createdBy ?? undefined,
        notes: transaction.notes
          ? `[transaction-service ${transactionType}] ${transaction.notes}`
          : `[transaction-service ${transactionType}]`,
      });

      if (!moveResult.success) {
        return { success: false, error: moveResult.error || "Inventory movement failed" };
      }

      // History row records only movements that actually landed. The stock
      // write is the truth — if the history insert fails we log loudly but do
      // NOT fail the call, otherwise a retry would re-apply the movement
      // (review F6). The gateway's audit log still has the movement.
      let createdTransaction: any = null;
      try {
        createdTransaction = await this.storage.createInventoryTransaction(transaction);
      } catch (historyError: any) {
        console.error(`[TransactionService] Movement applied but history insert failed for ${transaction.itemId} (${transactionType}): ${historyError?.message ?? historyError}`);
      }

      return {
        success: true,
        transaction: createdTransaction,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || "Failed to apply transaction",
      };
    }
  }

  async applyTransfer(request: TransferRequest): Promise<TransactionResult> {
    try {
      const item = await this.storage.getItem(request.itemId);
      if (!item) {
        return {
          success: false,
          error: `Item with ID ${request.itemId} not found`,
        };
      }

      if (item.type !== "finished_product") {
        return {
          success: false,
          error: "Transfers are only supported for finished products",
        };
      }

      if (request.fromLocation === request.toLocation) {
        return {
          success: false,
          error: "Cannot transfer to the same location",
        };
      }

      // Pivot-side truth is availableForSaleQty (pivotQty is Extensiv-owned).
      const stockAtSource = request.fromLocation === "HILDALE"
        ? (item.hildaleQty ?? 0)
        : (item.availableForSaleQty ?? 0);

      if (stockAtSource < request.quantity) {
        return {
          success: false,
          error: `Insufficient stock at ${request.fromLocation}. Available: ${stockAtSource}, Requested: ${request.quantity}`,
        };
      }

      // HILDALE → PIVOT is the gateway's native TRANSFER: one atomic movement
      // (−hildale, +afs, net zero) instead of a two-write pair that could be
      // interrupted between out and in.
      if (request.fromLocation === "HILDALE" && request.toLocation === "PIVOT") {
        const moveResult = await this.movement.apply({
          eventType: "TRANSFER",
          itemId: request.itemId,
          quantity: request.quantity,
          location: "PIVOT",
          source: "SYSTEM",
          userId: request.createdBy ?? undefined,
          notes: request.notes || "Transfer from HILDALE to PIVOT",
        });
        if (!moveResult.success) {
          return { success: false, error: moveResult.error || "Transfer failed" };
        }
        // Both history rows (OUT + IN) so consumers see the same shape as the
        // legacy two-write path (review F9); failures log but never fail the
        // call — the movement already landed (review F6).
        let outRecord: any = null;
        let inRecord: any = null;
        try {
          outRecord = await this.storage.createInventoryTransaction({
            itemId: request.itemId,
            itemType: "FINISHED",
            type: "TRANSFER_OUT",
            location: "HILDALE",
            quantity: request.quantity,
            notes: request.notes || `Transfer from HILDALE to PIVOT`,
            createdBy: request.createdBy,
          });
          inRecord = await this.storage.createInventoryTransaction({
            itemId: request.itemId,
            itemType: "FINISHED",
            type: "TRANSFER_IN",
            location: "PIVOT",
            quantity: request.quantity,
            notes: request.notes || `Transfer from HILDALE to PIVOT`,
            createdBy: request.createdBy,
          });
        } catch (historyError: any) {
          console.error(`[TransactionService] Transfer applied but history insert failed for ${request.itemId}: ${historyError?.message ?? historyError}`);
        }
        return { success: true, transaction: { transferOut: outRecord, transferIn: inRecord } };
      }

      const transferOutResult = await this.applyTransaction({
        itemId: request.itemId,
        itemType: "FINISHED",
        type: "TRANSFER_OUT",
        location: request.fromLocation,
        quantity: request.quantity,
        notes: request.notes || `Transfer from ${request.fromLocation} to ${request.toLocation}`,
        createdBy: request.createdBy,
      });

      if (!transferOutResult.success) {
        return transferOutResult;
      }

      const transferInResult = await this.applyTransaction({
        itemId: request.itemId,
        itemType: "FINISHED",
        type: "TRANSFER_IN",
        location: request.toLocation,
        quantity: request.quantity,
        notes: request.notes || `Transfer from ${request.fromLocation} to ${request.toLocation}`,
        createdBy: request.createdBy,
      });

      if (!transferInResult.success) {
        return transferInResult;
      }

      return {
        success: true,
        transaction: {
          transferOut: transferOutResult.transaction,
          transferIn: transferInResult.transaction,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || "Failed to apply transfer",
      };
    }
  }

  async applyProduction(request: ProductionRequest): Promise<TransactionResult> {
    try {
      const finishedProduct = await this.storage.getItem(request.finishedProductId);
      if (!finishedProduct) {
        return {
          success: false,
          error: `Finished product with ID ${request.finishedProductId} not found`,
        };
      }

      if (finishedProduct.type !== "finished_product") {
        return {
          success: false,
          error: "Production can only be performed on finished products",
        };
      }

      const bom = await this.storage.getBillOfMaterialsByProductId(request.finishedProductId);
      if (!bom || bom.length === 0) {
        return {
          success: false,
          error: "No Bill of Materials defined for this product. Cannot produce without BOM.",
        };
      }

      const componentChecks: Array<{ component: Item; required: number; available: number }> = [];

      for (const bomEntry of bom) {
        const component = await this.storage.getItem(bomEntry.componentId);
        if (!component) {
          return {
            success: false,
            error: `Component with ID ${bomEntry.componentId} not found`,
          };
        }

        const requiredQty = bomEntry.quantityRequired * request.quantity;
        const availableQty = component.currentStock ?? 0;

        componentChecks.push({
          component,
          required: requiredQty,
          available: availableQty,
        });

        if (availableQty < requiredQty) {
          return {
            success: false,
            error: `Insufficient stock for component "${component.name}" (${component.sku}). Required: ${requiredQty}, Available: ${availableQty}`,
          };
        }
      }

      const componentTransactions = [];
      for (const check of componentChecks) {
        const consumeResult = await this.applyTransaction({
          itemId: check.component.id,
          itemType: "RAW",
          type: "PRODUCE",
          location: "N/A",
          quantity: check.required,
          notes: request.notes || `Consumed for production of ${request.quantity} units of ${finishedProduct.name}`,
          createdBy: request.createdBy,
        });

        if (!consumeResult.success) {
          return consumeResult;
        }

        componentTransactions.push(consumeResult.transaction);
      }

      const produceResult = await this.applyTransaction({
        itemId: request.finishedProductId,
        itemType: "FINISHED",
        type: "PRODUCE",
        location: "HILDALE",
        quantity: request.quantity,
        notes: request.notes || `Produced ${request.quantity} units`,
        createdBy: request.createdBy,
      });

      if (!produceResult.success) {
        return produceResult;
      }

      return {
        success: true,
        transaction: {
          production: produceResult.transaction,
          components: componentTransactions,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || "Failed to apply production",
      };
    }
  }

  async applyReceive(
    itemId: string,
    itemType: "FINISHED" | "RAW",
    location: "HILDALE" | "PIVOT" | "N/A",
    quantity: number,
    notes?: string,
    createdBy?: string
  ): Promise<TransactionResult> {
    return this.applyTransaction({
      itemId,
      itemType,
      type: "RECEIVE",
      location,
      quantity,
      notes,
      createdBy,
    });
  }

  async applyShip(
    itemId: string,
    itemType: "FINISHED" | "RAW",
    location: "HILDALE" | "PIVOT" | "N/A",
    quantity: number,
    notes?: string,
    createdBy?: string
  ): Promise<TransactionResult> {
    return this.applyTransaction({
      itemId,
      itemType,
      type: "SHIP",
      location,
      quantity,
      notes,
      createdBy,
    });
  }

  async applyAdjust(
    itemId: string,
    itemType: "FINISHED" | "RAW",
    location: "HILDALE" | "PIVOT" | "N/A",
    quantity: number,
    notes?: string,
    createdBy?: string
  ): Promise<TransactionResult> {
    return this.applyTransaction({
      itemId,
      itemType,
      type: "ADJUST",
      location,
      quantity,
      notes,
      createdBy,
    });
  }

  async getTransactionHistory(itemId: string): Promise<any[]> {
    return this.storage.getInventoryTransactionsByItem(itemId);
  }
}
