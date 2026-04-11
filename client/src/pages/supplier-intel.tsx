import { useState } from "react";

// ─── TODAY'S DATE ─────────────────────────────────────────────────────────────
const TODAY = new Date("2026-04-11");

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + Math.round(days));
  return d;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function daysFromNow(date: Date): number {
  return Math.round((date.getTime() - TODAY.getTime()) / (1000 * 60 * 60 * 24));
}

// ─── TYPES ──────────────────────────────────────────────────────────────────────
interface SupplierItem {
  sku: string;
  desc: string;
  unitCost: number;
  moq: number;
}

interface Supplier {
  id: string;
  name: string;
  type: string;
  leadTimeDays: number;
  color: string;
  items: SupplierItem[];
  notes: string;
}

interface InventoryItem {
  sku: string;
  name: string;
  available: number;
  projVelocity: number;
  status: "CRITICAL" | "REORDER" | "ORDER_SOON" | "OK";
  q2Need: number;
  gap: number;
  supplierCost: number;
  supplierId: string;
  amazonPct: number;
  shopifyPct: number;
}

// ─── DATA ───────────────────────────────────────────────────────────────────────
const SUPPLIERS: Supplier[] = [
  {
    id: "fx-industries",
    name: "FX Industries",
    type: "Metal Fabrication",
    leadTimeDays: 21,
    color: "#e85d04",
    items: [
      { sku: "SBRClassic1.0", desc: '12" Push Frame', unitCost: 44.00, moq: 200 },
      { sku: "SBRExtrawide2.0", desc: '18" Push Frame', unitCost: 59.00, moq: 200 },
      { sku: "SBR-PBIndustrial", desc: '12" Pull-Behind Frame', unitCost: 475.00, moq: 10 },
    ],
    notes: "Longest lead time of all vendors. If you're reading a critical alert for a Push unit, the PO is already overdue.",
  },
  {
    id: "silver-fox",
    name: "Silver Fox LLC",
    type: "Screens & Sleeves",
    leadTimeDays: 7,
    color: "#2dc653",
    items: [
      { sku: "302-REP-M1", desc: 'Screen 12.5"', unitCost: 2.00, moq: 100 },
      { sku: "304-REP-M2", desc: 'Screen 18.5"', unitCost: 3.50, moq: 100 },
      { sku: "1202-REP-M2", desc: "Screen Bigfoot", unitCost: 3.50, moq: 100 },
      { sku: "301-REP-M1", desc: 'Sleeve 12"', unitCost: 3.00, moq: 100 },
      { sku: "305-REP-M2", desc: 'Sleeve 18"', unitCost: 4.00, moq: 100 },
      { sku: "1203-REP-M2", desc: "Sleeve Bigfoot", unitCost: 4.00, moq: 100 },
    ],
    notes: "Fastest and most reliable. Can turn around weekly orders during peak season. No excuses for stockouts here.",
  },
  {
    id: "pednar",
    name: "Pednar",
    type: "Foam Rollers",
    leadTimeDays: 14,
    color: "#4cc9f0",
    items: [
      { sku: "301-REP-M1-FOAM", desc: '6"x36" Foam (Push 1.0)', unitCost: 8.65, moq: 480 },
      { sku: "305-REP-M2-FOAM", desc: '10"x12" Foam (Push 2.0)', unitCost: 9.95, moq: 480 },
      { sku: "1203-REP-M2-FOAM", desc: '10"x17.5" Foam (Bigfoot)', unitCost: 9.95, moq: 500 },
    ],
    notes: "Order in batches of 480-540. Bigfoot foam price has ranged $9.95-$15.32 - lock in low price when possible.",
  },
  {
    id: "acu-form",
    name: "Acu-Form Plastics",
    type: "Proprietary Trays",
    leadTimeDays: 18,
    color: "#f72585",
    items: [
      { sku: "SB1-TRAY", desc: "Small Tray", unitCost: 13.91, moq: 100 },
      { sku: "SB2-TRAY", desc: "Large Tray", unitCost: 15.97, moq: 100 },
      { sku: "SB3-TRAY", desc: "Long Tray", unitCost: 41.73, moq: 30 },
    ],
    notes: "Sole source - proprietary molds. No backup supplier exists. Run a higher safety stock buffer here than anywhere else.",
  },
  {
    id: "liston",
    name: "Liston Metalworks",
    type: "Goat Head Blades",
    leadTimeDays: 21,
    color: "#9d4edd",
    items: [
      { sku: "BLADE-GOAT", desc: "Goat Head Blade (assembled)", unitCost: 23.21, moq: 50 },
      { sku: "PULLBEHIND-BRACKET", desc: "Pull-Behind Bracket Set", unitCost: 6.00, moq: 18 },
    ],
    notes: "Material + hardware + cutting + assembly all bundled. 3-week lead - plan ahead for any Pull-Behind production run.",
  },
  {
    id: "uline",
    name: "Uline",
    type: "Packaging",
    leadTimeDays: 5,
    color: "#ffd60a",
    items: [
      { sku: "S-4804-BOX", desc: '26x15x12" Box (Push)', unitCost: 3.94, moq: 100 },
      { sku: "S-18368-BOX", desc: '26x16x16" Box (Bigfoot)', unitCost: 4.43, moq: 100 },
      { sku: "S-16770-BOX", desc: '46x20x12" Box (Pull-Behind)', unitCost: 7.18, moq: 50 },
      { sku: "S-2961-FOAM", desc: '12"x350\' Foam Roll', unitCost: 39.00, moq: 10 },
    ],
    notes: "Fastest ship. Never let boxes run out - it's a $4 problem that stops a $500 shipment.",
  },
];

const INVENTORY: InventoryItem[] = [
  { sku: "SBRClassic1.0", name: "Push 1.0 Classic", available: 74, projVelocity: 168, status: "CRITICAL", q2Need: 2182, gap: 2108, supplierCost: 44.00, supplierId: "fx-industries", amazonPct: 68, shopifyPct: 32 },
  { sku: "SBRExtrawide2.0", name: "Push 2.0 Extra Wide", available: 138, projVelocity: 142, status: "CRITICAL", q2Need: 1851, gap: 1713, supplierCost: 59.00, supplierId: "fx-industries", amazonPct: 73, shopifyPct: 27 },
  { sku: "702-CMB-2", name: "Combo 2.0", available: 10, projVelocity: 15, status: "CRITICAL", q2Need: 195, gap: 185, supplierCost: 103.00, supplierId: "fx-industries", amazonPct: 0, shopifyPct: 100 },
  { sku: "704-CMB-4", name: "Combo PBB", available: 9, projVelocity: 8, status: "CRITICAL", q2Need: 97, gap: 88, supplierCost: 529.00, supplierId: "fx-industries", amazonPct: 0, shopifyPct: 100 },
  { sku: "1003-REP-M1", name: "Connecting Bar", available: 5, projVelocity: 2, status: "REORDER", q2Need: 19, gap: 14, supplierCost: 6.00, supplierId: "liston", amazonPct: 30, shopifyPct: 70 },
  { sku: "701-CMB-1", name: "Combo 1.0", available: 10, projVelocity: 2, status: "ORDER_SOON", q2Need: 26, gap: 16, supplierCost: 103.00, supplierId: "fx-industries", amazonPct: 0, shopifyPct: 100 },
  { sku: "703-CMB-3", name: "Combo PBO", available: 10, projVelocity: 2, status: "ORDER_SOON", q2Need: 26, gap: 16, supplierCost: 475.00, supplierId: "fx-industries", amazonPct: 0, shopifyPct: 100 },
  { sku: "304-REP-M2", name: 'Screen 18" (Push 2.0)', available: 374, projVelocity: 30, status: "OK", q2Need: 390, gap: 16, supplierCost: 3.50, supplierId: "silver-fox", amazonPct: 10, shopifyPct: 90 },
  { sku: "302-REP-M1", name: 'Screen 12" (Push 1.0)', available: 151, projVelocity: 14, status: "OK", q2Need: 175, gap: 24, supplierCost: 2.00, supplierId: "silver-fox", amazonPct: 10, shopifyPct: 90 },
  { sku: "SBR-PBIndustrial", name: "Pull Behind Original", available: 82, projVelocity: 8, status: "OK", q2Need: 97, gap: 15, supplierCost: 475.00, supplierId: "fx-industries", amazonPct: 80, shopifyPct: 20 },
  { sku: "1200-PBM2", name: "Pull Behind Bigfoot", available: 81, projVelocity: 3, status: "OK", q2Need: 39, gap: -42, supplierCost: 525.00, supplierId: "fx-industries", amazonPct: 100, shopifyPct: 0 },
];

// ─── DERIVED ────────────────────────────────────────────────────────────────────
function getStockoutDate(item: InventoryItem): Date {
  const weeksLeft = item.available / item.projVelocity;
  return addDays(TODAY, weeksLeft * 7);
}

function getLeadTime(item: InventoryItem): number {
  const sup = SUPPLIERS.find(s => s.id === item.supplierId);
  return sup ? sup.leadTimeDays : 14;
}

function getReorderPoint(item: InventoryItem): number {
  const lt = getLeadTime(item);
  const daily = item.projVelocity / 7;
  return Math.ceil((daily * lt) + item.projVelocity);
}

function getPOValue(item: InventoryItem): number {
  return item.gap > 0 ? item.gap * item.supplierCost : 0;
}

function urgencyColor(status: string): string {
  if (status === "CRITICAL") return "#e73939";
  if (status === "REORDER") return "#ff8c00";
  if (status === "ORDER_SOON") return "#ffd600";
  return "#2dc653";
}

const fmt = (n: number): string => n >= 1000 ? `$${(n/1000).toFixed(0)}K` : `$${n.toFixed(0)}`;

// ─── CSS ────────────────────────────────────────────────────────────────────────
const css = `
@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@600;700;800&display=swap');

.si-root { font-family: 'Syne', sans-serif; background: #080b0f; color: #c8d0dc; min-height: 100vh; }
.si-inner { max-width: 480px; margin: 0 auto; }

/* HEADER */
.si-hdr { padding: 20px 16px 0; position: relative; }
.si-hdr-accent { width: 32px; height: 3px; background: #e85d04; border-radius: 2px; margin-bottom: 8px; }
.si-hdr-title { font-size: 26px; font-weight: 800; color: #fff; letter-spacing: -0.5px; line-height: 1; }
.si-hdr-sub { font-family: 'DM Mono', monospace; font-size: 10px; color: #3d4f62; margin-top: 4px; letter-spacing: 0.5px; }

/* ALERT STRIP */
.si-alert-strip { margin: 14px 16px 0; background: rgba(231,57,57,0.08); border: 1px solid rgba(231,57,57,0.25); border-left: 3px solid #e73939; border-radius: 4px; padding: 10px 12px; display: flex; align-items: flex-start; gap: 10px; }
.si-alert-dot { width: 7px; height: 7px; border-radius: 50%; background: #e73939; margin-top: 3px; flex-shrink: 0; animation: si-blink 1.4s ease-in-out infinite; }
@keyframes si-blink { 0%,100% { opacity:1; } 50% { opacity:0.2; } }
.si-alert-msg { font-family: 'DM Mono', monospace; font-size: 10px; color: #ff7070; line-height: 1.5; }
.si-alert-msg strong { color: #ff3a3a; }

/* TABS */
.si-tabs { display: flex; padding: 0 16px; margin-top: 16px; gap: 0; border-bottom: 1px solid #111820; overflow-x: auto; }
.si-tab { padding: 8px 14px; font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #2e3d4e; cursor: pointer; border: none; background: none; border-bottom: 2px solid transparent; font-family: 'Syne', sans-serif; white-space: nowrap; transition: color 0.15s; }
.si-tab:hover { color: #6a7e92; }
.si-tab.si-on { color: #e85d04; border-bottom-color: #e85d04; }

/* SCROLL BODY */
.si-body { padding: 14px 16px 60px; overflow-y: auto; }

/* SECTION HEADER */
.si-sec-hdr { font-family: 'DM Mono', monospace; font-size: 9px; letter-spacing: 2.5px; color: #2e3d4e; text-transform: uppercase; margin: 18px 0 8px; }
.si-sec-hdr:first-child { margin-top: 4px; }

/* ── TODAY CARDS ─────── */
.si-po-card { background: #0d1219; border: 1px solid #151e2a; border-radius: 8px; padding: 14px; margin-bottom: 8px; position: relative; overflow: hidden; }
.si-po-card::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; }
.si-po-card.si-critical::before { background: #e73939; }
.si-po-card.si-reorder::before { background: #ff8c00; }
.si-po-card.si-soon::before { background: #ffd600; }

.si-po-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; }
.si-po-name { font-size: 17px; font-weight: 700; color: #fff; line-height: 1.1; }
.si-po-badge { font-family: 'DM Mono', monospace; font-size: 9px; padding: 3px 7px; border-radius: 3px; letter-spacing: 0.5px; font-weight: 500; flex-shrink: 0; margin-left: 8px; }

.si-po-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 10px; }
.si-po-box { background: rgba(0,0,0,0.3); border-radius: 5px; padding: 8px 10px; }
.si-po-val { font-family: 'DM Mono', monospace; font-size: 16px; font-weight: 500; color: #fff; line-height: 1; }
.si-po-val.si-warn { color: #ff8c00; }
.si-po-val.si-danger { color: #e73939; }
.si-po-val.si-money { color: #ffd60a; }
.si-po-lbl { font-size: 10px; color: #3d4f62; margin-top: 3px; text-transform: uppercase; letter-spacing: 0.5px; }

.si-po-action { background: rgba(232,93,4,0.08); border: 1px solid rgba(232,93,4,0.2); border-radius: 5px; padding: 8px 10px; font-family: 'DM Mono', monospace; font-size: 10px; color: #e85d04; line-height: 1.5; }
.si-po-action strong { color: #ffa040; }

/* TOTAL PO BANNER */
.si-total-banner { background: linear-gradient(135deg, #1a1000, #100a00); border: 1px solid rgba(255,214,10,0.2); border-radius: 8px; padding: 14px; margin-bottom: 4px; display: flex; align-items: center; justify-content: space-between; }
.si-total-label { font-size: 13px; color: #7a8a9e; font-weight: 700; }
.si-total-label span { display: block; font-size: 10px; color: #3d4f62; font-weight: 400; margin-top: 2px; font-family: 'DM Mono', monospace; }
.si-total-val { font-family: 'DM Mono', monospace; font-size: 28px; font-weight: 500; color: #ffd60a; }

/* ── INVENTORY CARDS ─── */
.si-inv-card { background: #0d1219; border: 1px solid #151e2a; border-radius: 8px; padding: 14px; margin-bottom: 8px; position: relative; overflow: hidden; }

.si-inv-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; }
.si-inv-name { font-size: 16px; font-weight: 700; color: #fff; flex: 1; }
.si-inv-sku { font-family: 'DM Mono', monospace; font-size: 9px; color: #2e3d4e; margin-top: 2px; }
.si-inv-status { font-family: 'DM Mono', monospace; font-size: 8px; padding: 3px 7px; border-radius: 3px; letter-spacing: 0.5px; flex-shrink: 0; margin-left: 8px; }

.si-inv-2col { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 8px; }
.si-inv-box { background: rgba(0,0,0,0.3); border-radius: 5px; padding: 8px 10px; }
.si-inv-val { font-family: 'DM Mono', monospace; font-size: 15px; font-weight: 500; color: #fff; line-height: 1.1; }
.si-inv-lbl { font-size: 9px; color: #3d4f62; margin-top: 3px; text-transform: uppercase; letter-spacing: 0.5px; }

.si-channel-row { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.si-ch-lbl { font-family: 'DM Mono', monospace; font-size: 9px; color: #2e3d4e; width: 28px; }
.si-ch-track { flex: 1; height: 4px; background: #0f1820; border-radius: 2px; overflow: hidden; }
.si-ch-fill { height: 100%; border-radius: 2px; }
.si-ch-pct { font-family: 'DM Mono', monospace; font-size: 9px; color: #4d6070; width: 26px; text-align: right; }

/* ── SUPPLIER CARDS ──── */
.si-sup-card { background: #0d1219; border: 1px solid #151e2a; border-radius: 8px; margin-bottom: 8px; overflow: hidden; }
.si-sup-head { padding: 12px 14px; display: flex; align-items: center; gap: 10px; cursor: pointer; }
.si-sup-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.si-sup-info { flex: 1; }
.si-sup-name { font-size: 16px; font-weight: 700; color: #fff; }
.si-sup-type { font-size: 11px; color: #4d6070; margin-top: 1px; }
.si-sup-right { text-align: right; }
.si-sup-lead { font-family: 'DM Mono', monospace; font-size: 12px; font-weight: 500; }
.si-sup-lead-lbl { font-size: 9px; color: #2e3d4e; margin-top: 2px; }
.si-sup-alert-pill { display: inline-block; background: rgba(231,57,57,0.12); border: 1px solid rgba(231,57,57,0.3); color: #e73939; font-family: 'DM Mono', monospace; font-size: 8px; padding: 2px 6px; border-radius: 3px; margin-top: 3px; }

.si-sup-body { border-top: 1px solid #111820; padding: 0 14px 12px; }
.si-sup-note { font-size: 11px; color: #5a7080; line-height: 1.5; padding: 10px 0 8px; border-bottom: 1px solid #0f1820; font-style: italic; }
.si-sup-item { display: flex; justify-content: space-between; align-items: center; padding: 7px 0; border-bottom: 1px solid #0a1018; }
.si-sup-item:last-child { border: none; }
.si-sup-item-name { font-size: 13px; color: #c0ccd8; }
.si-sup-item-moq { font-family: 'DM Mono', monospace; font-size: 9px; color: #2e3d4e; margin-top: 2px; }
.si-sup-item-cost { font-family: 'DM Mono', monospace; font-size: 14px; font-weight: 500; color: #ffd60a; }

/* ── REORDER ENGINE ──── */
.si-formula-card { background: #080f18; border: 1px solid #111f2e; border-radius: 8px; padding: 14px; margin-bottom: 12px; }
.si-formula-title { font-size: 11px; font-weight: 700; color: #4d6070; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
.si-formula-eq { font-family: 'DM Mono', monospace; font-size: 11px; color: #4cc9f0; line-height: 2; }
.si-formula-plain { font-size: 12px; color: #7a8a9e; line-height: 1.5; margin-top: 8px; padding-top: 8px; border-top: 1px solid #111820; }

.si-rp-card { background: #0d1219; border: 1px solid #151e2a; border-radius: 8px; padding: 12px 14px; margin-bottom: 8px; }
.si-rp-name { font-size: 15px; font-weight: 700; color: #fff; margin-bottom: 8px; }
.si-rp-3col { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-bottom: 8px; }
.si-rp-box { background: rgba(0,0,0,0.3); border-radius: 5px; padding: 7px 8px; text-align: center; }
.si-rp-val { font-family: 'DM Mono', monospace; font-size: 14px; font-weight: 500; color: #4cc9f0; }
.si-rp-lbl { font-size: 8px; color: #2e3d4e; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 2px; }
.si-rp-plain { background: rgba(76,201,240,0.05); border: 1px solid rgba(76,201,240,0.1); border-radius: 5px; padding: 8px 10px; font-size: 11px; color: #7a8a9e; line-height: 1.5; }
.si-rp-plain strong { color: #4cc9f0; }
.si-rp-triggered { background: rgba(231,57,57,0.06); border: 1px solid rgba(231,57,57,0.15); }
.si-rp-triggered strong { color: #e73939; }

.si-divider { height: 1px; background: #0f1820; margin: 14px 0; }
`;

// ─── TODAY CARD ──────────────────────────────────────────────────────────────────
function TodayCard({ item }: { item: InventoryItem }) {
  const stockoutDate = getStockoutDate(item);
  const days = daysFromNow(stockoutDate);
  const poVal = getPOValue(item);
  const sup = SUPPLIERS.find(s => s.id === item.supplierId);
  const urgColor = urgencyColor(item.status);
  const cardClass = item.status === "CRITICAL" ? "si-critical" : item.status === "REORDER" ? "si-reorder" : "si-soon";

  const actionText: Record<string, string> = {
    CRITICAL: `Place PO with ${sup?.name} for ${item.gap.toLocaleString()} units immediately. ${sup?.leadTimeDays}-day lead means delivery around ${formatDate(addDays(TODAY, sup?.leadTimeDays || 14))}.`,
    REORDER: `Stock hits reorder point in ~${Math.round(days/2)} days. Contact ${sup?.name} this week — ${sup?.leadTimeDays}-day lead.`,
    ORDER_SOON: `You have ~${days} days. Plan PO with ${sup?.name} by end of month.`,
  };

  return (
    <div className={`si-po-card ${cardClass}`}>
      <div className="si-po-top">
        <div className="si-po-name">{item.name}</div>
        <div className="si-po-badge" style={{ background: `${urgColor}18`, color: urgColor, border: `1px solid ${urgColor}30` }}>
          {item.status === "CRITICAL" ? "URGENT" : item.status === "REORDER" ? "REORDER" : "SOON"}
        </div>
      </div>
      <div className="si-po-grid">
        <div className="si-po-box">
          <div className={`si-po-val ${days <= 7 ? "si-danger" : days <= 21 ? "si-warn" : ""}`}>
            {formatDate(stockoutDate)}
          </div>
          <div className="si-po-lbl">Runs Out</div>
        </div>
        <div className="si-po-box">
          <div className="si-po-val si-money">{fmt(poVal)}</div>
          <div className="si-po-lbl">Est. PO Value</div>
        </div>
        <div className="si-po-box">
          <div className="si-po-val" style={{ color: "#c8d0dc" }}>{item.available}</div>
          <div className="si-po-lbl">On Hand</div>
        </div>
        <div className="si-po-box">
          <div className="si-po-val" style={{ color: "#c8d0dc" }}>{item.gap.toLocaleString()}</div>
          <div className="si-po-lbl">Units Needed</div>
        </div>
      </div>
      <div className="si-po-action">
        <strong>ACTION:</strong> {actionText[item.status]}
      </div>
    </div>
  );
}

// ─── INVENTORY CARD ─────────────────────────────────────────────────────────────
function InvCard({ item }: { item: InventoryItem }) {
  const urgColor = urgencyColor(item.status);
  const stockoutDate = getStockoutDate(item);
  const days = daysFromNow(stockoutDate);
  const isBad = ["CRITICAL","REORDER"].includes(item.status);

  return (
    <div className="si-inv-card" style={{ borderColor: isBad ? `${urgColor}20` : "#151e2a" }}>
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: urgColor }} />
      <div className="si-inv-top" style={{ paddingLeft: 8 }}>
        <div>
          <div className="si-inv-name">{item.name}</div>
          <div className="si-inv-sku">{item.sku}</div>
        </div>
        <div className="si-inv-status" style={{ background: `${urgColor}15`, color: urgColor, border: `1px solid ${urgColor}25` }}>
          {item.status.replace("_"," ")}
        </div>
      </div>
      <div className="si-inv-2col" style={{ paddingLeft: 8 }}>
        <div className="si-inv-box">
          <div className="si-inv-val" style={{ color: isBad ? urgColor : "#fff" }}>
            {item.available} units
          </div>
          <div className="si-inv-lbl">On Hand</div>
        </div>
        <div className="si-inv-box">
          <div className="si-inv-val" style={{ color: days <= 14 ? "#e73939" : days <= 30 ? "#ff8c00" : "#fff" }}>
            {formatDate(stockoutDate)}
          </div>
          <div className="si-inv-lbl">Runs Out</div>
        </div>
      </div>
      <div style={{ paddingLeft: 8 }}>
        <div className="si-channel-row">
          <span className="si-ch-lbl">AMZ</span>
          <div className="si-ch-track"><div className="si-ch-fill" style={{ width: `${item.amazonPct}%`, background: "#ff9900" }} /></div>
          <span className="si-ch-pct">{item.amazonPct}%</span>
        </div>
        <div className="si-channel-row">
          <span className="si-ch-lbl">SHO</span>
          <div className="si-ch-track"><div className="si-ch-fill" style={{ width: `${item.shopifyPct}%`, background: "#96bf48" }} /></div>
          <span className="si-ch-pct">{item.shopifyPct}%</span>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN COMPONENT ─────────────────────────────────────────────────────────────
export default function SupplierIntel() {
  const [tab, setTab] = useState("today");
  const [openSup, setOpenSup] = useState<string | null>(null);

  const criticals = INVENTORY.filter(i => i.status === "CRITICAL");
  const actionItems = INVENTORY.filter(i => (["CRITICAL","REORDER","ORDER_SOON"] as string[]).includes(i.status));
  const totalPO = actionItems.reduce((sum, i) => sum + getPOValue(i), 0);

  const hotSuppliers = new Set(criticals.map(i => i.supplierId));

  const earliestStockout = criticals
    .map(i => getStockoutDate(i))
    .sort((a,b) => a.getTime() - b.getTime())[0];

  return (
    <>
      <style>{css}</style>
      <div className="si-root">
        <div className="si-inner">

          {/* HEADER */}
          <div className="si-hdr">
            <div className="si-hdr-accent" />
            <div className="si-hdr-title">SBR Operations</div>
            <div className="si-hdr-sub">INVENTORY INTELLIGENCE · {formatDate(TODAY).toUpperCase()}</div>
          </div>

          {/* ALERT */}
          {criticals.length > 0 && earliestStockout && (
            <div className="si-alert-strip">
              <div className="si-alert-dot" />
              <div className="si-alert-msg">
                <strong>{criticals.length} products run out before {formatDate(addDays(TODAY, 14))}.</strong>
                {" "}First stockout: Push 1.0 on <strong>{formatDate(earliestStockout)}</strong>.
                A PO to FX Industries is already overdue.
              </div>
            </div>
          )}

          {/* TABS */}
          <div className="si-tabs">
            {[
              { id: "today", label: "Today" },
              { id: "inventory", label: "All Stock" },
              { id: "suppliers", label: "Suppliers" },
              { id: "reorder", label: "Reorder Rules" },
            ].map(t => (
              <button key={t.id} className={`si-tab ${tab === t.id ? "si-on" : ""}`} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>

          <div className="si-body">

            {/* ── TODAY TAB ── */}
            {tab === "today" && (
              <>
                <div className="si-total-banner">
                  <div className="si-total-label">
                    Estimated POs Needed
                    <span>90-day coverage · {actionItems.length} items</span>
                  </div>
                  <div className="si-total-val">
                    ${(totalPO / 1000).toFixed(0)}K
                  </div>
                </div>

                <div className="si-sec-hdr">Act Today — Stockout Imminent</div>
                {criticals.map(item => <TodayCard key={item.sku} item={item} />)}

                <div className="si-divider" />
                <div className="si-sec-hdr">Order This Week</div>
                {INVENTORY.filter(i => i.status === "REORDER" || i.status === "ORDER_SOON")
                  .map(item => <TodayCard key={item.sku} item={item} />)}
              </>
            )}

            {/* ── INVENTORY TAB ── */}
            {tab === "inventory" && (
              <>
                {(["CRITICAL","REORDER","ORDER_SOON","OK"] as const).map(s => {
                  const group = INVENTORY.filter(i => i.status === s);
                  if (!group.length) return null;
                  const labels: Record<string, string> = { CRITICAL: "Critical", REORDER: "Reorder Now", ORDER_SOON: "Order Soon", OK: "OK" };
                  return (
                    <div key={s}>
                      <div className="si-sec-hdr">{labels[s]}</div>
                      {group.map(item => <InvCard key={item.sku} item={item} />)}
                      {s !== "OK" && <div className="si-divider" />}
                    </div>
                  );
                })}
              </>
            )}

            {/* ── SUPPLIERS TAB ── */}
            {tab === "suppliers" && (
              <>
                <div className="si-sec-hdr">
                  {[...hotSuppliers].length} suppliers have critical items waiting
                </div>
                {SUPPLIERS.map(sup => {
                  const isOpen = openSup === sup.id;
                  const isHot = hotSuppliers.has(sup.id);
                  const critCount = criticals.filter(i => i.supplierId === sup.id).length;
                  const leadColor = sup.leadTimeDays <= 7 ? "#2dc653" : sup.leadTimeDays <= 14 ? "#ffd600" : "#e73939";
                  return (
                    <div key={sup.id} className="si-sup-card" style={isHot ? { borderColor: "rgba(231,57,57,0.3)" } : {}}>
                      <div className="si-sup-head" onClick={() => setOpenSup(isOpen ? null : sup.id)}>
                        <div className="si-sup-dot" style={{ background: sup.color }} />
                        <div className="si-sup-info">
                          <div className="si-sup-name">{sup.name}</div>
                          <div className="si-sup-type">{sup.type}</div>
                          {isHot && (
                            <div className="si-sup-alert-pill">
                              {critCount} CRITICAL ITEM{critCount > 1 ? "S" : ""} WAITING
                            </div>
                          )}
                        </div>
                        <div className="si-sup-right">
                          <div className="si-sup-lead" style={{ color: leadColor }}>{sup.leadTimeDays}d</div>
                          <div className="si-sup-lead-lbl">lead time</div>
                          <div style={{ fontSize: 10, color: "#2e3d4e", marginTop: 6 }}>{isOpen ? "\u25B2" : "\u25BC"}</div>
                        </div>
                      </div>
                      {isOpen && (
                        <div className="si-sup-body">
                          <div className="si-sup-note">&ldquo;{sup.notes}&rdquo;</div>
                          {sup.items.map(it => (
                            <div key={it.sku} className="si-sup-item">
                              <div>
                                <div className="si-sup-item-name">{it.desc}</div>
                                <div className="si-sup-item-moq">MOQ: {it.moq} units</div>
                              </div>
                              <div className="si-sup-item-cost">${it.unitCost.toFixed(2)}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}

            {/* ── REORDER ENGINE ── */}
            {tab === "reorder" && (
              <>
                <div className="si-formula-card">
                  <div className="si-formula-title">How Reorder Points Work</div>
                  <div className="si-formula-eq">
                    Reorder Point = (Daily Sales x Lead Time) + Safety Stock
                  </div>
                  <div className="si-formula-plain">
                    When your inventory drops to the Reorder Point, you have just enough time to place a PO and get stock before you run out &mdash; with one week of buffer built in. If stock is already below this number, you're behind.
                  </div>
                </div>

                <div className="si-sec-hdr">Every SKU &middot; Plain English</div>
                {INVENTORY.map(item => {
                  const rp = getReorderPoint(item);
                  const lt = getLeadTime(item);
                  const daily = (item.projVelocity / 7).toFixed(1);
                  const triggered = item.available < rp;
                  return (
                    <div key={item.sku} className="si-rp-card">
                      <div className="si-rp-name">{item.name}</div>
                      <div className="si-rp-3col">
                        <div className="si-rp-box">
                          <div className="si-rp-val" style={{ color: triggered ? "#e73939" : "#c8d0dc" }}>{item.available}</div>
                          <div className="si-rp-lbl">On Hand</div>
                        </div>
                        <div className="si-rp-box">
                          <div className="si-rp-val" style={{ color: triggered ? "#e73939" : "#4cc9f0" }}>{rp}</div>
                          <div className="si-rp-lbl">Order At</div>
                        </div>
                        <div className="si-rp-box">
                          <div className="si-rp-val">{lt}d</div>
                          <div className="si-rp-lbl">Lead Time</div>
                        </div>
                      </div>
                      <div className={`si-rp-plain ${triggered ? "si-rp-triggered" : ""}`}>
                        {triggered
                          ? <><strong>Order now.</strong> You're {rp - item.available} units below the trigger. At {daily} units/day you needed to order {lt} days ago.</>
                          : <>You have {item.available - rp} units of buffer. <strong>Order when stock hits {rp}.</strong> That gives {lt} days for delivery plus a 1-week cushion.</>
                        }
                      </div>
                    </div>
                  );
                })}
              </>
            )}

          </div>
        </div>
      </div>
    </>
  );
}
