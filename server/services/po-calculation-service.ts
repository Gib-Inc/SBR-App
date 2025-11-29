import type { PurchaseOrderLine, PurchaseOrder } from "@shared/schema";

export interface POCalculationResult {
  subtotal: number;
  shippingCost: number;
  otherFees: number;
  total: number;
  valueReceived: number;
}

export interface LineCalculationResult {
  lineTotal: number;
}

export function calculateLineTotal(qtyOrdered: number, unitCost: number): number {
  const qty = Number(qtyOrdered) || 0;
  const cost = Number(unitCost) || 0;
  return Math.round(qty * cost * 100) / 100;
}

export function calculatePOTotals(
  lines: Array<Pick<PurchaseOrderLine, 'qtyOrdered' | 'unitCost' | 'qtyReceived' | 'lineTotal'>>,
  shippingCost: number = 0,
  otherFees: number = 0
): POCalculationResult {
  const subtotal = lines.reduce((sum, line) => {
    const lineTotal = calculateLineTotal(line.qtyOrdered, line.unitCost);
    return sum + lineTotal;
  }, 0);
  
  const shipping = Number(shippingCost) || 0;
  const fees = Number(otherFees) || 0;
  const total = Math.round((subtotal + shipping + fees) * 100) / 100;
  
  const valueReceived = lines.reduce((sum, line) => {
    const receivedValue = (Number(line.qtyReceived) || 0) * (Number(line.unitCost) || 0);
    return sum + receivedValue;
  }, 0);
  
  return {
    subtotal: Math.round(subtotal * 100) / 100,
    shippingCost: Math.round(shipping * 100) / 100,
    otherFees: Math.round(fees * 100) / 100,
    total,
    valueReceived: Math.round(valueReceived * 100) / 100,
  };
}

export function formatCurrency(amount: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export const poCalculationService = {
  calculateLineTotal,
  calculatePOTotals,
  formatCurrency,
};
