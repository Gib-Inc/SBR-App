# Morning Trap Runner — n8n Setup

Zo's daily "check the traps" routine, automated.
Fires at 6 AM MST. Pulls Google Ads, Amazon Ads, Shopify.
Claude writes the briefing. GHL texts it to Zo. Supabase logs it.

## Architecture

```
6AM Trigger
    ├── Google Ads (MTD campaigns)  ──┐
    ├── Amazon Ads (MTD performance) ──┼── Claude Analysis ──┬── GHL SMS to Zo
    └── Shopify (MTD orders)  ────────┘                     └── Supabase Log
```

Three data pulls run in parallel. Claude waits for all three.
SMS and log fire in parallel after Claude finishes.

## Setup Steps

### 1. Import the workflow
- Open n8n, go to Workflows, click Import from File
- Select `morning-trap-runner.json`

### 2. Create Supabase table
- Run `supabase-morning-trap-runs.sql` in your Supabase SQL editor

### 3. Set n8n Variables
Go to Settings > Variables and create:

| Variable | Value | Notes |
|----------|-------|-------|
| `GOOGLE_ADS_CUSTOMER_ID` | Your customer ID (no dashes) | From Google Ads account |
| `GOOGLE_ADS_MCC_ID` | MCC/manager account ID | If using MCC |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Developer token | From API Center |
| `AMAZON_ADS_CLIENT_ID` | LWA client ID | From Amazon developer console |
| `AMAZON_ADS_PROFILE_ID` | Advertising profile ID | Giant Horizons profile |
| `ZO_GHL_CONTACT_ID` | Zo's GHL contact ID | From sbr-product-marketing-context.md |
| `SUPABASE_URL` | `https://xxxxx.supabase.co` | Project URL |
| `SUPABASE_ANON_KEY` | Service role key | For insert access |

### 4. Configure Credentials

**Shopify** (already done)
- Verify the existing credential pulls orders correctly
- Test: run just the Shopify node manually

**Google Ads OAuth2**
- Create credential: Google Ads OAuth2
- Client ID + Secret from Google Cloud Console
- Scopes: `https://www.googleapis.com/auth/adwords`

**Amazon Ads OAuth2**
- Create credential: Amazon Advertising OAuth2
- Uses Login with Amazon (LWA)
- Scopes: `advertising::campaign_management`

**Anthropic API**
- Create credential: Header Auth
- Header name: `x-api-key`
- Header value: your Anthropic API key

**GoHighLevel API**
- Create credential: Header Auth
- Header name: `Authorization`
- Header value: `Bearer YOUR_GHL_API_KEY`

**Supabase**
- Create credential: Header Auth
- Header name: `Authorization`
- Header value: `Bearer YOUR_SUPABASE_SERVICE_KEY`

### 5. Test sequence
Start with Shopify (credential is ready), then add one node at a time:
1. Run Shopify node alone, verify orders come back
2. Add Google Ads, test
3. Add Amazon Ads, test
4. Add Claude, verify briefing quality
5. Add GHL SMS, send a test to Zo
6. Add Supabase, verify row logged
7. Activate the schedule

## What Claude Analyzes

Based on Zo's Loom walkthrough, the briefing covers:
- Google Ads MTD: spend, sales, ROAS, per-campaign breakdown
- Amazon Ads MTD: attributed sales, ACOS, TACOS, organic signal
- Shopify MTD: gross sales, order count, conversion rate, return rate
- Combined ad spend vs combined revenue
- Flags: conversion drops, ROAS dips, spend spikes
- Opportunities: anything the data suggests

## Zo's Benchmarks (from transcript)

| Metric | Normal | Flag if |
|--------|--------|---------|
| Shopify checkout conversion | 20-30% | Below 16% |
| Google Ads ROAS (mature) | 30:1 | Below 10:1 |
| Google Ads ROAS (new) | 10:1 | Below 5:1 |
| Monthly ad spend (combined) | Under $7K | Spike above $10K |
| Amazon TACOS | Low single digits | Above 8% |

## Missing: sbr-product-marketing-context.md

The following values need to come from that file:
- `ZO_GHL_CONTACT_ID` — Zo's contact record in GHL
- GHL Location ID (for API scope)
- Any platform-specific account IDs

Once that file is located, update the n8n variables accordingly.
