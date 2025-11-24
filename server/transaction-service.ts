import type { IStorage } from "./storage";
import type { InsertInventoryTransaction, Item } from "@shared/schema";

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
  constructor(private storage: IStorage) {}

  // NOTE: This method mutates inventory immediately via storage layer and does not
  // participate in database-level transactions. Callers that process multiple
  // transactions (e.g., bulk PO receipt) should validate upfront, but understand
  // that if a later transaction fails, earlier ones will have already been committed
  // to the database with no automatic rollback.
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
      const location = transaction.location;
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

      const updates: Partial<Omit<Item, 'forecastData'>> & { forecastData?: any; forecastDirty?: boolean } = {};

      if (normalizedItemType === "FINISHED") {
        if (transactionType === "TRANSFER_OUT") {
          if (location === "HILDALE") {
            if ((item.hildaleQty ?? 0) < quantity) {
              return {
                success: false,
                error: `Insufficient stock at Hildale. Available: ${item.hildaleQty ?? 0}, Requested: ${quantity}`,
              };
            }
            updates.hildaleQty = (item.hildaleQty ?? 0) - quantity;
          } else if (location === "PIVOT") {
            if ((item.pivotQty ?? 0) < quantity) {
              return {
                success: false,
                error: `Insufficient stock at Pivot. Available: ${item.pivotQty ?? 0}, Requested: ${quantity}`,
              };
            }
            updates.pivotQty = (item.pivotQty ?? 0) - quantity;
          }
        } else if (transactionType === "TRANSFER_IN") {
          if (location === "HILDALE") {
            updates.hildaleQty = (item.hildaleQty ?? 0) + quantity;
          } else if (location === "PIVOT") {
            updates.pivotQty = (item.pivotQty ?? 0) + quantity;
          }
        } else if (transactionType === "PRODUCE") {
          updates.hildaleQty = (item.hildaleQty ?? 0) + quantity;
        } else if (transactionType === "SHIP") {
          if (location === "PIVOT") {
            if ((item.pivotQty ?? 0) < quantity) {
              return {
                success: false,
                error: `Insufficient stock at Pivot to ship. Available: ${item.pivotQty ?? 0}, Requested: ${quantity}`,
              };
            }
            updates.pivotQty = (item.pivotQty ?? 0) - quantity;
          } else {
            return {
              success: false,
              error: "Finished products can only be shipped from PIVOT location",
            };
          }
        } else if (transactionType === "RECEIVE") {
          if (location === "HILDALE") {
            updates.hildaleQty = (item.hildaleQty ?? 0) + quantity;
          } else if (location === "PIVOT") {
            updates.pivotQty = (item.pivotQty ?? 0) + quantity;
          }
        } else if (transactionType === "ADJUST") {
          if (location === "HILDALE") {
            updates.hildaleQty = (item.hildaleQty ?? 0) + quantity;
          } else if (location === "PIVOT") {
            updates.pivotQty = (item.pivotQty ?? 0) + quantity;
          }
        }
      } else if (normalizedItemType === "RAW") {
        if (transactionType === "PRODUCE") {
          if ((item.currentStock ?? 0) < quantity) {
            return {
              success: false,
              error: `Insufficient raw material stock. Available: ${item.currentStock ?? 0}, Required: ${quantity}`,
            };
          }
          updates.currentStock = (item.currentStock ?? 0) - quantity;
        } else if (transactionType === "RECEIVE") {
          updates.currentStock = (item.currentStock ?? 0) + quantity;
        } else if (transactionType === "ADJUST") {
          updates.currentStock = (item.currentStock ?? 0) + quantity;
        } else if (transactionType === "SHIP") {
          if ((item.currentStock ?? 0) < quantity) {
            return {
              success: false,
              error: `Insufficient raw material stock to ship. Available: ${item.currentStock ?? 0}, Requested: ${quantity}`,
            };
          }
          updates.currentStock = (item.currentStock ?? 0) - quantity;
        }
      }

      const createdTransaction = await this.storage.createInventoryTransaction(transaction);

      // Mark forecastDirty=true for finished products when transactions occur
      // This triggers batch forecast recalculation instead of real-time LLM calls
      if (normalizedItemType === "FINISHED") {
        updates.forecastDirty = true;
      }

      if (Object.keys(updates).length > 0) {
        await this.storage.updateItem(transaction.itemId, updates);
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

      const stockAtSource = request.fromLocation === "HILDALE" 
        ? (item.hildaleQty ?? 0) 
        : (item.pivotQty ?? 0);

      if (stockAtSource < request.quantity) {
        return {
          success: false,
          error: `Insufficient stock at ${request.fromLocation}. Available: ${stockAtSource}, Requested: ${request.quantity}`,
        };
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
