/**
 * CIPH.R Sync Reconciliation (Phase 2) — Shopify order-update decision.
 *
 * The webhook layer already prevents replay duplicates (order-create skips when
 * the order exists; refunds dedup by refund id). The remaining gap was the
 * order-UPDATE path: it only guarded against status *downgrades*, so a stale or
 * re-delivered same-status webhook could still overwrite rawPayload/orderName
 * with older data. This pure, tested helper combines:
 *   - downgrade guard (never go backwards unless cancelled/refunded), and
 *   - newer-wins on same status (apply only if the incoming updated_at is newer).
 */

const STATUS_RANK: Record<string, number> = {
  DRAFT: 0, ORDERED: 1, SHIPPED: 2, DELIVERED: 3, CANCELLED: 4, REFUNDED: 5,
};

export interface OrderUpdateDecisionInput {
  prevStatus: string;
  newStatus: string;
  prevUpdatedAt?: Date | string | null;
  incomingUpdatedAt?: Date | string | null;
}

export function shouldApplyOrderUpdate(input: OrderUpdateDecisionInput): { apply: boolean; reason: string } {
  const prevRank = STATUS_RANK[input.prevStatus] ?? 1;
  const newRank = STATUS_RANK[input.newStatus] ?? 1;
  const terminal = input.newStatus === "CANCELLED" || input.newStatus === "REFUNDED";

  if (terminal || newRank > prevRank) {
    return { apply: true, reason: `status advancing (${input.prevStatus} → ${input.newStatus})` };
  }
  if (newRank < prevRank) {
    return { apply: false, reason: `skip downgrade (${input.prevStatus} → ${input.newStatus})` };
  }
  // Same status → newer-wins: only apply if the incoming event is strictly newer.
  const p = input.prevUpdatedAt != null ? new Date(input.prevUpdatedAt).getTime() : null;
  const i = input.incomingUpdatedAt != null ? new Date(input.incomingUpdatedAt).getTime() : null;
  if (p != null && i != null && !Number.isNaN(p) && !Number.isNaN(i) && i <= p) {
    return { apply: false, reason: `skip stale same-status update (incoming ${new Date(i).toISOString()} ≤ stored ${new Date(p).toISOString()})` };
  }
  return { apply: true, reason: "same status, fresher or unknown timestamp" };
}
