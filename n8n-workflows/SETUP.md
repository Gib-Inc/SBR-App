# Morning Trap Runner — n8n Setup

Zo's daily "check the traps" routine, automated.
Source: Zo's Loom walkthrough, March 24, 2026.
Context: sbr-product-marketing-context.md (included in this directory).

Fires at 7 AM MST. Pulls Google Ads, Amazon Ads, Shopify.
Claude writes the briefing in SBR brand voice. GHL texts it to Zo. Supabase logs it.

## Architecture

```
7 AM MST
    ├── Google Ads (MTD campaigns)    ──┐
    ├── Amazon Ads (MTD performance)  ──┼── Claude Analysis ──┬── GHL SMS to Zo
    └── Shopify (MTD orders + source) ──┘                    └── Supabase Log
```

Three data pulls run in parallel. Claude waits for all three.
SMS and log fire in parallel after Claude finishes.

## What Zo Gets Every Morning

A single SMS with:
- Google Ads MTD: spend, sales, ROAS, top and bottom campaign
- Amazon MTD: attributed sales, ACOS, TACOS, organic signal
- Shopify MTD: gross sales, orders, conversion rate, return rate
- Source breakdown (direct, Amazon, TikTok, Google, "no referrer")
- Combined ad spend vs combined revenue
- Flags if anything's off (with escalation routing)
- One opportunity if data suggests it

Ends with: "Go win your ground war."

## Setup Steps

### 1. Import the workflow
Open n8n. Workflows. Import from File. Select `morning-trap-runner.json`.

### 2. Create Supabase table
Run `supabase-morning-trap-runs.sql` in your Supabase SQL editor.

### 3. Set n8n Variables
Settings > Variables:

| Variable | Value | Where to find it |
|----------|-------|-------------------|
| `GOOGLE_ADS_CUSTOMER_ID` | Customer ID, no dashes | Google Ads > Account > Settings |
| `GOOGLE_ADS_MCC_ID` | Manager account ID | Only if using MCC |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Developer token | Google Ads API Center |
| `AMAZON_ADS_CLIENT_ID` | LWA client ID | Amazon developer console |
| `AMAZON_ADS_PROFILE_ID` | Advertising profile ID | Giant Horizons profile in Amazon Ads |
| `ZO_GHL_CONTACT_ID` | Zo's GHL contact record ID | Search GHL contacts for "Zo" |
| `SUPABASE_URL` | `https://xxxxx.supabase.co` | Supabase project settings |
| `SUPABASE_ANON_KEY` | Service role key (not anon) | Supabase > Settings > API |

### 4. Configure Credentials

**Shopify** (already done)
- Verify the existing credential pulls orders correctly
- Test: run just the Shopify node manually, confirm MTD orders return

**Google Ads OAuth2**
- n8n credential type: Google Ads OAuth2
- Client ID + Secret from Google Cloud Console
- Scopes: `https://www.googleapis.com/auth/adwords`
- Zo confirmed 6 active campaigns, Google Ads has 5 interfaces total

**Amazon Ads OAuth2**
- n8n credential type: Generic OAuth2
- Uses Login with Amazon (LWA) through Giant Horizons account
- Scopes: `advertising::campaign_management`
- 2FA required for Amazon login, credential setup may need Zo present

**Anthropic API**
- n8n credential type: Header Auth
- Header name: `x-api-key`
- Header value: your Anthropic API key

**GoHighLevel API**
- n8n credential type: Header Auth
- Header name: `Authorization`
- Header value: `Bearer YOUR_GHL_LOCATION_API_KEY`
- Needs scope: `conversations.message.write`
- Company phone for reference: (435) 383-4377

**Supabase**
- n8n credential type: Header Auth
- Header name: `Authorization`
- Header value: `Bearer YOUR_SUPABASE_SERVICE_ROLE_KEY`

### 5. Test sequence (start with Shopify)
1. Run Shopify node alone. Verify MTD orders come back with source_name and referring_site.
2. Add Google Ads. Test. Verify campaign-level spend and conversion data.
3. Add Amazon Ads. Test. Note: Amazon reporting API is async, may need a polling step.
4. Add Claude. Verify briefing matches the format. Check brand voice compliance.
5. Add GHL SMS. Send a test to Zo. Confirm delivery.
6. Add Supabase. Verify row logged with source breakdown.
7. Activate the schedule.

## Benchmarks (from Zo's Loom, March 24, 2026)

| Metric | Baseline | Flag | Alert |
|--------|----------|------|-------|
| Shopify checkout conversion | 27-30% | Below 20% | Below 16% (was flagged March 24) |
| Google Ads ROAS (mature campaigns) | 30:1 | Below 15:1 | Below 10:1 |
| Google Ads ROAS (new campaigns) | 10:1 | Below 5:1 | Below 3:1 |
| Combined monthly ad spend | Under $7K | Above $10K | Above $15K |
| Amazon TACOS | Low single digits | Above 8% | Above 12% |
| Return rate | Monitor | Above prior month avg | Zo flagged as "elevated" March 24 |

## Escalation Routing (from Big Diamond governance)

| Issue | Route to |
|-------|----------|
| Checkout conversion drop | Christopher + Kevin |
| ROAS collapse | Kevin + Zo |
| Ad spend spike | Christopher (budget approval) |
| Return rate spike | Sammie (fulfillment) |
| Attribution anomaly worsening | Matt (system architecture) |
| Missing data or API error | Matt (system architecture) |

## Known Issues to Track

**Attribution anomaly**: Shopify shows bulk revenue from unidentified referrer.
Zo's words: "We don't even know what's going on here."
The workflow tracks source_name and referring_site on every order.
Supabase logs the source breakdown daily so we can trend it.

**Amazon reporting API is async**: The current node fires a report request.
For production, may need a Wait node + poll for report completion.
Test first. If the report returns inline, no change needed.

**Zo's requirement for AI**: "If AI can't just go fix something, we need it to
tell us that it can't fix something, that it needs access, or it can't crawl
something." Claude's system prompt includes this rule. Never fail silently.

## 2026 Targets (context for Claude's analysis)

- Revenue target: $4,500,000
- Net margin target: 13.4% ($602,500)
- Ad spend ceiling: well below 2025's 29.1% of revenue ($908K was unsustainable)
- B2B target Year 1: $300-500K from Mark's outreach
