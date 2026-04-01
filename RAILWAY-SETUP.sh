# Railway Setup — Run These Steps
# Monday morning deployment checklist for SBR Morning Trap Runner
# ================================================================

# STEP 1: Merge the branch
# -------------------------
# In Railway dashboard > SBR-App service > Settings tab:
# Change the deploy branch from "main" to "claude/zobot-marketing-system-A6Ojd"
# OR merge the branch on GitHub first:
# Go to github.com/Gib-Inc/SBR-App > Pull Requests > Create PR from
# claude/zobot-marketing-system-A6Ojd → main > Merge

# STEP 2: Add these environment variables
# ----------------------------------------
# Railway dashboard > SBR-App service > Variables tab > + New Variable
# Add each of these:

PORT=5000

# Only add N8N_WEBHOOK_URL after Carpe Diem gives you the URL from n8n:
# N8N_WEBHOOK_URL=https://your-n8n-instance.com/webhook/trap-check-inbound

# STEP 3: Verify DATABASE_URL exists
# ------------------------------------
# Click "> 6 variables added by Railway" to expand
# Confirm DATABASE_URL is there
# If it's NOT there, you need to add a PostgreSQL database:
#   Railway dashboard > + New > Database > PostgreSQL > Add
#   This auto-creates DATABASE_URL

# STEP 4: Check deploy
# ----------------------
# After variables are set and branch is merged, Railway auto-deploys
# Watch the Deployments tab — should see:
#   ✅ Initialization
#   ✅ Build
#   ✅ Deploy
#   ✅ Network > Healthcheck
# If healthcheck fails, click "View logs" and send me the screenshot

# STEP 5: Test the trap check
# -----------------------------
# Go to: https://sbr-app-production.up.railway.app/marketing
# You should see the "Morning Trap" tab
# Click "Run Now (no SMS)" to test
# It should show Shopify data (green) and Google/Meta (red = not configured yet, that's fine)

# STEP 6: Confirm scheduler
# ---------------------------
# The morning trap fires automatically at 7 AM MST every day
# First briefing will be tomorrow morning
# Check /marketing tab to see the result

# ================================================================
# CREDENTIALS ALREADY IN THE DATABASE (from Charles's setup):
# - Shopify: Connected ✅
# - GoHighLevel: Connected ✅
# - Extensiv: Connected ✅
# - QuickBooks: Connected ✅ (last synced Mar 10)
#
# NOT YET CONNECTED (do later, not blocking Monday):
# - Google Ads: needs OAuth flow from Settings page
# - Meta Ads: needs OAuth flow from Settings page
# - Amazon: needs configuration
# - Shippo: needs configuration
#
# The trap check works with Shopify alone. Google/Meta are bonus.
# ================================================================
