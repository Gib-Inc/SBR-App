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
