/**
 * Finance PIN lock — gates the financials + compensation surfaces behind a per-session
 * unlock. SBR's warehouse/ops staff share the owner login, so role-gating alone can't
 * hide pay; this adds a second secret (the FINANCE_PIN) that only owners know.
 *
 * The PIN lives ONLY in the FINANCE_PIN environment variable (Railway) — never in the
 * database, never sent to the client. The client posts an attempt to /api/finance-lock/
 * unlock; the server compares it constant-time and, on success, flags the session.
 *
 * Dormant until configured: if FINANCE_PIN is unset the lock is OFF and finances are
 * open (paused). Setting FINANCE_PIN in Railway activates the lock for every session.
 */
import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";

/** True when a finance PIN of reasonable length is configured. */
export function financePinConfigured(): boolean {
  const p = process.env.FINANCE_PIN;
  return typeof p === "string" && p.length >= 4;
}

/** Constant-time compare of an attempt against the configured PIN. */
export function verifyFinancePin(pin: unknown): boolean {
  const secret = process.env.FINANCE_PIN || "";
  if (!secret || typeof pin !== "string" || pin.length === 0) return false;
  const a = Buffer.from(pin, "utf8");
  const b = Buffer.from(secret, "utf8");
  if (a.length !== b.length) return false; // length differs → not a match
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Whether this session has unlocked finances. */
export function financeUnlocked(req: Request): boolean {
  return !!(req.session && (req.session as any).financeUnlocked === true);
}

/** Middleware: block finance routes unless the session is unlocked (and a PIN exists). */
export function requireFinanceUnlock(req: Request, res: Response, next: NextFunction) {
  // Paused: with no FINANCE_PIN configured the lock is dormant (open). Setting
  // FINANCE_PIN in Railway activates it; after that, sessions must unlock to pass.
  if (!financePinConfigured()) return next();
  if (financeUnlocked(req)) return next();
  return res.status(423).json({
    success: false, locked: true, configured: true,
    error: "Finance access is locked. Enter the finance PIN to continue.",
  });
}
