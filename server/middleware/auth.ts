import { Request, Response, NextFunction } from "express";
import { storage } from "../storage";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Authentication required" });
  }
  next();
}

// Role taxonomy used by requireRole below.
export type Role = "owner" | "manager" | "floor" | "office";

// Legacy values that existed before the four-role split. We map both to
// 'owner' so nobody who was using the app before this rollout suddenly
// loses access. Operators can downgrade individual users via the Team
// tab once the taxonomy is in place.
const LEGACY_ROLE_MAP: Record<string, Role> = {
  admin: "owner",
  member: "owner",
};

export function normalizeRole(stored: string | null | undefined): Role {
  if (!stored) return "owner"; // null/missing → grandfathered to full access
  if (stored === "owner" || stored === "manager" || stored === "floor" || stored === "office") {
    return stored;
  }
  return LEGACY_ROLE_MAP[stored] ?? "owner";
}

/**
 * Gate a route to one or more roles. Always pair after requireAuth.
 *   app.post("/api/inventory/writeoff", requireAuth, requireRole("owner", "manager"), handler)
 *
 * 'owner' is implicitly allowed for every requireRole call, so passing
 * `requireRole("manager")` still admits owners — managers and owners can
 * both perform manager-level actions.
 */
export function requireRole(...allowed: Role[]) {
  const allowSet = new Set<Role>(allowed);
  // Owner is implicitly allowed for every gate.
  allowSet.add("owner");
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Authentication required" });
    }
    try {
      const user = await storage.getUser(req.session.userId);
      const role = normalizeRole((user as any)?.role);
      if (!allowSet.has(role)) {
        return res.status(403).json({
          error: `Permission denied — this action requires role: ${Array.from(allowSet).join(" or ")}`,
        });
      }
      next();
    } catch (err: any) {
      console.error("[requireRole] lookup failed:", err?.message ?? err);
      return res.status(500).json({ error: "Permission check failed" });
    }
  };
}
