import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import { attachPoolErrorHandler } from "./pool-error-handler";

/**
 * Shared Drizzle instance for code paths that query the database directly
 * instead of going through the storage layer — currently the GHL agent routes
 * in routes.ts (order-lookup / order-status), which were written against a bare
 * `db` that was never in scope, so every call threw a ReferenceError at runtime.
 *
 * Uses the same DATABASE_URL as PostgresStorage. A small dedicated pool keeps
 * these ad-hoc reads off the storage pool. Prefer adding a storage method for
 * anything reused; this exists so direct-query routes don't crash.
 */
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
attachPoolErrorHandler(pool, "shared-db");
export const db = drizzle(pool, { schema });
