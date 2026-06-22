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
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    commit: commit.slice(0, 7),
    uptimeSeconds: Math.round(process.uptime()),
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
