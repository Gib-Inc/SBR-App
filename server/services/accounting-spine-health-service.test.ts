import { describe, expect, it } from "vitest";
import { summarizeAccountingSpine } from "./accounting-spine-health-service";

const clean = {
  eligibleMissingBill: [],
  draftLeakedToQbo: [],
  duplicateBillLinks: [],
  amountMismatches: [],
  errorBills: [],
  orphanBills: [],
  latestBill: {
    po_number: "PO-2026-0020",
    quickbooks_bill_id: "18592",
    created_at: "2026-07-16T03:11:09.448Z",
  },
  quickbooksHealth: {
    integration_name: "scheduler:quickbooks-token-refresh",
    last_status: "success",
    last_success_at: "2026-07-17T11:37:03.605Z",
  },
};

describe("summarizeAccountingSpine", () => {
  it("passes when PO→QBO links are clean and token refresh is healthy", () => {
    const health = summarizeAccountingSpine(clean);
    expect(health.overall).toBe("pass");
    expect(health.accountingPolicy).toBe("books_pipe_healthy");
    expect(health.checks.every((c) => c.severity === "pass")).toBe(true);
  });

  it("blocks month-close when an eligible PO is missing its QBO Bill link", () => {
    const health = summarizeAccountingSpine({
      ...clean,
      eligibleMissingBill: [{ po_number: "PO-2026-0021", status: "SENT" }],
    });

    expect(health.overall).toBe("block");
    expect(health.accountingPolicy).toBe("block_close_until_fixed");
    expect(health.checks.find((c) => c.id === "eligible_po_missing_qbo_bill")).toMatchObject({
      severity: "block",
      status: "drift",
      value: 1,
    });
  });

  it("warns when a linked PO and local QBO Bill amount differ", () => {
    const health = summarizeAccountingSpine({
      ...clean,
      amountMismatches: [{ po_number: "PO-2026-0020", po_total: 825, qb_total: 800, diff: 25 }],
    });

    expect(health.overall).toBe("warn");
    expect(health.accountingPolicy).toBe("review_before_close");
    expect(health.checks.find((c) => c.id === "po_bill_amount_mismatch")).toMatchObject({
      severity: "warn",
      status: "drift",
      value: 1,
    });
  });

  it("blocks when a draft PO has leaked into QuickBooks", () => {
    const health = summarizeAccountingSpine({
      ...clean,
      draftLeakedToQbo: [{ po_number: "PO-DRAFT", status: "DRAFT", quickbooks_bill_id: "QB1" }],
    });

    expect(health.overall).toBe("block");
    expect(health.checks.find((c) => c.id === "draft_po_leaked_to_qbo")).toMatchObject({
      severity: "block",
      value: 1,
    });
  });
});
