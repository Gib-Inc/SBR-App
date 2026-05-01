// Online-supplier registry. Used by the Suppliers page (Shop button +
// ordering-method badge) and the Raw Materials page (per-component "Order →"
// link). Match by lowercased name so casing/whitespace edits don't break it.

export type OnlineSupplierKey =
  | "mcmaster"
  | "uline"
  | "amazon"
  | "homedepot"
  | "costco";

export interface OnlineSupplierConfig {
  key: OnlineSupplierKey;
  displayName: string;
  shopUrl: string;
  /** Build a search URL for a given query (SKU or item name). */
  searchUrl: (query: string) => string;
}

const REGISTRY: { match: (lower: string) => boolean; config: OnlineSupplierConfig }[] = [
  {
    match: (n) => n.includes("mcmaster"),
    config: {
      key: "mcmaster",
      displayName: "McMaster-Carr",
      shopUrl: "https://www.mcmaster.com/",
      searchUrl: (q) => `https://www.mcmaster.com/search/?query=${encodeURIComponent(q)}`,
    },
  },
  {
    match: (n) => n.includes("uline"),
    config: {
      key: "uline",
      displayName: "Uline",
      shopUrl: "https://www.uline.com/",
      searchUrl: (q) => `https://www.uline.com/BL_8372/Search?keywords=${encodeURIComponent(q)}`,
    },
  },
  {
    match: (n) => n.includes("amazon"),
    config: {
      key: "amazon",
      displayName: "Amazon",
      shopUrl: "https://www.amazon.com/",
      searchUrl: (q) => `https://www.amazon.com/s?k=${encodeURIComponent(q)}`,
    },
  },
  {
    match: (n) => n.includes("home depot") || n.includes("homedepot"),
    config: {
      key: "homedepot",
      displayName: "Home Depot",
      shopUrl: "https://www.homedepot.com/",
      searchUrl: (q) => `https://www.homedepot.com/s/${encodeURIComponent(q)}`,
    },
  },
  {
    match: (n) => n.includes("costco"),
    config: {
      key: "costco",
      displayName: "Costco",
      shopUrl: "https://www.costco.com/",
      searchUrl: (q) => `https://www.costco.com/CatalogSearch?keyword=${encodeURIComponent(q)}`,
    },
  },
];

/** Returns the online-supplier config when the name matches a known vendor. */
export function getOnlineSupplier(name: string | null | undefined): OnlineSupplierConfig | null {
  if (!name) return null;
  const lower = name.toLowerCase();
  for (const entry of REGISTRY) {
    if (entry.match(lower)) return entry.config;
  }
  return null;
}
