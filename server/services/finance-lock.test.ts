import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { financePinConfigured, verifyFinancePin, requireFinanceUnlock, financeUnlocked } from "./finance-lock";

const orig = process.env.FINANCE_PIN;
afterEach(() => { if (orig === undefined) delete process.env.FINANCE_PIN; else process.env.FINANCE_PIN = orig; });

describe("financePinConfigured", () => {
  it("is false when unset or too short, true for a real PIN", () => {
    delete process.env.FINANCE_PIN;
    expect(financePinConfigured()).toBe(false);
    process.env.FINANCE_PIN = "abc";
    expect(financePinConfigured()).toBe(false);
    process.env.FINANCE_PIN = "letmein-2026";
    expect(financePinConfigured()).toBe(true);
  });
});

describe("verifyFinancePin", () => {
  beforeEach(() => { process.env.FINANCE_PIN = "letmein-2026"; });
  it("accepts the exact PIN", () => expect(verifyFinancePin("letmein-2026")).toBe(true));
  it("rejects wrong / empty / non-string / length-mismatch", () => {
    expect(verifyFinancePin("letmein-2025")).toBe(false);
    expect(verifyFinancePin("")).toBe(false);
    expect(verifyFinancePin("letmein")).toBe(false);
    expect(verifyFinancePin(undefined as any)).toBe(false);
    expect(verifyFinancePin(1234 as any)).toBe(false);
  });
  it("rejects everything when no PIN is configured", () => {
    delete process.env.FINANCE_PIN;
    expect(verifyFinancePin("anything")).toBe(false);
  });
});

describe("requireFinanceUnlock", () => {
  function mockRes() {
    const r: any = { statusCode: 0, body: null, status(c: number) { this.statusCode = c; return this; }, json(b: any) { this.body = b; return this; } };
    return r;
  }
  it("is dormant (open) when no PIN is configured", () => {
    delete process.env.FINANCE_PIN;
    const res = mockRes(); let nexted = false;
    requireFinanceUnlock({ session: {} } as any, res, () => { nexted = true; });
    expect(nexted).toBe(true);
    expect(res.statusCode).toBe(0);
  });
  it("423 when PIN set but session locked", () => {
    process.env.FINANCE_PIN = "letmein-2026";
    const res = mockRes(); let nexted = false;
    requireFinanceUnlock({ session: {} } as any, res, () => { nexted = true; });
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(423);
    expect(res.body.configured).toBe(true);
  });
  it("calls next() when the session is unlocked", () => {
    process.env.FINANCE_PIN = "letmein-2026";
    const res = mockRes(); let nexted = false;
    requireFinanceUnlock({ session: { financeUnlocked: true } } as any, res, () => { nexted = true; });
    expect(nexted).toBe(true);
    expect(res.statusCode).toBe(0);
  });
  it("financeUnlocked reads the session flag", () => {
    expect(financeUnlocked({ session: { financeUnlocked: true } } as any)).toBe(true);
    expect(financeUnlocked({ session: {} } as any)).toBe(false);
    expect(financeUnlocked({} as any)).toBe(false);
  });
});
