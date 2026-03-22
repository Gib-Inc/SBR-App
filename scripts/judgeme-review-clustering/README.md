# Judge.me Review Clustering Report

Weekly script that pulls reviews from Judge.me for stickerburroller.com, clusters them by theme using Claude API, and outputs a report to Google Sheets.

## Setup

1. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env with your actual credentials
   ```

3. **Google Sheets setup:**
   - Create a Google Cloud service account with Sheets API enabled
   - Download the service account JSON key file
   - Place it at the path specified by `GOOGLE_SERVICE_ACCOUNT_JSON`
   - Share the target spreadsheet with the service account email

4. **Judge.me API token:**
   - Get your private API token from Judge.me dashboard → Settings → API

## Run manually

```bash
cd scripts/judgeme-review-clustering
python judgeme_review_report.py
```

## Cron job (every Monday at 6am)

```cron
0 6 * * 1 cd /path/to/SBR-App/scripts/judgeme-review-clustering && /usr/bin/python3 judgeme_review_report.py
```

For Railway, add a cron service with schedule `0 6 * * 1` running:
```bash
cd scripts/judgeme-review-clustering && pip install -r requirements.txt && python judgeme_review_report.py
```
