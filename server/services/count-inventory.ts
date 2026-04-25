// Item lists and resolver for the /count-inventory shop floor counting flow.
//
// Each location has an ordered list of display names that Sammie counts.
// Per CLAUDE.md, items are matched by name (no hardcoded UUIDs) so the lists
// stay editable without database changes. Each entry has fallback `match`
// patterns the resolver tries in order; an item already claimed by an earlier
// entry is excluded so generic patterns ("nut") don't steal a more specific
// match ("nylon nut").

import type { Item } from "@shared/schema";

export type CountLocation = "raw-materials" | "hildale" | "pyvott";

export type CountListEntry = {
  /** Big plain-English label shown to the user. */
  display: string;
  /** Lowercase substrings to try in order. First item containing one wins. */
  match: string[];
};

export type ResolvedCountItem = {
  display: string;
  itemId: string | null;
  itemName: string | null;
  lastValue: number | null;
};

const RAW_MATERIALS: CountListEntry[] = [
  { display: "Clevis pin with brackets", match: ["clevis pin with bracket", "clevis bracket"] },
  { display: "Clevis pins",              match: ["clevis pin"] },
  { display: "Bowtie pins",              match: ["bowtie pin", "bow tie pin"] },
  { display: "Cotter pins",              match: ["cotter pin"] },
  { display: "Bolts (short)",            match: ["short bolt", "bolt short", "bolt - short"] },
  { display: "Bolts (long)",             match: ["long bolt", "bolt long", "bolt - long"] },
  { display: "Nuts",                     match: ["hex nut", "nut "] },
  { display: "Push 1.0/PB sleeves",      match: ["push 1.0 sleeve", "push 1 sleeve", "pb sleeve", "pull behind sleeve"] },
  { display: "Push 2.0 sleeves",         match: ["push 2.0 sleeve", "push 2 sleeve"] },
  { display: "Bigfoot sleeves",          match: ["bigfoot sleeve"] },
  { display: "Pull Behind boxes",        match: ["pull behind box", "pull-behind box", "pb box"] },
  { display: "Push 2.0 boxes",           match: ["push 2.0 box", "push 2 box"] },
  { display: "Push 1.0 boxes",           match: ["push 1.0 box", "push 1 box"] },
];

const HILDALE: CountListEntry[] = [
  { display: '12" conveyer screen (Push 1.0/PB)', match: ['12" conveyer screen', "12 conveyer screen", "12 inch conveyer screen"] },
  { display: '12" sleeved foam roller (PB)',      match: ["pull behind sleeved foam", "pb sleeved foam roller", "12 sleeved foam roller pb"] },
  { display: 'Catch basket 12" (Push 1.0)',       match: ["catch basket 12", "12 catch basket", "catch basket push 1"] },
  { display: 'Catch basket 18" (Push 2.0)',       match: ["catch basket 18", "18 catch basket", "catch basket push 2"] },
  { display: 'Catch basket (Bigfoot)',            match: ["catch basket bigfoot", "bigfoot catch basket"] },
  { display: 'Catch basket (PB original)',        match: ["catch basket pull behind original", "pb original catch", "catch basket pb"] },
  { display: 'Connecting bar',                    match: ["connecting bar"] },
  { display: '18" conveyer screen (Push 2.0)',    match: ['18" conveyer screen', "18 conveyer screen", "18 inch conveyer screen"] },
  { display: 'Conveyer screen (Bigfoot)',         match: ["conveyer screen bigfoot", "bigfoot conveyer screen"] },
  { display: 'Ground War Combo 1.0',              match: ["ground war combo 1.0", "ground war combo 1", "gw combo 1.0"] },
  { display: 'Ground War Combo 2.0',              match: ["ground war combo 2.0", "ground war combo 2", "gw combo 2.0"] },
  { display: 'Ground War Combo PBB',              match: ["ground war combo pull behind bigfoot", "ground war combo pbb", "gw combo bigfoot"] },
  { display: 'Ground War Combo PBO',              match: ["ground war combo pull behind original", "ground war combo pbo", "gw combo original"] },
  { display: 'Pitchfork attachment',              match: ["pitchfork attachment", "pitchfork"] },
  { display: 'Pull Behind Bigfoot',               match: ["pull-behind bigfoot", "pull behind bigfoot"] },
  { display: 'Pull Behind Original',              match: ["pull-behind original", "pull behind original"] },
  { display: 'Pull Behind Bigfoot refurb',        match: ["pull behind bigfoot refurb", "bigfoot refurb"] },
  { display: 'Pull Behind Original refurb',       match: ["pull behind original refurb", "pb original refurb"] },
  { display: 'Push 1.0',                          match: ["push 1.0 classic", "push 1.0", "push model 1"] },
  { display: 'Push 1.0 refurb',                   match: ["push 1.0 refurb", "push 1 refurb"] },
  { display: 'Push 2.0 Extra Wide',               match: ["push 2.0 extra wide", "push 2.0", "push model 2"] },
  { display: 'Push 2.0 refurb',                   match: ["push 2.0 refurb", "push 2 refurb"] },
  { display: '12" sleeved foam roller (Push 1.0)',match: ["push 1.0 sleeved foam", "push 1 sleeved foam roller", "12 sleeved foam roller push"] },
  { display: '18" sleeved foam roller (Push 2.0)',match: ["push 2.0 sleeved foam", "push 2 sleeved foam roller", "18 sleeved foam roller push"] },
  { display: 'Sleeved foam roller (Bigfoot)',     match: ["bigfoot sleeved foam", "sleeved foam roller bigfoot"] },
  { display: 'Boot covers',                       match: ["boot cover"] },
];

// Pyvott = same finished goods as Hildale minus refurbs, plus 3 bandanas.
const PYVOTT: CountListEntry[] = [
  ...HILDALE.filter((e) => !/refurb/i.test(e.display)),
  { display: 'Bandana — Original',  match: ["bandana original", "original bandana"] },
  { display: 'Bandana — Bigfoot',   match: ["bandana bigfoot", "bigfoot bandana"] },
  { display: 'Bandana — Push',      match: ["bandana push", "push bandana"] },
];

export const COUNT_LISTS: Record<CountLocation, CountListEntry[]> = {
  "raw-materials": RAW_MATERIALS,
  hildale: HILDALE,
  pyvott: PYVOTT,
};

/** Returns the field on `items` that this location's count writes to. */
export function fieldForLocation(loc: CountLocation): "currentStock" | "hildaleQty" | "extensivOnHandSnapshot" {
  switch (loc) {
    case "raw-materials":
      return "currentStock";
    case "hildale":
      return "hildaleQty";
    case "pyvott":
      return "extensivOnHandSnapshot";
  }
}

/** "WEEKLY_COUNT" is the legacy default; this flow uses MANUAL_COUNT for clarity. */
export const COUNT_ADJUSTMENT_TYPE = "MANUAL_COUNT";

/** Inventory-adjustment row's `location` field for each count location. */
export function adjustmentLocationFor(loc: CountLocation): "HILDALE" | "PIVOT" | "N/A" {
  if (loc === "hildale") return "HILDALE";
  if (loc === "pyvott") return "PIVOT";
  return "N/A";
}

/**
 * Resolves each list entry to an item from `items`. Iterates in spec order so
 * an early specific entry ("Clevis pin with brackets") claims its match before
 * a later generic entry ("Clevis pins") tries the same patterns.
 */
export function resolveCountList(
  items: Item[],
  location: CountLocation,
): Array<{ display: string; item: Item | null }> {
  const list = COUNT_LISTS[location];
  const claimed = new Set<string>();

  // Filter items to plausible candidates by type. Raw Materials = components;
  // Hildale + Pyvott = finished_product. Items missing a type are kept just in case.
  const typeFilter = location === "raw-materials"
    ? (i: Item) => i.type === "component" || !i.type
    : (i: Item) => i.type === "finished_product" || !i.type;

  const candidates = items.filter(typeFilter);

  return list.map((entry) => {
    let chosen: Item | null = null;
    for (const pattern of entry.match) {
      const needle = pattern.toLowerCase();
      const found = candidates.find(
        (it) => !claimed.has(it.id) && (it.name ?? "").toLowerCase().includes(needle),
      );
      if (found) {
        chosen = found;
        claimed.add(found.id);
        break;
      }
    }
    return { display: entry.display, item: chosen };
  });
}
