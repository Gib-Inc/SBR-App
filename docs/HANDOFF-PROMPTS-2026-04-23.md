# Hand-Off Prompts — B-003 through B-006
Drafted 2026-04-23 · For Matt to paste into a Claude Code session pointed at this repo

Each section below is a self-contained prompt. Pick a fix, copy the corresponding block, paste into a fresh Claude Code session in `~/Desktop/SBR_Documents/SBR-App`. Execution order per `FIX-PLANS-2026-04-23.md`: B-004 → B-006 → B-003 → B-005.

---

## Prompt for B-004 — Raw Materials Daily Use Fix

```
You are working in ~/Desktop/SBR_Documents/SBR-App (the prod SBR app, Node/Drizzle/Supabase).

Goal: make the Raw Materials dashboard (/raw-materials, server route at server/routes.ts:21486) show real dailyUsage and on-hand numbers. See docs/FIX-PLANS-2026-04-23.md for full context.

Confirmed facts (do not re-verify):
- server/storage.ts:6124 — the Drizzle SupabaseStorage getSkuSalesVelocity already queries sales_order_lines JOIN sales_orders with a 90-day cutoff. The velocity calc is healthy.
- items.daily_usage is zero for all 66 rows. Treat it as derived-only; the dashboard computes it at request time, which is correct. Do not start writing to this column.
- items.current_stock is zero for 43 of 66 rows. This is the real gap.

Tasks, in order:

1. Audit items.type tagging. Run:
     SELECT type, count(*) FROM items GROUP BY type ORDER BY count(*) DESC;
   The dashboard filters type='component' and type='finished_product'. Confirm the 34 distinct material_skus from bom_items are all tagged type='component' on the items table. If any are not, write a one-time UPDATE that tags them, and log the before/after counts.

2. Wire Extensiv sync to populate items.current_stock for finished goods. Read extensiv-sync.js. If it currently writes extensiv_on_hand_snapshot but not current_stock, add a line that sets current_stock = COALESCE(extensiv_on_hand_snapshot, 0) + COALESCE(hildale_qty, 0) for type='finished_product'. Do not touch current_stock for type='component' — that stays Sammie's manual entry.

3. Generate a fill-in worksheet for Sammie. Run:
     SELECT sku, name, category FROM items WHERE type='component' AND (current_stock IS NULL OR current_stock = 0) ORDER BY category, name;
   Save the result as docs/sammie-raw-material-count-2026-04-23.csv. This is her to-do list; she updates via the Pencil icon on /raw-materials.

4. Manually test. Run the dev server, open /raw-materials, and confirm:
   - The component count is ≥ 34
   - Every component with a populated current_stock shows non-zero dailyUsage (assuming its product has sold in the last 90 days)
   - Critical and Needs Order badges populate sensibly

Do NOT:
- Write to items.daily_usage
- Modify server/routes.ts:21486 unless a bug is identified
- Touch the Amazon worktree at .claude/worktrees/
- Push any commits

Report: what you changed, what you found during the audit, screenshot of /raw-materials before and after the Extensiv sync wiring.
```

---

## Prompt for B-006 — Reports Widget Seed

```
You are working in ~/Desktop/SBR_Documents/SBR-App.

Prerequisite: B-004 must be complete (items.current_stock populated, dailyUsage computing for components). Do not start this until /raw-materials shows real numbers.

Goal: make the Reports page (/reports) show populated KPIs and a seeded set of default widgets. See docs/FIX-PLANS-2026-04-23.md for context.

Tasks:

1. Verify the System Overview KPIs now populate. Open /reports. Confirm Low Stock and Critical Stock show non-zero values consistent with /raw-materials. If they do not, read the /api/system/stats handler in server/routes.ts and fix its data source; log findings before changing anything.

2. Seed 4 default widgets tied to the single row in custom_dashboards. Write a one-shot seed file at server/seed-default-widgets.ts that inserts these widgets (idempotent — skip if already present by title):

   a. KPI_CARD "Days of Supply (worst component)" — data source COMPONENT_CONSUMPTION, metric min, field days_of_supply
   b. KPI_CARD "Stockout Risk Count" — COMPONENT_CONSUMPTION, metric count, filter days_of_supply < 7
   c. LINE_CHART "Sales Velocity (30d)" — SALES_ORDERS, group by week
   d. TABLE "Top 10 Reorder Candidates" — COMPONENT_CONSUMPTION, sort days_of_supply asc, limit 10

3. Run the seed file once (add a `npm run seed:widgets` script). Confirm the widgets render on /reports.

Do NOT:
- Modify the widget framework itself (sortable drag logic, AddWidgetDialog)
- Create new widget types beyond what DATA_SOURCES already exposes
- Push any commits

Report: the 4 widgets rendering, plus screenshots of /reports before and after.
```

---

## Prompt for B-003 — In-House Shipping Delay Notification

```
You are working in ~/Desktop/SBR_Documents/SBR-App.

Goal: add a "Send Delay Notice" batch action to /in-house-shipping that emails customers whose orders are >3 days old. The UI (client/src/pages/in-house-shipping.tsx) already has batch selection and Sendgrid is already a dependency. See docs/FIX-PLANS-2026-04-23.md.

Tasks:

1. Schema migration. Add column to sales_orders:
     last_delay_notification_at timestamp
   Update shared/schema.ts with the Drizzle column, then run drizzle-kit push.

2. New service at server/services/delay-notification.ts. Export:
     async function sendDelayNotifications(orderIds: string[]): Promise<{
       sent: number;
       failed: number;
       skippedNoEmail: number;
       skippedRecentlyNotified: number;
       errors: Array<{ orderId: string; reason: string }>;
     }>
   Logic per order:
   - Fetch the sales_order row
   - Skip with reason 'no_email' if customer_email is null
   - Skip with reason 'recently_notified' if last_delay_notification_at is within 72 hours
   - Render the template below, send via the existing Sendgrid client, log to system_logs with type 'delay_notification_sent' / 'delay_notification_failed'
   - On success, UPDATE sales_orders SET last_delay_notification_at = now()
   - Rate-limit: 10 sends/sec

3. Email template. Plain text (no HTML). Subject and body exactly as follows — voice rules are strict, do not soften the tone.

   Subject: Quick update on your order

   Body:
   Hi {{customer_name}},

   This is Stacy. Your order {{order_id}} has been with us for {{days_old}} days and I owe you a faster update than we've given.

   Here's where things stand: we're packing it this week from our Hildale shop. You will get tracking the minute it hands off to the carrier.

   I hate making you wait. Thanks for sticking with us while we get this right.

   Go win your ground war.

   Stacy

   Rules baked into that copy: no em dashes, zero exclamations (under the 1-max rule), "Go win your ground war" present, no discount code (this is ops comms, not a marketing sequence — NO ROLLY10 here), first-person Stacy. Do not add a CTA, do not add marketing copy. If the template needs to grow, ask before editing.

4. New route at server/routes.ts. Add:
     POST /api/sales-orders/in-house/send-delay-notifications
   Requires auth (requireAuth). Body: { orderIds: string[] }. Calls the service, returns the result object. No error swallowing.

5. UI changes to client/src/pages/in-house-shipping.tsx:
   - Add a new mutation sendDelayMutation alongside the existing dismissMutation
   - In the batch-action bar (around line 454-496), add a button visible only when at least one selected order has age > 3 days. Label: "Send Delay Notice ({count})". Secondary button style, mail icon.
   - Confirmation dialog that lists each customer name, order id, and age, and a line stating: "No inventory changes. One email per customer. Orders notified within the last 72 hours will be skipped."
   - On success, toast with sent/skipped counts
   - Add a small "Notified {daysAgo}" badge on any order card where last_delay_notification_at is set

6. Confirm Sendgrid sender identity with Matt before first send. Do not send a single real email until he confirms the FROM address.

Do NOT:
- Auto-run the send against the 137 current stuck orders. The send must be triggered by Sammie clicking the button, never automatic.
- Modify the Stacy email copy
- Add any discount code
- Push any commits

Report: migration applied, screenshot of the new button in the batch bar, Sendgrid FROM address confirmed by Matt, dry-run test against 1 order (Matt's own email).
```

---

## Prompt for B-005 — Amazon SKU Manual Entry

```
You are working in ~/Desktop/SBR_Documents/SBR-App.

Context: items.amazon_sku column exists and is NULL for all 66 rows. The worktree at .claude/worktrees/gifted-chandrasekhar/ contains an Amazon PUSH inventory service that depends on amazon_sku being populated. That worktree is out of scope for B-005 — we are solving the inbound SKU mapping only. See docs/FIX-PLANS-2026-04-23.md.

Goal: give Sammie a way to enter Amazon SKUs from Seller Central directly on the Products page. Defer the SP-API auto-pull to a future work order.

Tasks:

1. Read client/src/pages/products.tsx. Find the table column layout.

2. Add an "Amazon SKU" column with the same Pencil-edit affordance used in client/src/pages/raw-materials.tsx (lines 233-272 have the edit-in-place pattern — copy it). On Enter, PATCH /api/items/:id with { amazonSku: value }.

3. Verify the server PATCH route accepts amazonSku as a writeable field. If storage.updateItem or the route allowlist strips unknown fields, add amazonSku to the allowlist. Do not widen the allowlist beyond that single field.

4. Generate a worksheet for Sammie. Run:
     SELECT sku, name, upc FROM items WHERE type='finished_product' AND amazon_sku IS NULL ORDER BY name;
   Save as docs/sammie-amazon-sku-entry-2026-04-23.csv.

5. Manually test. In /products, click the Pencil on one row, enter a test SKU, confirm it persists (refetch) and the row shows the new value.

Do NOT:
- Touch the Amazon worktree
- Call SP-API anywhere
- Expose amazon_sku as a writeable field on any route other than the single-item PATCH
- Push any commits

Report: screenshot of the new column with one row populated, CSV written for Sammie, confirmation that the server PATCH persists the field.
```

---

## After all four are complete

File a follow-up work order for "SP-API Amazon SKU auto-pull" targeting Phase 2 or Phase 3 of the rebuild. That work belongs with a fresh SKU-sync service, not as an extension of the existing push worktree.
