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

// Public health check endpoint for Railway deployment
app.get('/api/health', (_req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
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
