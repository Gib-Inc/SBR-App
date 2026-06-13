import { describe, it, expect } from "vitest";
import { orderIdentityKey, dedupeOrdersByIdentity } from "./daily-sales-scheduler";

describe("orderIdentityKey", () => {
  it("keys on external_order_id alone (channel-agnostic) — collapses cross-channel twins", () => {
    const shopify = orderIdentityKey({ channel: "SHOPIFY", orderName: "#15614", externalOrderId: "6543528427659" });
    const amazonTwin = orderIdentityKey({ channel: "AMAZON", orderName: null, externalOrderId: "6543528427659" });
    expect(shopify).toBe(amazonTwin); // same physical order, different channel labels
    expect(shopify).toBe("EXT|6543528427659");
  });
  it("treats different external ids as different orders", () => {
    expect(orderIdentityKey({ channel: "SHOPIFY", externalOrderId: "111" }))
      .not.toBe(orderIdentityKey({ channel: "SHOPIFY", externalOrderId: "222" }));
  });
  it("falls back to channel+order_name only when there is no external id", () => {
    expect(orderIdentityKey({ channel: "DIRECT", orderName: "MANUAL-1" })).toBe("DIRECT|MANUAL-1");
  });
});

describe("dedupeOrdersByIdentity", () => {
  it("collapses a cross-channel twin pair to one row", () => {
    const orders = [
      { id: "a", channel: "SHOPIFY", orderName: "#15614", externalOrderId: "6543528427659", totalAmount: 295.45 },
      { id: "b", channel: "AMAZON", orderName: null, externalOrderId: "6543528427659", totalAmount: 295.45 },
      { id: "c", channel: "SHOPIFY", orderName: "#15615", externalOrderId: "6543528427660", totalAmount: 100 },
    ];
    const out = dedupeOrdersByIdentity(orders);
    expect(out).toHaveLength(2);
    expect(out.map((o) => o.externalOrderId).sort()).toEqual(["6543528427659", "6543528427660"]);
  });

  it("revenue summed over deduped twins equals the true total, not the double-count", () => {
    const twins = [
      { id: "a", channel: "SHOPIFY", externalOrderId: "999", totalAmount: 322.97 },
      { id: "b", channel: "AMAZON", externalOrderId: "999", totalAmount: 322.97 },
    ];
    const naive = twins.reduce((s, o) => s + o.totalAmount, 0);
    const deduped = dedupeOrdersByIdentity(twins).reduce((s, o) => s + o.totalAmount, 0);
    expect(naive).toBe(645.94); // double-counted
    expect(deduped).toBe(322.97); // correct
  });

  it("does not collapse genuinely distinct orders", () => {
    const orders = [
      { id: "a", channel: "AMAZON", externalOrderId: "111-1" },
      { id: "b", channel: "AMAZON", externalOrderId: "111-2" },
    ];
    expect(dedupeOrdersByIdentity(orders)).toHaveLength(2);
  });
});
