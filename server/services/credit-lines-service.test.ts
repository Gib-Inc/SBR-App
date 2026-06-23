import { describe, it, expect } from "vitest";
import { isOperationalLiability } from "./credit-lines-service";

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
