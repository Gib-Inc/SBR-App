import { describe, it, expect } from "vitest";
import { orderIdentityKey, dedupeOrdersByIdentity } from "./daily-sales-scheduler";

describe("orderIdentityKey", () => {
  it("uses order_name for Shopify (collapses the same order under different external ids)", () => {
    const a = orderIdentityKey({ channel: "SHOPIFY", orderName: "#15812", externalOrderId: "6568555544715" });
    const b = orderIdentityKey({ channel: "SHOPIFY", orderName: "#15812", externalOrderId: "gid://shopify/Order/6568555544715" });
    expect(a).toBe(b); // same physical order despite different external ids
  });
  it("falls back to external id when no order_name (Amazon)", () => {
    expect(orderIdentityKey({ channel: "AMAZON", externalOrderId: "111-222" })).toBe("AMAZON|111-222");
  });
  it("is channel-scoped", () => {
    expect(orderIdentityKey({ channel: "SHOPIFY", orderName: "#1" }))
      .not.toBe(orderIdentityKey({ channel: "AMAZON", orderName: "#1" }));
  });
});

describe("dedupeOrdersByIdentity", () => {
  it("collapses duplicate rows of the same physical order, keeping one", () => {
    const orders = [
      { id: "a", channel: "SHOPIFY", orderName: "#15812", externalOrderId: "111", totalAmount: 322.97 },
      { id: "b", channel: "SHOPIFY", orderName: "#15812", externalOrderId: "222", totalAmount: 322.97 },
      { id: "c", channel: "SHOPIFY", orderName: "#15813", externalOrderId: "333", totalAmount: 100 },
    ];
    const out = dedupeOrdersByIdentity(orders);
    expect(out).toHaveLength(2);
    expect(out.map((o) => o.orderName).sort()).toEqual(["#15812", "#15813"]);
  });

  it("revenue summed over deduped orders equals the true total, not the inflated one", () => {
    // the incident shape: one $322.97 order cloned 10x
    const clones = Array.from({ length: 10 }, (_, i) => ({
      id: `r${i}`, channel: "SHOPIFY", orderName: "#15812", externalOrderId: `e${i}`, totalAmount: 322.97,
    }));
    const naive = clones.reduce((s, o) => s + o.totalAmount, 0);
    const deduped = dedupeOrdersByIdentity(clones).reduce((s, o) => s + o.totalAmount, 0);
    expect(Math.round(naive)).toBe(3230); // 10x inflation
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
