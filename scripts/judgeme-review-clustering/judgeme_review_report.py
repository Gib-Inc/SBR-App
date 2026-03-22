#!/usr/bin/env python3
"""
Judge.me Review Clustering Report

Pulls reviews from Judge.me API for stickerburroller.com,
clusters them by theme using Claude API, and outputs a
weekly report to Google Sheets.

Intended to run as a cron job every Monday at 6am.

Required environment variables:
  JUDGEME_API_TOKEN    - Judge.me private API token
  JUDGEME_SHOP_DOMAIN  - Shopify domain (default: stickerburroller.myshopify.com)
  ANTHROPIC_API_KEY    - Anthropic API key for Claude
  GOOGLE_SHEETS_ID     - Target Google Sheets spreadsheet ID
  GOOGLE_SERVICE_ACCOUNT_JSON - Path to Google service account credentials JSON
"""

import os
import sys
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import anthropic
import gspread
import requests
from dotenv import load_dotenv
from google.oauth2.service_account import Credentials

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

JUDGEME_API_TOKEN = os.environ.get("JUDGEME_API_TOKEN", "")
JUDGEME_SHOP_DOMAIN = os.environ.get("JUDGEME_SHOP_DOMAIN", "stickerburroller.myshopify.com")
JUDGEME_API_BASE = "https://judge.me/api/v1"

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

GOOGLE_SHEETS_ID = os.environ.get("GOOGLE_SHEETS_ID", "")
GOOGLE_SERVICE_ACCOUNT_JSON = os.environ.get(
    "GOOGLE_SERVICE_ACCOUNT_JSON", "service-account.json"
)

CLAUDE_MODEL = "claude-sonnet-4-20250514"
LOOKBACK_DAYS = 7

# ---------------------------------------------------------------------------
# Judge.me API
# ---------------------------------------------------------------------------


def fetch_reviews(since: datetime) -> list[dict[str, Any]]:
    """Fetch all reviews from Judge.me created since the given datetime."""
    reviews: list[dict[str, Any]] = []
    page = 1
    per_page = 100

    while True:
        log.info("Fetching Judge.me reviews page %d …", page)
        resp = requests.get(
            f"{JUDGEME_API_BASE}/reviews",
            params={
                "api_token": JUDGEME_API_TOKEN,
                "shop_domain": JUDGEME_SHOP_DOMAIN,
                "per_page": per_page,
                "page": page,
            },
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()

        batch = data.get("reviews", [])
        if not batch:
            break

        for review in batch:
            created = datetime.fromisoformat(
                review["created_at"].replace("Z", "+00:00")
            )
            if created >= since:
                reviews.append(review)

        # If the oldest review in this batch is still within range, keep paging
        oldest_in_batch = datetime.fromisoformat(
            batch[-1]["created_at"].replace("Z", "+00:00")
        )
        if oldest_in_batch < since or len(batch) < per_page:
            break

        page += 1

    log.info("Fetched %d reviews since %s", len(reviews), since.isoformat())
    return reviews


# ---------------------------------------------------------------------------
# Claude-powered theme clustering
# ---------------------------------------------------------------------------


def cluster_reviews(reviews: list[dict[str, Any]]) -> dict[str, Any]:
    """Send reviews to Claude for theme clustering and return structured report."""
    if not reviews:
        return {
            "summary": "No new reviews this week.",
            "clusters": [],
            "stats": {"total": 0, "avg_rating": 0},
        }

    # Build a condensed review list for the prompt
    review_texts = []
    for r in reviews:
        rating = r.get("rating", "N/A")
        title = r.get("title", "")
        body = r.get("body", "")
        product = r.get("product_title", "Unknown Product")
        review_texts.append(
            f"- [{rating}★] ({product}) {title}: {body}"
        )

    reviews_block = "\n".join(review_texts)
    total = len(reviews)
    avg_rating = sum(r.get("rating", 0) for r in reviews) / total

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    prompt = f"""You are a product review analyst for Sticker Burr Roller (SBR),
an outdoor/lawn products company. Analyze the following {total} customer reviews
from the past week and cluster them by theme.

Reviews:
{reviews_block}

Return a JSON object with this exact structure:
{{
  "summary": "2-3 sentence executive summary of this week's reviews",
  "clusters": [
    {{
      "theme": "Theme name (e.g. 'Product Quality', 'Shipping Speed', 'Ease of Use')",
      "sentiment": "positive" | "negative" | "mixed",
      "count": <number of reviews in this cluster>,
      "avg_rating": <average star rating for this cluster>,
      "key_quotes": ["quote 1", "quote 2"],
      "action_items": ["suggested action if any"]
    }}
  ],
  "top_products_mentioned": [
    {{"product": "name", "review_count": N, "avg_rating": N}}
  ],
  "urgent_issues": ["any critical negative feedback needing immediate attention"]
}}

Rules:
- Each review can belong to multiple clusters
- Sort clusters by count descending
- Keep key_quotes short (1 sentence max)
- Only include urgent_issues if there are genuinely critical complaints
- Return ONLY valid JSON, no markdown fencing"""

    log.info("Sending %d reviews to Claude for clustering …", total)
    message = client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
    )

    response_text = message.content[0].text.strip()
    # Strip markdown code fences if present
    if response_text.startswith("```"):
        response_text = response_text.split("\n", 1)[1]
        if response_text.endswith("```"):
            response_text = response_text.rsplit("```", 1)[0]
        response_text = response_text.strip()

    result = json.loads(response_text)
    result["stats"] = {"total": total, "avg_rating": round(avg_rating, 2)}
    return result


# ---------------------------------------------------------------------------
# Google Sheets output
# ---------------------------------------------------------------------------

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]


def get_sheets_client() -> gspread.Client:
    """Authenticate and return a gspread client."""
    creds = Credentials.from_service_account_file(
        GOOGLE_SERVICE_ACCOUNT_JSON, scopes=SCOPES
    )
    return gspread.authorize(creds)


def write_report_to_sheets(report: dict[str, Any], week_label: str) -> str:
    """Write the clustering report to a new worksheet tab in Google Sheets.

    Returns the URL of the spreadsheet.
    """
    gc = get_sheets_client()
    spreadsheet = gc.open_by_key(GOOGLE_SHEETS_ID)

    # Create or replace worksheet for this week
    tab_title = f"Week {week_label}"
    try:
        ws = spreadsheet.worksheet(tab_title)
        ws.clear()
    except gspread.exceptions.WorksheetNotFound:
        ws = spreadsheet.add_worksheet(title=tab_title, rows=200, cols=10)

    rows: list[list[str]] = []

    # Header section
    stats = report.get("stats", {})
    rows.append(["SBR Judge.me Review Report", "", "", f"Week of {week_label}"])
    rows.append([
        f"Total Reviews: {stats.get('total', 0)}",
        f"Avg Rating: {stats.get('avg_rating', 0)}★",
    ])
    rows.append([])
    rows.append(["Summary"])
    rows.append([report.get("summary", "")])
    rows.append([])

    # Clusters table
    rows.append(["Theme", "Sentiment", "Count", "Avg Rating", "Key Quotes", "Action Items"])
    for cluster in report.get("clusters", []):
        rows.append([
            cluster.get("theme", ""),
            cluster.get("sentiment", ""),
            str(cluster.get("count", 0)),
            str(cluster.get("avg_rating", 0)),
            " | ".join(cluster.get("key_quotes", [])),
            " | ".join(cluster.get("action_items", [])),
        ])
    rows.append([])

    # Top products
    rows.append(["Top Products Mentioned", "Review Count", "Avg Rating"])
    for product in report.get("top_products_mentioned", []):
        rows.append([
            product.get("product", ""),
            str(product.get("review_count", 0)),
            str(product.get("avg_rating", 0)),
        ])
    rows.append([])

    # Urgent issues
    urgent = report.get("urgent_issues", [])
    if urgent:
        rows.append(["⚠ Urgent Issues"])
        for issue in urgent:
            rows.append([issue])

    ws.update(range_name="A1", values=rows)
    url = f"https://docs.google.com/spreadsheets/d/{GOOGLE_SHEETS_ID}"
    log.info("Report written to Google Sheets: %s (tab: %s)", url, tab_title)
    return url


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    # Validate required env vars
    missing = []
    if not JUDGEME_API_TOKEN:
        missing.append("JUDGEME_API_TOKEN")
    if not ANTHROPIC_API_KEY:
        missing.append("ANTHROPIC_API_KEY")
    if not GOOGLE_SHEETS_ID:
        missing.append("GOOGLE_SHEETS_ID")
    if missing:
        log.error("Missing required environment variables: %s", ", ".join(missing))
        sys.exit(1)

    if not os.path.exists(GOOGLE_SERVICE_ACCOUNT_JSON):
        log.error(
            "Google service account JSON not found at: %s",
            GOOGLE_SERVICE_ACCOUNT_JSON,
        )
        sys.exit(1)

    since = datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)
    week_label = since.strftime("%Y-%m-%d")

    log.info("=== Judge.me Review Clustering Report ===")
    log.info("Store: %s | Lookback: %d days", JUDGEME_SHOP_DOMAIN, LOOKBACK_DAYS)

    # 1. Fetch reviews
    reviews = fetch_reviews(since)

    # 2. Cluster with Claude
    report = cluster_reviews(reviews)

    # 3. Write to Google Sheets
    url = write_report_to_sheets(report, week_label)

    log.info("=== Done! Report available at: %s ===", url)


if __name__ == "__main__":
    main()
