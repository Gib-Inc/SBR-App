export const GHL_CONFIG = {
  locationId: "exl44iieQVxSWYsySkpq",
  pipelineId: "m28NXgDcGrl85EMg7ZPN",
  baseUrl: "https://services.leadconnectorhq.com",
  stages: {
    PO_SENT: "f87df3cc-07d1-45e0-bb14-e54f15d32726",
    PO_PAID: "c7d0dc4f-41bf-4e13-bd99-f6110e90ec2f",
    PO_DELIVERED: "c1935d57-59cb-47e5-b182-7b209f514f82",
    SALES_ORDERS: "4eab2cae-426e-4ff3-9304-560416a41b04",
    REFUND_PROCESSING: "d946f5f8-e469-47df-9f06-99223fc3e497",
    REFUNDED: "801a89fa-8f39-4b67-960b-ed1614833594",
    STOCK_21_30: "85ead3ad-da5f-4659-bb35-43a3ea03b268",
    STOCK_14_21: "eea14324-ac58-4b95-a259-6762e1a3796b",
    STOCK_ORDER_NOW: "a62574d0-2d31-4de4-86dd-a9192cc30130",
    STALE_SYNC_ALERT: "22c1a9a6-8e24-43be-8d8b-a24b005ce4cb",
    // NEEDS_ATTENTION is the same stage as STALE_SYNC_ALERT - used for fulfillment alerts (Hildale/Backordered)
    NEEDS_ATTENTION: "22c1a9a6-8e24-43be-8d8b-a24b005ce4cb",
  },
} as const;

export type GHLStageKey = keyof typeof GHL_CONFIG.stages;
export type GHLStageId = typeof GHL_CONFIG.stages[GHLStageKey];
