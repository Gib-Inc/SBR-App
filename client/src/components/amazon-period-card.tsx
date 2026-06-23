import { ChannelSalesCard } from "@/components/channel-sales-card";

/**
 * Live current-period Amazon sales (month-to-date). Thin wrapper over the shared
 * ChannelSalesCard; data comes from /api/finances/amazon-period which reads the
 * app's own sales_orders (Amazon channel) in store-local time.
 */
export function AmazonPeriodCard() {
  return (
    <ChannelSalesCard
      endpoint="/api/finances/amazon-period"
      channelLabel="Amazon"
      testId="card-amazon-period"
    />
  );
}
