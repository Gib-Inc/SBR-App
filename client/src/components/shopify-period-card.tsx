import { ChannelSalesCard } from "@/components/channel-sales-card";

/**
 * Live current-period Shopify sales (month-to-date). Thin wrapper over the shared
 * ChannelSalesCard; data comes from /api/finances/shopify-period which reads the
 * app's own sales_orders (Shopify channel) in store-local time.
 */
export function ShopifyPeriodCard() {
  return (
    <ChannelSalesCard
      endpoint="/api/finances/shopify-period"
      channelLabel="Shopify"
      testId="card-shopify-period"
    />
  );
}
