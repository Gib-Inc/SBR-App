# SBR App — Pre-Handoff Operational Audit

**Audit date:** 2026-06-09 (evening) · **Auditor:** automated full-surface audit (gates, endpoints, pages, schedulers, integrations, data validation)
**Production:** https://sbr-app-production-f1c4.up.railway.app · auto-deploys from `main` (origin Gib-Inc/SBR-App + prod saasbooster-sys/SBR-App)

## Verdict

**Operational for handoff.** All runtime gates pass, every page renders clean,
every audited endpoint answers, all integrations are live, and the automation
fleet is running. The known gaps are catalogued below with severity and
ownership — none block daily operations; the most visible one (`npm run check`)
is pre-existing type drift in three legacy files and does not affect the
deployed app (the production pipeline compiles via esbuild and is green).

## 1. Gates (what CI/a reviewer will run)

| Gate | Command | Result |
|---|---|---|
| Test suite | `npm test` | ✅ **267/267 passing** (26 files) |
| Production build | `npm run build` | ✅ clean (vite 3,724 modules + esbuild server bundle) |
| Type check | `npm run check` (tsc) | ⚠️ **344 pre-existing errors** — see §5.1 |

## 2. Runtime surface (live production, authenticated)

- **Pages:** all 27 app routes crawled — **zero console errors/exceptions** on
  every page (Reports, Finances, Inventory, Sales Orders, Backorders,
  In-House Shipping, Returns, Production Priority, Products, Raw Materials,
  Count Inventory, Production, Receive Stock, Incoming, Purchase Orders,
  Suppliers, Supplier Intel, Reorder Alerts, Barcodes, Log Order, SKU
  Mappings, Marketing, Ad Analytics, Financial Upload, AI Agent, App Flow,
  FinOps, Health, Settings).
- **Endpoints:** 26 representative API endpoints smoke-tested through the
  authenticated session — all return JSON 200 (items, inventory snapshot,
  sales velocity, sales orders, POs, suppliers, supplier items, returns,
  reorder alerts, SKU mappings, barcodes, system integrity + drift ledger,
  inventory valuation, forecast accuracy, marketing analysis + campaign
  performance, supplier intel, windsor status, trap-check, campaigns,
  pipeline, reconciliation status, vendor communications, auth, settings).

## 3. Automation fleet (12 schedulers, Health-monitored at /health)

| Scheduler | Cadence | Status |
|---|---|---|
| Extensiv in-process sync fallback | Hourly | ✅ healthy |
| QuickBooks token refresh | 45 min | ✅ healthy (token rotated tonight) |
| Daily briefing | 7:00 AM MT | ✅ healthy |
| AI inventory batch | 10 AM + 3 PM MT | ✅ healthy |
| Credential rotation reminders | 6:00 AM MT | ✅ healthy |
| Shopify reconciliation | Tue/Thu 9 AM MT | ✅ healthy |
| Daily sales aggregation | 11:59 PM MT | ✅ healthy |
| Auto reorder watcher | Hourly | ✅ healthy |
| Supplier intel snapshot | 6:00 AM MT | ✅ healthy |
| Marketing analytics directive | 6:30 AM MT | 🕐 new — first scheduled fire tonight; manual runs now record to Health |
| System integrity sweep | Every 6h | 🕐 new — sweeping (currently reporting real DRIFT findings, by design) |
| Forecast self-tuning | 12:15 AM MT | 🕐 new — first prediction seeded; grading begins tonight |

## 4. Integrations (live state)

| Integration | State | Evidence |
|---|---|---|
| QuickBooks | ✅ Connected | `isConnected: true`, company "Inspired Tool Design LLC", token auto-refresh live |
| Shopify | ✅ Live | Webhooks + Tue/Thu reconciliation (121 orders last run) + nightly rollup |
| Extensiv 3PL | ✅ Live | Hourly sync; pivot quantities matched physical 3PL count in the 06/05 audit |
| Windsor (ad spend) | ✅ Live | Daily sync; Google validated 3-way (Windsor API = app = analyst's sheet, to the cent); Amazon 4-table fix verified ($4,165/30d) |
| Anthropic (all AI) | ✅ Live | Briefing generates; central env-fallback key |
| SendGrid (PO email) | ✅ Sending | ⚠ deliverability caveat — see §5.4 |
| GHL | ✅ Wired | Sales/stock-risk/PO sync triggers event-driven |
| Meta ads data | ⚠ Manual | Not connected in Windsor — see §5.3 |

## 5. Known gaps — severity, impact, ownership

### 5.1 `npm run check` (tsc) — 344 pre-existing errors · MEDIUM (cosmetic at runtime)
84% concentrated in 3 legacy files: `server/routes.ts` (192), `server/storage.ts`
(51 — MemStorage/interface drift), `client/src/pages/ai.tsx` (46). Mostly
null-vs-undefined assignability drift accumulated before this engagement.
**Runtime impact: none** — production compiles via esbuild (type-stripping) and
the 267-test suite covers the financial/inventory math. The FinOps-engine files
added in this engagement are tsc-clean (the single error found in audit was
fixed). *Recommendation for reviewers: treat as a tech-debt cleanup ticket
(est. 1–2 days), not an operational defect.*

### 5.2 Inventory items unmapped in Extensiv · MEDIUM (visible, by design)
10 SKUs (4 combos, 4 refurbs, #1003, #1203) fail 3PL re-sync: **"SKU not found
in Extensiv customer 109"** — they are not in the 3PL catalog (combos/refurbs
are largely Hildale-only); two carry a polluted `extensiv_sku` with a literal
`"SKU: "` prefix. Long-standing data-entry debt (predates this engagement,
listed in CLAUDE.md known-issues), now surfaced with names on the FinOps page.
*Owner: ops (Sammie/Zo) — populate/clean `extensiv_sku` for SKUs that should sync.*

### 5.3 Meta not connected in Windsor · MEDIUM
Meta spend (~$12K/23d in the last export) enters only via manual CSV upload;
currently stale past May 19. One-time OAuth in the Windsor dashboard makes it
automatic. *Owner: Matt (requires account credentials).*

### 5.4 PO email sender domain · LOW
SendGrid sends and the accountant CC works; DKIM for stickerburrroller.com is
verified. Deliverability is strongest once `SENDGRID_FROM_EMAIL` is switched to
`purchasing@stickerburrroller.com` (Railway var). *Owner: Matt (5 min).*

### 5.5 Google website conversion tracking · MEDIUM (external to app)
Google's *website-side* conversion tag under-reports (live feed showed ~0x
attributed vs 9.55x blended). The app now sources campaign truth from Windsor
(Google's own attributed values), so app numbers are correct — but the site
tag should still be fixed for Google's bidding algorithms. *Owner: Bigfoot
(Google Ads agency).*

### 5.6 Five PROPOSED inventory corrections awaiting approval · LOW (one click each)
#302 (250→138), #304 (153→89), #1202 (396→291), #1004 (50→14), SBR-PB-ORIG
(53→22) — sellable counts overstate reality (oversell risk). Approve buttons
on the FinOps page apply them through the audited gateway. *Owner: Matt.*

### 5.7 Deferred engineering tickets (pre-existing, non-blocking) · LOW
From the earlier senior-dev review pass, still open by design: GHL sync cleanup
scope bug; `salesOrders.orderNumber→orderName` residual fallout;
`ai.tsx` prop-type drift (counted in §5.1); QuickBooks encryption-key fail-safe
hardening; `createInventoryTransaction` error isolation. None observed failing
in production during this audit. Also from CLAUDE.md: BOM entries to be
completed by Clarence; optional GHL connector in Settings.

## 6. Data-accuracy validations performed (this week)
- Physical inventory (06/05 counts) reconciled into the app; Pyvott matched
  Extensiv exactly; Hildale corrected (2,149 units of drift eliminated).
- Google ad spend validated three ways to the cent (Windsor API = app DB =
  analyst's manual tracker); Amazon spend leak (~24%) found and fixed.
- Inventory asset valuation live at WAC: ~$248K, zero uncosted stocked items.
- 267 unit tests lock all financial/costing/guardrail math.

## 7. Operating notes for the incoming team
- All schema changes apply automatically at boot (additive startup migrations).
- All inventory mutations must go through `InventoryMovement.apply()` (CLAUDE.md).
- The Health page (/health) is the single freshness cockpit; FinOps (/finops)
  is the integrity/valuation/forecast control room.
- Full engine documentation: `LAUNCH-READINESS.md`; architecture: `CLAUDE.md`.
