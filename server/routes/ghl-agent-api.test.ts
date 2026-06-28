import { describe, it, expect } from "vitest";
import { normEmail, normPhone, extractCustomerIdentity, orderMatchesCustomer, ownershipDecision } from "./ghl-agent-api";

describe("GHL agent customer-ownership binding (P4)", () => {
  it("normalizes email and phone for comparison", () => {
    expect(normEmail("  Foo@Bar.COM ")).toBe("foo@bar.com");
    expect(normPhone("+1 (435) 555-1234")).toBe("4355551234");
    expect(normPhone("435-555-1234")).toBe("4355551234");
    expect(normPhone(null)).toBe("");
  });

  it("extracts identity from many GHL body/param shapes", () => {
    expect(extractCustomerIdentity({ customer_email: "A@B.com" }, {}).email).toBe("a@b.com");
    expect(extractCustomerIdentity({}, { phone: "4355551234" }).phone).toBe("4355551234");
    expect(extractCustomerIdentity({}, { contact: { email: "c@d.com" } }).email).toBe("c@d.com");
    expect(extractCustomerIdentity({}, {}).hasAny).toBe(false);
  });

  it("matches an order to its customer by email OR phone", () => {
    const order = { customerEmail: "jane@x.com", customerPhone: "(435) 555-9999" };
    expect(orderMatchesCustomer(order, { email: "jane@x.com", phone: "" })).toBe(true);
    expect(orderMatchesCustomer(order, { email: "", phone: "4355559999" })).toBe(true);
    expect(orderMatchesCustomer(order, { email: "mallory@evil.com", phone: "" })).toBe(false);
    expect(orderMatchesCustomer(order, { email: "", phone: "0000000000" })).toBe(false);
  });

  it("never matches on an empty identity field (no blank-email bypass)", () => {
    const order = { customerEmail: null, customerPhone: null };
    expect(orderMatchesCustomer(order, { email: "", phone: "" })).toBe(false);
    // an attacker sending a blank email must not match an order with a null email
    expect(orderMatchesCustomer({ customerEmail: null, customerPhone: "4355551234" }, { email: "", phone: "" })).toBe(false);
  });

  describe("ownershipDecision", () => {
    const order = { customerEmail: "jane@x.com", customerPhone: "4355559999" };

    it("denies a mismatching identity regardless of mode (404, no PII leak)", () => {
      const d = ownershipDecision(order, { email: "mallory@evil.com", phone: "", hasAny: true }, false);
      expect(d.allow).toBe(false);
      if (!d.allow) { expect(d.code).toBe(404); expect(d.errorCode).toBe("NOT_FOUND"); }
    });

    it("allows a matching identity", () => {
      expect(ownershipDecision(order, { email: "jane@x.com", phone: "", hasAny: true }, true).allow).toBe(true);
    });

    it("compat mode: allows (but flags) a call with no identity", () => {
      const d = ownershipDecision(order, { email: "", phone: "", hasAny: false }, false);
      expect(d.allow).toBe(true);
      if (d.allow) expect(d.unverified).toBe(true);
    });

    it("strict mode: denies a call with no identity (403)", () => {
      const d = ownershipDecision(order, { email: "", phone: "", hasAny: false }, true);
      expect(d.allow).toBe(false);
      if (!d.allow) { expect(d.code).toBe(403); expect(d.errorCode).toBe("CUSTOMER_REQUIRED"); }
    });
  });
});
