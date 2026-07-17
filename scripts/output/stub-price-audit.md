# Stub-Price Fabrication Audit (P1-4 item 1d)

**Read-only production audit — no writes. Run 2026-07-16 ~23:30 MT against prod DATABASE_URL (railway).**

## Question
The `askGrok` / `askCustom` provider stubs in `server/services/llm.ts` returned hardcoded
prices ($13.25 / $14.50) at medium confidence for `price_extraction` tasks, which the
inventory batch would have written into `items.default_purchase_cost` as `AUTO_SCRAPED`.
Did any fabricated price ever reach production data?

## Answer: NO — the vector never fired.

| Check | Query target | Result |
|---|---|---|
| 1. LLM provider setting | `settings.llm_provider` | **settings table has ZERO rows** — provider never configured, so the code default (anthropic/claude path) applied; the grok/custom stubs were never selected |
| 2. Auto-scraped costs | `items WHERE cost_source = 'AUTO_SCRAPED'` | **0 rows** — no item cost has ever come from the scrape path |
| 3. Stub-signature costs | `items WHERE default_purchase_cost IN (13.25, 14.50) OR wac_unit_cost IN (13.25, 14.50)` | **0 rows** |
| 4. PO lines at stub prices | `purchase_order_lines WHERE unit_cost IN (13.25, 14.50)` | **0 rows** |

## Disposition
No remediation of production data is required. The code fix (Item 1a: stubs now return
`{ price: null, confidence: 'none', status: 'no_data' }`) removes the vector; this audit
documents that it closes a door nothing ever walked through.

Method note: queries run via `railway run node -e` (read-only pg Pool with error handler);
settings column list verified via information_schema before querying (the table keys
`llm_provider`/`llm_api_key` exist as columns; the table simply has no rows).
