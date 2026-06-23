import { describe, it, expect } from "vitest";
import {
  resolveSupplierFromEmail,
  matchVendorLines,
  safeDate,
  type SupplierLite,
  type SupplierItemLite,
  type ItemLite,
  type ParsedVendorLine,
} from "./vendor-email-po-service";

const SUPPLIERS: SupplierLite[] = [
  { id: "u", name: "Uline" },
  { id: "m", name: "McMaster-Carr" },
  { id: "h", name: "Home Depot" },
  { id: "a", name: "Austin Enterprises" },
];

describe("resolveSupplierFromEmail", () => {
  it("resolves by sender domain (allowlist) over parsed name", () => {
    expect(resolveSupplierFromEmail(null, "customer.service@uline.com", SUPPLIERS)?.id).toBe("u");
    expect(resolveSupplierFromEmail(null, "no-reply@mail.mcmaster.com", SUPPLIERS)?.id).toBe("m");
  });
  it("falls back to the parsed supplier name when the domain is unknown", () => {
    expect(resolveSupplierFromEmail("Austin Enterprises", "sales@randommailer.io", SUPPLIERS)?.id).toBe("a");
  });
  it("returns null when nothing matches", () => {
    expect(resolveSupplierFromEmail(null, "x@nowhere.com", SUPPLIERS)).toBeNull();
    expect(resolveSupplierFromEmail("Totally Unknown Vendor", null, SUPPLIERS)).toBeNull();
  });
});

describe("matchVendorLines", () => {
  const supplierItems: SupplierItemLite[] = [
    { itemId: "box", supplierSku: "S-13320" },
    { itemId: "foam", supplierSku: "S-2961" },
    { itemId: "pvc", supplierSku: null }, // supplier-linked but no part number → name-matchable
  ];
  const items: ItemLite[] = [
    { id: "box", sku: "SBR-PKG-BOX", name: "Corrugated Box 22x14x10" },
    { id: "foam", sku: "SBR-PKG-FOAM12", name: "Foam Roll 1/8 inch 12x350" },
    { id: "pvc", sku: "SBR-RAW-PVC10", name: "PVC Pipe 1 inch x 10ft" },
  ];

  // From the real Uline confirmation #50837923.
  const lines: ParsedVendorLine[] = [
    { partNumber: "S-13320", description: '22 X 14 X 10" CORRUGATED BOXES', quantity: 160, unitCost: 2.58 },
    { partNumber: "S-2961", description: "ULINE UPSABLE FOAM ROLL", quantity: 10, unitCost: 39.0 },
    { partNumber: "S-14864", description: "ULINE PALLET NOTES - ENGLISH", quantity: 1, unitCost: 0 },
  ];

  it("matches by vendor part number first", () => {
    const { matched, unmatched } = matchVendorLines(lines, supplierItems, items);
    expect(matched.map((m) => m.itemId).sort()).toEqual(["box", "foam"]);
    expect(matched.every((m) => m.matchedBy === "part")).toBe(true);
    expect(unmatched.map((u) => u.vendorPart)).toEqual(["S-14864"]); // no supplier_sku, weak name overlap
  });

  it("falls back to a name match when there is no part number", () => {
    const { matched } = matchVendorLines(
      [{ partNumber: null, description: "PVC Pipe 1 inch x 10 ft", quantity: 4, unitCost: 7.5 }],
      supplierItems,
      items,
    );
    expect(matched).toHaveLength(1);
    expect(matched[0].itemId).toBe("pvc");
    expect(matched[0].matchedBy).toBe("name");
  });

  it("drops zero-quantity lines entirely", () => {
    const { matched, unmatched } = matchVendorLines(
      [{ partNumber: "S-13320", description: "boxes", quantity: 0, unitCost: 2.58 }],
      supplierItems,
      items,
    );
    expect(matched).toHaveLength(0);
    expect(unmatched).toHaveLength(0);
  });

  it("does NOT fuzzy-match an item this supplier does not carry", () => {
    // "Steel Rod" exists in the catalog but is not one of this supplier's items.
    const all = [...items, { id: "rod", sku: "SBR-RAW-ROD", name: "Steel Rod 3/8 inch" }];
    const { matched, unmatched } = matchVendorLines(
      [{ partNumber: null, description: "Steel Rod 3/8 inch", quantity: 5, unitCost: 4 }],
      supplierItems, // rod not present here → not supplier-linked
      all,
    );
    expect(matched).toHaveLength(0);
    expect(unmatched).toHaveLength(1);
  });
});

describe("safeDate", () => {
  it("accepts a valid YYYY-MM-DD", () => {
    expect(safeDate("2026-06-23")?.toISOString().slice(0, 10)).toBe("2026-06-23");
  });
  it("rejects malformed, rollover, and prose dates (no throw, no bad PO date)", () => {
    expect(safeDate("2026-13-01")).toBeUndefined();
    expect(safeDate("2026-02-30")).toBeUndefined(); // would roll over to March
    expect(safeDate("Jun 23")).toBeUndefined();
    expect(safeDate("next week")).toBeUndefined();
    expect(safeDate(null)).toBeUndefined();
    expect(safeDate("")).toBeUndefined();
  });
});
