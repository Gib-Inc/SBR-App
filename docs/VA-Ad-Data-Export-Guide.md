# SBR Ad Data Export Guide — For VAs
## How to get ad platform data into the SBR Inventory App

**Last updated:** June 5, 2026
**Contact:** Matt Gibson (gibson.matt27@gmail.com)

---

## Overview

The SBR app needs weekly ad performance data from 4 platforms: Google Ads, Meta (Facebook/Instagram) Ads, Amazon Ads, and Pinterest Ads. Each platform has a built-in export feature — no API keys, no developer accounts, no coding required.

**Your job:** Set up scheduled exports (Google + Meta) and do weekly manual downloads (Amazon + Pinterest), then upload the CSV files to the SBR app.

---

## PLATFORM 1: Google Ads

### Option A: Scheduled Email Report (Recommended — set up once, runs automatically)

1. Go to **ads.google.com** and log in with `stickerburrroller@gmail.com`
2. Click the **Reports** icon (bar chart) in the left sidebar
3. Click **+ Custom** to create a new report
4. Set report type to **Table**
5. Add these columns (drag from the left panel):
   - **Campaign** (under Attributes)
   - **Day** (under Time)
   - **Cost** (under Performance)
   - **Conversions** (under Conversions)
   - **Conv. value** (under Conversions)
   - **Impressions** (under Performance)
   - **Clicks** (under Performance)
6. Set the date range to **Last 7 days**
7. Click the **Schedule** icon (clock icon, top right of the report)
8. Set:
   - Frequency: **Weekly** (every Monday)
   - Format: **CSV**
   - Recipients: `gibson.matt27@gmail.com` (and your email)
9. Click **Save and Schedule**

The report emails every Monday. Download the CSV attachment.

### Option B: Google Sheets Add-on (Live data, auto-refreshing)

1. Open a new Google Sheet
2. Go to **Extensions → Add-ons → Get add-ons**
3. Search for **"Google Ads"** and install the official Google add-on
4. Open it: Extensions → Google Ads → Create report
5. Select the same columns as above
6. Click **Create Report** — it builds a live-updating sheet
7. Share the sheet URL with Matt

---

## PLATFORM 2: Meta (Facebook + Instagram) Ads

### Scheduled Email Report (Set up once)

1. Go to **business.facebook.com/adsmanager**
2. Click **Ads Reporting** (in the left sidebar, under "Analyze and report")
   - NOT the main Campaigns table — the dedicated Reporting section
3. Click **Create Report**
4. Add these columns:
   - **Campaign name**
   - **Day** (set as breakdown)
   - **Amount spent**
   - **Impressions**
   - **Link clicks** (or "Clicks (all)")
   - **Purchases** (under Results — you may need to set the result type to "Purchases")
   - **Purchase conversion value** (or "Total conversion value")
5. Set date range to **Last 7 days**
6. Click the **Share** button (top right) → **Schedule recurring email**
7. Set:
   - Frequency: **Weekly**
   - Format: **CSV** or **XLSX**
   - Recipients: `gibson.matt27@gmail.com`
8. Click **Schedule**

---

## PLATFORM 3: Amazon Ads

### Manual Download (Weekly — Amazon doesn't offer auto-email)

1. Go to **advertising.amazon.com** and log in
2. Click **Measurement & Reporting** → **Sponsored ads reports**
3. Click **Create report**
4. Select report type: **Sponsored Products**
5. Select report: **Campaign**
6. Set time unit: **Daily**
7. Set date range: **Last 7 days** (or custom last week)
8. Click **Run report**
9. Wait for it to generate, then click **Download**

**Do this every Monday.** The file downloads as CSV.

### Important: Amazon only stores 60-90 days of report data. If you skip a week, the oldest data may be lost.

---

## PLATFORM 4: Pinterest Ads

### Manual Download (Weekly)

1. Go to **ads.pinterest.com**
2. Click into the **Campaigns** view
3. Set the date range to **Last 7 days**
4. Click the **download icon** (near the date picker, looks like a downward arrow)
5. Select **CSV** format
6. Save the file

**Do this every Monday.**

---

## UPLOADING TO THE SBR APP

After downloading the CSV files:

1. Go to **https://sbr-app-production-f1c4.up.railway.app/upload**
2. Log in (ask Matt for your login credentials if you don't have them)
3. You'll see the **Ad Data Upload** page — no need to navigate anywhere else
4. For each CSV file:
   a. Select the **Platform** (Google Ads, Meta Ads, Amazon Ads, or Pinterest Ads)
   b. Click **Choose File** and select the CSV
   c. Click **Upload**
   d. Verify the results: "Inserted: X, Updated: Y, Skipped: Z"
5. Repeat for each platform's CSV file
6. If errors appear, check that:
   - The file is a CSV (not PDF or XLSX)
   - The correct platform is selected
   - Duplicates are OK — re-uploading the same data just updates existing rows

**Bookmark this link:** https://sbr-app-production-f1c4.up.railway.app/upload

---

## Weekly Schedule (Set a recurring calendar reminder)

| Day | Task | Time |
|-----|------|------|
| **Monday** | Download Amazon Ads CSV | 5 min |
| **Monday** | Download Pinterest Ads CSV | 5 min |
| **Monday** | Check email for Google Ads CSV (auto) | 1 min |
| **Monday** | Check email for Meta Ads CSV (auto) | 1 min |
| **Monday** | Upload all 4 CSVs to SBR app | 5 min |

**Total weekly time: ~17 minutes**

---

## Troubleshooting

**"I can't find the Google Ads report scheduling option"**
→ You need Editor or higher access to the Google Ads account. Ask Matt to add you.

**"Meta says I don't have access to Ads Reporting"**
→ You need Advertiser or Admin role on the ad account in Business Manager. Ask Matt to add you.

**"Amazon report says no data"**
→ Check that you're looking at the right time period. If it's a new campaign, it may not have data yet.

**"The CSV upload shows 0 inserted, 0 skipped"**
→ The file might be empty, or the column names don't match. Open the CSV in a text editor and check that it has headers like "Campaign", "Cost", etc.

**"Upload shows errors for some rows"**
→ Some rows may have formatting issues (special characters, missing dates). The valid rows still get imported. Send the error details to Matt.

---

## Questions?

Contact Matt Gibson: gibson.matt27@gmail.com
Or post in the team Slack channel.
