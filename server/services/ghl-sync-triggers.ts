import { poGHLSyncService } from "./po-ghl-sync-service";
import { salesOrderGHLSyncService } from "./sales-order-ghl-sync-service";
import { returnGHLSyncService } from "./return-ghl-sync-service";
import { stockRiskGHLSyncService } from "./stock-risk-ghl-sync-service";

export async function triggerPOSync(userId: string, poId: string, action?: "sent" | "paid" | "delivered"): Promise<void> {
  try {
    await poGHLSyncService.initialize(userId);
    
    let result;
    switch (action) {
      case "paid":
        result = await poGHLSyncService.syncPOPaid(poId);
        break;
      case "delivered":
        result = await poGHLSyncService.syncPODelivered(poId);
        break;
      default:
        result = await poGHLSyncService.syncPurchaseOrderToGHL(poId);
    }
    
    if (result.success) {
      console.log(`[GHL Trigger] PO ${poId} synced to GHL (${action || "default"}): ${result.opportunityId}`);
    } else {
      console.warn(`[GHL Trigger] PO sync failed for ${poId}: ${result.error}`);
    }
  } catch (error: any) {
    console.error(`[GHL Trigger] PO sync error for ${poId}:`, error.message);
  }
}

export async function triggerSalesOrderSync(userId: string, orderId: string, isRefund: boolean = false): Promise<void> {
  try {
    await salesOrderGHLSyncService.initialize(userId);
    
    const result = isRefund
      ? await salesOrderGHLSyncService.syncRefundToGHL(orderId)
      : await salesOrderGHLSyncService.syncSalesOrderToGHL(orderId);
    
    if (result.success) {
      console.log(`[GHL Trigger] Sales order ${orderId} synced to GHL: ${result.opportunityId}`);
    } else {
      console.warn(`[GHL Trigger] Sales order sync failed for ${orderId}: ${result.error}`);
    }
  } catch (error: any) {
    console.error(`[GHL Trigger] Sales order sync error for ${orderId}:`, error.message);
  }
}

export async function triggerReturnSync(userId: string, returnId: string, isRefunded: boolean = false): Promise<void> {
  try {
    await returnGHLSyncService.initialize(userId);
    
    const result = isRefunded
      ? await returnGHLSyncService.markReturnRefunded(returnId)
      : await returnGHLSyncService.syncReturnRefundToGHL(returnId);
    
    if (result.success) {
      console.log(`[GHL Trigger] Return ${returnId} synced to GHL: ${result.opportunityId}`);
    } else {
      console.warn(`[GHL Trigger] Return sync failed for ${returnId}: ${result.error}`);
    }
  } catch (error: any) {
    console.error(`[GHL Trigger] Return sync error for ${returnId}:`, error.message);
  }
}

interface StockRiskItem {
  itemId: string;
  sku: string;
  name: string;
  daysUntilStockout: number;
  currentStock: number;
  dailyVelocity: number;
}

export async function triggerStockRiskSync(userId: string, riskItems: StockRiskItem[]): Promise<void> {
  try {
    await stockRiskGHLSyncService.initialize(userId);
    
    const results = await stockRiskGHLSyncService.syncBatchStockRisks(
      riskItems.map(item => ({
        ...item,
        riskLevel: stockRiskGHLSyncService.getRiskLevelFromDays(item.daysUntilStockout),
      }))
    );
    
    console.log(`[GHL Trigger] Stock risk sync complete: ${results.synced} synced, ${results.failed} failed`);
  } catch (error: any) {
    console.error(`[GHL Trigger] Stock risk sync error:`, error.message);
  }
}

export async function triggerSingleStockRiskSync(
  userId: string, 
  itemId: string, 
  sku: string, 
  name: string,
  daysUntilStockout: number,
  currentStock: number,
  dailyVelocity: number
): Promise<void> {
  try {
    await stockRiskGHLSyncService.initialize(userId);
    
    const result = await stockRiskGHLSyncService.syncStockRiskToGHL({
      itemId,
      sku,
      name,
      daysUntilStockout,
      currentStock,
      dailyVelocity,
      riskLevel: stockRiskGHLSyncService.getRiskLevelFromDays(daysUntilStockout),
    });
    
    if (result.success) {
      console.log(`[GHL Trigger] Stock risk for ${sku} synced to GHL: ${result.opportunityId}`);
    } else {
      console.warn(`[GHL Trigger] Stock risk sync failed for ${sku}: ${result.error}`);
    }
  } catch (error: any) {
    console.error(`[GHL Trigger] Stock risk sync error for ${sku}:`, error.message);
  }
}
