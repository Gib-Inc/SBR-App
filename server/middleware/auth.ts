import { Request, Response, NextFunction } from "express";
import { storage } from "../storage";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Authentication required" });
  }
  next();
}

// Role taxonomy. Two vocabularies exist in this codebase — the original
// admin/member/warehouse (what is actually stored on user records and used in
// most route gates) and a later owner/manager/floor/office split. We collapse
// BOTH to a single privilege LEVEL so a gate enforces the same intent no matter
// which vocabulary the route or the stored record happens to use.
export type Role = "owner" | "manager" | "floor" | "office";
type RoleInput = Role | "admin" | "member" | "warehouse";

// Higher number = more privilege. A role we don't recognize — including null,
// empty, or anything not listed here — is level 0 (LEAST privilege). It is NEVER
// grandfathered to access; it must be granted a real role to do anything gated.
// This is the fix for the prior owner-fallback that made every gate a no-op.
const ROLE_LEVEL: Record<string, number> = {
  owner: 4,
  admin: 4, // admin == owner: full access
  manager: 3,
  member: 2,
  office: 2,
  floor: 1,
  warehouse: 1,
};

export function roleLevel(stored: string | null | undefined): number {
  if (!stored) return 0;
  return ROLE_LEVEL[stored] ?? 0;
}

// Back-compat: still exported in case anything imports it. Maps to a canonical
// Role label by privilege level. No longer used for authorization decisions —
// requireRole compares levels directly so the mixed vocabulary can't leak.
export function normalizeRole(stored: string | null | undefined): Role {
  const lvl = roleLevel(stored);
  if (lvl >= 4) return "owner";
  if (lvl >= 3) return "manager";
  if (lvl >= 1) return "floor";
  return "office"; // level 0 maps to the lowest named Role for display only
}

/**
 * Gate a route to one or more roles. Always pair after requireAuth.
 *   app.post("/api/inventory/writeoff", requireAuth, requireRole("manager"), handler)
 *
 * The bar is the LEAST-privileged role explicitly allowed; any user at or above
 * that level passes. So requireRole("manager") admits managers, admins, and
 * owners, and requireRole(["admin"]) admits only admins/owners. A user whose
 * stored role is unknown/null (level 0) is denied by every gate.
 */
export function requireRole(...allowed: Array<RoleInput | RoleInput[]>) {
  const flattened = allowed.flat();
  // Fail safe: an empty list, or a gate that only names roles we don't
  // recognize, requires at least level 1 — never level 0 (which would let an
  // unknown-role user through).
  const requiredLevel = Math.max(
    1,
    flattened.length ? Math.min(...flattened.map((r) => roleLevel(r))) : 4,
  );
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Authentication required" });
    }
    try {
      const user = await storage.getUser(req.session.userId);
      const level = roleLevel((user as any)?.role);
      if (level < requiredLevel) {
        return res.status(403).json({
          error: "Permission denied — your role does not have access to this action",
        });
      }
      next();
    } catch (err: any) {
      console.error("[requireRole] lookup failed:", err?.message ?? err);
      return res.status(500).json({ error: "Permission check failed" });
    }
  };
}
