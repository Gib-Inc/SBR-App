/**
 * Boot assertion for the atomic inventory claim gate (fix/number-integrity).
 *
 * InventoryMovement.apply's fail-closed ladder relies on the ACTIVE storage
 * exposing claimLedgerAndUpdateItem (claim + stock write in one transaction).
 * A storage refactor that drops the method would silently degrade claimed
 * movements to the sequential-claim rung (crash window: recorded movement that
 * never applied). These tests pin BOTH storage implementations to the method
 * and prove the boot assertion fails loud instead of booting degraded.
 */
import { describe, it, expect } from "vitest";
import { PostgresStorage, MemStorage } from "../storage";
import { assertStorageClaimGate } from "./startup-checks";

describe("storage claim gate (boot assertion)", () => {
  it("PostgresStorage.prototype.claimLedgerAndUpdateItem is a function", () => {
    // Prototype check only — no instantiation, no connection string needed.
    expect(typeof PostgresStorage.prototype.claimLedgerAndUpdateItem).toBe("function");
  });

  it("MemStorage.prototype.claimLedgerAndUpdateItem is a function", () => {
    expect(typeof MemStorage.prototype.claimLedgerAndUpdateItem).toBe("function");
  });

  it("assertStorageClaimGate passes for a storage exposing the method", () => {
    expect(() => assertStorageClaimGate({ claimLedgerAndUpdateItem: async () => ({ claimed: true }) })).not.toThrow();
  });

  it("assertStorageClaimGate throws a fatal error when the method is missing", () => {
    let thrown: any;
    try {
      assertStorageClaimGate({ updateItem: async () => undefined });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown.message).toContain("FATAL");
    expect(thrown.message).toContain("claimLedgerAndUpdateItem");
    // The `fatal` marker is what app.ts keys on to rethrow (fail the boot)
    // instead of swallowing like the non-blocking startup checks.
    expect(thrown.fatal).toBe(true);
  });

  it("assertStorageClaimGate validates the ACTIVE singleton by default without throwing", () => {
    // The real exported `storage` singleton (MemStorage here — no DATABASE_URL
    // in the test env; PostgresStorage in prod) must satisfy the gate.
    expect(() => assertStorageClaimGate()).not.toThrow();
  });
});
