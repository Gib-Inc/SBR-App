import { Request, Response, NextFunction } from "express";
import { storage } from "../storage";

/**
 * Role hierarchy:
 *   admin     — full access to everything
 *   member    — full access except destructive admin actions
 *   warehouse — limited to: production, inventory receiving, cycle counts, products (read-only)
 *
 * Usage:
 *   app.delete("/api/...", requireAuth, requireRole(["admin"]), handler)
 *   app.post("/api/...", requireAuth, requireRole(["admin", "member"]), handler)
 */
export function requireRole(allowedRoles: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Authentication required" });
    }
    try {
      const user = await storage.getUser(req.session.userId);
      if (!user) return res.status(401).json({ error: "User not found" });
      if (!allowedRoles.includes(user.role)) {
        return res.status(403).json({ error: `Access denied. Required role: ${allowedRoles.join(" or ")}` });
      }
      next();
    } catch (err) {
      res.status(500).json({ error: "Failed to verify role" });
    }
  };
}
