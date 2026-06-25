import { type Server } from "node:http";

import express, {
  type Express,
  type Request,
  Response,
  NextFunction,
} from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pkg from "pg";
const { Pool } = pkg;

import { registerRoutes } from "./routes";
import { 
  strictCacheControlMiddleware, 
  securityHeadersMiddleware,
  initializeSecureLogging,
  sanitizedErrorHandler,
  redactSensitiveData
} from "./middleware/intuit-security";
import { intuitSecurityConfig, validateSecurityConfig } from "./config/intuit-security";
import { attachPoolErrorHandler } from "./pool-error-handler";

const PgSession = connectPgSimple(session);

initializeSecureLogging();

// Process-level safety net for any scheduler tick whose try/catch was
// missed. We log to system_logs (best-effort, do not crash the process)
// so the /health page can show that something went off the rails. This
// is BELOW recordSchedulerRun's per-scheduler crash tracking — that
// path covers normal failures; this is the last line of defense.
process.on("unhandledRejection", (reason: any) => {
  const message = reason?.message ?? String(reason);
  console.error("[Process] unhandledRejection:", message, reason?.stack ?? "");
  void (async () => {
    try {
      const { storage } = await import("./storage");
      await storage.createSystemLog({
        type: "SCHEDULER",
        severity: "ERROR",
        code: "SCHEDULER_CRASH",
        message: `unhandledRejection: ${message}`,
        details: { stack: reason?.stack ?? null },
      });
    } catch {
      // logging failure is itself non-fatal — never crash here
    }
  })();
});

// Last line of defense for a SYNCHRONOUS throw that escapes every try/catch.
// The most important case is a pg Pool 'error' (a dropped idle DB connection)
// on a pool with no listener, which Node would otherwise rethrow here and use
// to kill the process. The per-pool handlers (attachPoolErrorHandler) handle
// that case gracefully; this is the backstop so a missed one can never hard-down
// the whole app. Log best-effort and keep serving.
process.on("uncaughtException", (err: any) => {
  const message = err?.message ?? String(err);
  console.error("[Process] uncaughtException:", message, err?.stack ?? "");
  void (async () => {
    try {
      const { storage } = await import("./storage");
      await storage.createSystemLog({
        type: "SCHEDULER",
        severity: "ERROR",
        code: "UNCAUGHT_EXCEPTION",
        message: `uncaughtException: ${message}`,
        details: { stack: err?.stack ?? null },
      });
    } catch {
      // never crash inside the crash handler
    }
  })();
});

// Memory watchdog (stopgap while a memory leak is root-caused). The app's RSS
// climbs steadily and the OS eventually SIGKILLs it mid-request — silent, no
// logs, hard downtime. Instead, watch RSS and exit cleanly above a safe ceiling
// so Railway restarts us in ~1 min with a logged reason. Tune via MEM_RESTART_MB.
const MEM_RESTART_MB = Number(process.env.MEM_RESTART_MB || 1700);
const __memWatchdog = setInterval(() => {
  const rssMB = Math.round(process.memoryUsage().rss / 1048576);
  if (rssMB > MEM_RESTART_MB) {
    // Exit SYNCHRONOUSLY. Do NOT await a DB write first — under memory pressure the pool
    // hangs, the await never resolves, and the OS OOM-kills us before we ever restart
    // (observed: rss reached 2276MB despite a 1900 limit). console.error is enough.
    console.error(`[MemWatchdog] RSS ${rssMB}MB exceeded ${MEM_RESTART_MB}MB — restarting now (pre-OOM).`);
    process.exit(1);
  }
}, 15_000);
if (typeof (__memWatchdog as any)?.unref === "function") (__memWatchdog as any).unref();

const securityValidation = validateSecurityConfig();
if (securityValidation.warnings.length > 0) {
  securityValidation.warnings.forEach(w => console.warn(`[Intuit Security] Warning: ${w}`));
}
if (securityValidation.errors.length > 0) {
  securityValidation.errors.forEach(e => console.error(`[Intuit Security] Error: ${e}`));
}

// Create a separate connection pool for session store
const sessionPool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
attachPoolErrorHandler(sessionPool, "session");

declare module "express-session" {
  interface SessionData {
    userId?: string;
    oauthState?: string;
    shopifyOAuthShop?: string;
  }
}

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

export const app = express();

// Trust proxy for secure cookies behind reverse proxy
app.set('trust proxy', 1);

declare module 'http' {
  interface IncomingMessage {
    rawBody: unknown
  }
}
app.use(express.json({
  limit: '50mb',
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: false, limit: '50mb' }));

// Serve uploaded damage photos statically
app.use('/uploads', express.static('uploads'));

// ── Deploy provenance: prove exactly which build is running ──────────────────
// Railway sets RAILWAY_GIT_COMMIT_SHA to the deployed commit; we fall back to the
// local .git HEAD (dev) so this is never blank. Resolved once, then cached.
const SERVER_STARTED_AT = new Date();
let __commitCache: string | null = null;
async function resolveCommit(): Promise<string> {
  if (__commitCache) return __commitCache;
  const fromEnv = process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_COMMIT || process.env.SOURCE_VERSION;
  if (fromEnv) return (__commitCache = fromEnv);
  try {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const head = fs.readFileSync(path.join(process.cwd(), '.git', 'HEAD'), 'utf8').trim();
    __commitCache = head.startsWith('ref:')
      ? fs.readFileSync(path.join(process.cwd(), '.git', head.slice(5).trim()), 'utf8').trim()
      : head;
  } catch {
    __commitCache = 'unknown';
  }
  return __commitCache;
}

// Public health check endpoint for Railway deployment
app.get('/api/health', async (_req, res) => {
  const commit = await resolveCommit();
  const m = process.memoryUsage();
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    commit: commit.slice(0, 7),
    uptimeSeconds: Math.round(process.uptime()),
    memoryMB: {
      rss: Math.round(m.rss / 1048576),
      heapUsed: Math.round(m.heapUsed / 1048576),
      heapTotal: Math.round(m.heapTotal / 1048576),
      external: Math.round(m.external / 1048576),
    },
    activeResources: (() => {
      try {
        const list: string[] = (process as any).getActiveResourcesInfo?.() ?? [];
        const counts: Record<string, number> = {};
        for (const t of list) counts[t] = (counts[t] ?? 0) + 1;
        return counts;
      } catch { return null; }
    })(),
  });
});

// Deploy provenance — returns the exact commit + deploy metadata of the RUNNING
// build so anyone (you, the dev team) can confirm what is actually live. Public.
app.get('/api/version', async (_req, res) => {
  const commit = await resolveCommit();
  res.status(200).json({
    commit,
    commitShort: commit.slice(0, 7),
    branch: process.env.RAILWAY_GIT_BRANCH || null,
    deploymentId: process.env.RAILWAY_DEPLOYMENT_ID || null,
    serviceName: process.env.RAILWAY_SERVICE_NAME || null,
    environment: process.env.NODE_ENV || 'development',
    node: process.version,
    startedAt: SERVER_STARTED_AT.toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
  });
});

// Intuit-compliant security headers middleware
app.use(securityHeadersMiddleware);

// Session configuration with Intuit-compliant secure cookie settings
// IMPORTANT: Cookies are ALWAYS secure and httpOnly per Intuit requirements
app.use(
  session({
    store: new PgSession({
      pool: sessionPool,
      tableName: "session",
      createTableIfMissing: true,
    }),
    secret: process.env.SESSION_SECRET || "inventory-management-secret-key-change-in-production",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: intuitSecurityConfig.cookieSettings.secure,
      httpOnly: intuitSecurityConfig.cookieSettings.httpOnly,
      sameSite: intuitSecurityConfig.cookieSettings.sameSite,
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    },
  })
);

// Intuit-compliant strict caching headers on authenticated routes
app.use(strictCacheControlMiddleware);

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

export default async function runApp(
  setup: (app: Express, server: Server) => Promise<void>,
) {
  const server = await registerRoutes(app);

  // Apply additive schema migrations BEFORE anything queries — DATABASE_URL is
  // available here, unlike the build (where drizzle-kit push is skipped). This
  // ends the recurring "column in code, missing in DB" breakage on deploy.
  try {
    const { runStartupMigrations } = await import("./startup-migrations");
    await runStartupMigrations();
  } catch (err: any) {
    console.error("[Startup Migrations] Failed to run:", err?.message ?? err);
  }

  // Boot-time schema + data migration checks. Fails loud (with clear log
  // lines) but doesn't block startup so other routes still come up if
  // anything is off. Awaited here so the output appears before the
  // "serving on ..." line — easy to spot in the deploy log tail.
  try {
    const { runStartupChecks } = await import("./services/startup-checks");
    await runStartupChecks();
  } catch (err: any) {
    console.error("[Startup Checks] Failed to run:", err?.message ?? err);
  }

  // CIPH.R Finances — seed the accountant's real financials if the tables are
  // empty, so the Finances tab is populated on first deploy (idempotent).
  try {
    const { seedFinancialsIfEmpty } = await import("./services/financial-seed-service");
    await seedFinancialsIfEmpty();
  } catch (err: any) {
    console.error("[Finances Seed] Failed to run:", err?.message ?? err);
  }

  // CIPH.R — arm the daily Windsor.ai ad-spend sync (keeps Google/Amazon spend
  // accurate from each platform's API). No-op without WINDSOR_API_KEY. Fire-and-
  // forget so a slow Windsor call doesn't block boot.
  void (async () => {
    try {
      const { startWindsorSyncScheduler } = await import("./services/windsor-sync-service");
      startWindsorSyncScheduler();
    } catch (err: any) {
      console.error("[Windsor Sync] Failed to arm:", err?.message ?? err);
    }
  })();

  // CIPH.R — arm the daily live-QuickBooks financial capture (cash on hand, A/R +
  // aging, A/P + aging, P&L). No-op until QuickBooks is connected. Fire-and-forget.
  void (async () => {
    try {
      const { startQbFinancialScheduler } = await import("./services/qb-financial-service");
      startQbFinancialScheduler();
    } catch (err: any) {
      console.error("[QB Financials] Failed to arm:", err?.message ?? err);
    }
  })();

  // CIPH.R — one-time backfill (then monthly refresh) of transaction-level
  // expense detail (ProfitAndLossDetail) into qb_pl_detail + qb_vendor_expense.
  // Self-guards: backfill only runs if the table is empty and QuickBooks is
  // connected. Fire-and-forget; never wired to a request/page-load path.
  void (async () => {
    try {
      const { startQbExpenseDetailBackfill } = await import("./services/qb-expense-detail-sync");
      startQbExpenseDetailBackfill();
    } catch (err: any) {
      console.error("[QB ExpenseDetail] Failed to arm backfill:", err?.message ?? err);
    }
  })();

  // COUNT.M — arm the weekly per-vendor reorder digest (Monday "what each vendor
  // needs", draft-for-approval). Self-guards to once per week. Fire-and-forget.
  void (async () => {
    try {
      const { startReorderDigestScheduler } = await import("./services/reorder-digest-service");
      startReorderDigestScheduler();
    } catch (err: any) {
      console.error("[Reorder Digest] Failed to arm:", err?.message ?? err);
    }
  })();

  // Drain any already-SENT POs that never reached QuickBooks (sent before
  // auto-push-on-send existed). Idempotent — no-ops once the queue is empty.
  // Delayed so QB token refresh + DB are warm; fire-and-forget.
  setTimeout(() => {
    void (async () => {
      try {
        const { backfillUnsyncedSentPOs } = await import("./services/po-quickbooks-sync");
        await backfillUnsyncedSentPOs();
      } catch (err: any) {
        console.error("[PurchaseOrder] QuickBooks backfill failed to run:", err?.message ?? err);
      }
    })();
  }, 45_000);

  // One-shot: reconstruct December 2025's COGS transactions + inventory roll-
  // forward from QuickBooks to settle whether the year-end spike was expensed
  // replenishment or a real write-down. Self-guards to run only once. Read-only.
  setTimeout(() => {
    void (async () => {
      try {
        const { runDecember2025Forensics } = await import("./services/qb-forensics");
        await runDecember2025Forensics();
      } catch (err: any) {
        console.error("[Forensics] December pull failed:", err?.message ?? err);
      }
    })();
  }, 60_000);

  // Cutoff + in-transit test: was the Dec-31-dated write-down built from a Jan-7
  // count, and did replenishment / January sales get swept into December?
  setTimeout(() => {
    void (async () => {
      try {
        const { runCutoffForensics } = await import("./services/qb-forensics");
        await runCutoffForensics();
      } catch (err: any) {
        console.error("[Forensics] Cutoff pull failed:", err?.message ?? err);
      }
    })();
  }, 80_000);

  // Full-year inventory-account reconciliation: total bought-in vs total written
  // off via "match Katana" adjustments, to size the recoverable component piece.
  setTimeout(() => {
    void (async () => {
      try {
        const { runInventoryReconciliation } = await import("./services/qb-forensics");
        await runInventoryReconciliation();
      } catch (err: any) {
        console.error("[Forensics] Inventory recon failed:", err?.message ?? err);
      }
    })();
  }, 100_000);

  // COUNT.M — one-shot QuickBooks demand-history diagnostic: run the built-but-
  // never-run 3-year sales sync once and log a readable summary (does QB carry
  // item-level history, how deep, and what are the item names) so we can decide
  // whether to wire QB seasonality into reorder. Self-guards to a single run.
  setTimeout(() => {
    void (async () => {
      try {
        const { runQbDemandDiagnostic } = await import("./services/qb-demand-diagnostic");
        await runQbDemandDiagnostic();
      } catch (err: any) {
        console.error("[QB-Diag] Demand diagnostic failed to run:", err?.message ?? err);
      }
    })();
  }, 120_000);

  // COUNT.M — one-shot Shopify historical backfill: pull real per-SKU orders
  // back to 2024 into sales_order_lines so reorder velocity / COGS / cadence
  // can see actual seasonality (the app only holds ~4.5 months natively, and
  // QuickBooks has no item-level history). Safe (pure inserts, isHistorical),
  // idempotent per order, self-guards to one completed run, and probes the
  // read_all_orders scope before paging. Fire-and-forget.
  setTimeout(() => {
    void (async () => {
      try {
        const { runShopifyHistoricalBackfill } = await import("./services/shopify-historical-backfill");
        const r = await runShopifyHistoricalBackfill({ dateFrom: "2024-01-01" });
        if (r.ran) console.log(`[Shopify Backfill] ${r.inserted} historical orders back to ${r.oldestOrderReturned}.`);
        else if (r.scopeLimited) console.warn("[Shopify Backfill] Token scope-limited — CSV export needed.");
      } catch (err: any) {
        console.error("[Shopify Backfill] Failed to run:", err?.message ?? err);
      }
    })();
  }, 150_000);

  // CIPH.R — sync credit-line (liability) balances from QuickBooks shortly after
  // boot, then every 6h, so the Credit Lines card shows live per-card balances.
  // No-op until QuickBooks is connected. Fire-and-forget.
  setTimeout(() => {
    const tick = async () => {
      try {
        const { syncCreditLineBalances } = await import("./services/credit-lines-service");
        const r = await syncCreditLineBalances();
        if (r.synced) console.log(`[CreditLines] Synced ${r.synced} liability accounts from QuickBooks.`);
      } catch (err: any) {
        console.error("[CreditLines] Balance sync failed:", err?.message ?? err);
      }
    };
    void tick();
    const t = setInterval(() => void tick(), 6 * 60 * 60 * 1000);
    if (typeof (t as any)?.unref === "function") (t as any).unref();
  }, 130_000);

  // Arm the recurring schedulers (Extensiv sync, AI System Review,
  // Morning Trap, channel sync timers). These were previously declared
  // in scheduler-service.ts but startScheduler() was never called from
  // boot — only from a runtime route — so the timers never armed and
  // every recurring job ghosted. Fire-and-forget so a slow channel
  // config fetch doesn't block the listen() below.
  void (async () => {
    try {
      const { startScheduler } = await import("./scheduler-service");
      await startScheduler();
    } catch (err: any) {
      console.error("[Scheduler] Failed to start:", err?.message ?? err);
    }
  })();

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly run the final setup after setting up all the other routes so
  // the catch-all route doesn't interfere with the other routes
  await setup(app, server);

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  const host = process.env.HOST || '0.0.0.0';
  // reusePort is required on Railway/Linux for zero-downtime deploys, but macOS
  // throws ENOTSUP when combined with 0.0.0.0 on Node 24+. Disable it for local
  // dev where a 127.0.0.1 host is fine.
  const reusePort = host === '0.0.0.0';
  server.listen({
    port,
    host,
    reusePort,
  }, () => {
    log(`serving on ${host}:${port}`);
  });
}
