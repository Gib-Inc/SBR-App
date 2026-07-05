import { describe, it, expect } from "vitest";
import { isOperationalLiability, parseAprFromName } from "./credit-lines-service";

describe("parseAprFromName (fills a null APR from the QB account-name token)", () => {
  it("parses the embedded rate from real SBR facility names", () => {
    expect(parseAprFromName("SBS HELOC Loan RP ITD 36% V")).toBe(36);
    expect(parseAprFromName("Newity SBA LTNP ITD $120K 9.5% F")).toBe(9.5);
    expect(parseAprFromName("Shoreham Bank SBA LTNP ITD $150K 11.5% F")).toBe(11.5);
    expect(parseAprFromName("Capital On Tap CC ITD 4299 $19K 35.17% V")).toBe(35.17);
  });
  it("returns null when there is no % token (never fabricate a rate)", () => {
    expect(parseAprFromName("Fresh Funding MCA STNP ITD $256K V")).toBeNull();
    expect(parseAprFromName("Shopify Capital MCA STNP ITD $200K V")).toBeNull();
    expect(parseAprFromName("Burz LLC RP ITD")).toBeNull();
    expect(parseAprFromName("")).toBeNull();
  });
  it("rejects out-of-range values (e.g. a dollar figure mis-read as a percent)", () => {
    expect(parseAprFromName("Weird 150% note")).toBeNull(); // >100
    expect(parseAprFromName("Zero 0% intro")).toBeNull();   // not > 0
  });
});

describe("isOperationalLiability", () => {
  it("excludes operational liabilities (not credit lines)", () => {
    for (const n of [
      "Accounts Payable (A/P)", "Sales Tax To Pay", "Payroll Liabilities",
      "Deferred Revenue", "UT Income Tax", "Federal Unemployment (940)",
      "Federal Taxes (941/944)", "AZ Child Support", "Direct Deposit Payable",
      "Accrued Payroll Liabilities", "USTC Corporate Tax to Pay", "Other Current Liabilities",
    ]) {
      expect(isOperationalLiability(n)).toBe(true);
    }
  });

  it("keeps real credit lines", () => {
    for (const n of [
      "American Express 43003", "Capital One 7055", "AFCU Line of Credit 5964",
      "Stubbs, Stacy - 10-10-25 HELOC LOC", "Newity-SBA 1-22-25 $120K 10 Year Loan",
      "Shopify Capital/WebBank - 12-15-25", "PayPal LoanBuilder/WebBank", "Home Depot 4845",
    ]) {
      expect(isOperationalLiability(n)).toBe(false);
    }
  });
});

describe("D3 payment-terms math", () => {
  it("monthlyEquivalent normalizes cadences (daily ×21 business days, weekly ×4.33)", async () => {
    const { monthlyEquivalent } = await import("./credit-lines-service");
    expect(monthlyEquivalent(1000, "daily")).toBe(21000);
    expect(monthlyEquivalent(1000, "weekly")).toBe(4330);
    expect(monthlyEquivalent(1000, "biweekly")).toBe(2170);
    expect(monthlyEquivalent(1000, "monthly")).toBe(1000);
    expect(monthlyEquivalent(1000, null)).toBe(1000); // default monthly
    expect(monthlyEquivalent(null, "daily")).toBeNull();
    expect(monthlyEquivalent(0, "daily")).toBeNull(); // no terms → null, never a fake 0-as-real
  });

  it("dailyDebitTotal sums ONLY daily-cadence facilities (the bank-reconcilable ACH out)", async () => {
    const { dailyDebitTotal } = await import("./credit-lines-service");
    expect(dailyDebitTotal([
      { paymentAmount: 850, paymentFrequency: "daily" },   // Shopify Capital
      { paymentAmount: 620, paymentFrequency: "daily" },   // Fresh Funding
      { paymentAmount: 5000, paymentFrequency: "monthly" }, // SBA — not a daily debit
      { paymentAmount: null, paymentFrequency: "daily" },   // unentered → contributes 0
    ])).toBe(1470);
    expect(dailyDebitTotal([])).toBe(0);
  });

  it("isRateUnreliable flags a scraped APR on factor/revenue-share facilities (Fresh Funding '9.72%' lie)", async () => {
    const { isRateUnreliable } = await import("./credit-lines-service");
    expect(isRateUnreliable("factor", 9.72)).toBe(true);        // the MCA with a scraped % — the lie
    expect(isRateUnreliable("revenue_share", 17)).toBe(true);   // rev-share has no APR
    expect(isRateUnreliable("factor", null)).toBe(false);       // no apr shown → nothing to mistrust
    expect(isRateUnreliable("apr", 36)).toBe(false);            // a real APR facility
    expect(isRateUnreliable(null, 11.5)).toBe(false);           // unclassified → apr presumed real
  });

  it("isDebtServiceBlind trips above 50% of balance without terms (the Jul 2026 prod state — $1.15M, 0 terms — trips it)", async () => {
    const { isDebtServiceBlind } = await import("./credit-lines-service");
    expect(isDebtServiceBlind(1154477, 1154477)).toBe(true);  // 100% blind (verified prod state)
    expect(isDebtServiceBlind(600000, 1154477)).toBe(true);   // just over half
    expect(isDebtServiceBlind(500000, 1154477)).toBe(false);  // under half — per-facility fields cover it
    expect(isDebtServiceBlind(0, 1154477)).toBe(false);       // all terms entered
    expect(isDebtServiceBlind(0, 0)).toBe(false);             // nothing to service ≠ blind
  });
});
