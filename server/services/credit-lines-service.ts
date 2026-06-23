/**
 * CIPH.R Credit Lines — every card / LOC / loan in one place. Balances are synced
 * live from QuickBooks liability accounts; limit / APR / due day are registered
 * once by the operator (QB doesn't hold them). From those we derive available
 * credit, utilization, and the next due date.
 */
import { sql } from "drizzle-orm";
import { storage } from "../storage";
import { db } from "../db";
import { QuickBooksClient } from "./quickbooks-client";

const rows = (r: any) => r.rows || r;
const n = (v: any) => (v == null ? null : Number(v));

/** Map a QuickBooks account type to our line type. */
function lineType(qbType: string, name: string): string {
  if (/credit\s*card/i.test(qbType)) return "card";
  if (/line\s*of\s*credit|revolv/i.test(name) || /line\s*of\s*credit/i.test(qbType)) return "loc";
  if (/long\s*term|loan|note/i.test(qbType)) return "loan";
  return "liability";
}

/** Pull liability balances from QuickBooks and upsert into credit_lines (preserving manual fields). */
export async function syncCreditLineBalances(): Promise<{ synced: number; skipped?: string }> {
  const qbUserId = await storage.getConnectedQuickbooksUserId();
  if (!qbUserId) return { synced: 0, skipped: "QuickBooks not connected" };
  const client = new QuickBooksClient(storage, qbUserId);
  const accounts = await client.fetchCreditLineAccounts();
  if (!accounts.length) return { synced: 0, skipped: "no liability accounts returned" };

  let synced = 0;
  for (const a of accounts) {
    const t = lineType(a.type, a.name);
    await db.execute(sql`
      INSERT INTO credit_lines (name, type, qb_account_id, qb_account_name, balance, balance_synced_at)
      VALUES (${a.name}, ${t}, ${a.id}, ${a.name}, ${a.balance}, now())
      ON CONFLICT (qb_account_id) WHERE qb_account_id IS NOT NULL
      DO UPDATE SET balance = EXCLUDED.balance, qb_account_name = EXCLUDED.qb_account_name,
                    balance_synced_at = now(), updated_at = now()
    `).catch((e: any) => console.error(`[CreditLines] upsert ${a.name} failed:`, e?.message ?? e));
    synced++;
  }
  return { synced };
}

/** Next occurrence of a day-of-month from today (today counts), as YYYY-MM-DD in MT. */
function nextDue(dueDay: number | null): string | null {
  if (!dueDay || dueDay < 1 || dueDay > 31) return null;
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Denver" }));
  let y = now.getFullYear(), m = now.getMonth();
  if (now.getDate() > dueDay) { m += 1; if (m > 11) { m = 0; y += 1; } }
  const d = new Date(y, m, Math.min(dueDay, new Date(y, m + 1, 0).getDate()));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface CreditLine {
  id: string; name: string; type: string; qbAccountName: string | null;
  balance: number; creditLimit: number | null; apr: number | null;
  available: number | null; utilization: number | null;
  dueDay: number | null; nextDue: string | null; highUtilization: boolean;
  balanceSyncedAt: string | null;
}

export async function computeCreditLines(): Promise<{
  lines: CreditLine[];
  totals: { totalBalance: number; totalLimit: number | null; totalAvailable: number | null; blendedUtilization: number | null; count: number };
}> {
  const rs = rows(await db.execute(sql`
    SELECT id, name, type, qb_account_name, balance, credit_limit, apr, due_day, balance_synced_at
    FROM credit_lines
    WHERE COALESCE(is_active, true) = true
    ORDER BY balance DESC NULLS LAST`));

  const lines: CreditLine[] = rs.map((r: any) => {
    const balance = Number(r.balance) || 0;
    const limit = n(r.credit_limit);
    const available = limit != null ? Math.max(0, Math.round((limit - balance) * 100) / 100) : null;
    const utilization = limit && limit > 0 ? Math.round((balance / limit) * 1000) / 10 : null;
    const dueDay = n(r.due_day);
    return {
      id: r.id, name: r.name, type: r.type, qbAccountName: r.qb_account_name,
      balance: Math.round(balance * 100) / 100, creditLimit: limit, apr: n(r.apr),
      available, utilization, dueDay, nextDue: nextDue(dueDay),
      highUtilization: utilization != null && utilization > 30,
      balanceSyncedAt: r.balance_synced_at ? new Date(r.balance_synced_at).toISOString() : null,
    };
  });

  const totalBalance = Math.round(lines.reduce((s, l) => s + l.balance, 0) * 100) / 100;
  const withLimit = lines.filter((l) => l.creditLimit != null);
  const totalLimit = withLimit.length ? Math.round(withLimit.reduce((s, l) => s + (l.creditLimit || 0), 0) * 100) / 100 : null;
  const totalAvailable = totalLimit != null ? Math.round((totalLimit - withLimit.reduce((s, l) => s + l.balance, 0)) * 100) / 100 : null;
  const blendedUtilization = totalLimit && totalLimit > 0 ? Math.round((withLimit.reduce((s, l) => s + l.balance, 0) / totalLimit) * 1000) / 10 : null;

  return { lines, totals: { totalBalance, totalLimit, totalAvailable, blendedUtilization, count: lines.length } };
}

/** Register/update the manual fields on a line (limit, APR, due day, name, type, active). */
export async function updateCreditLine(id: string, patch: Record<string, any>): Promise<void> {
  const sets: any[] = [];
  const allow: Record<string, string> = {
    creditLimit: "credit_limit", apr: "apr", dueDay: "due_day", statementDay: "statement_day",
    name: "name", type: "type", notes: "notes", isActive: "is_active",
  };
  for (const [k, col] of Object.entries(allow)) {
    if (patch[k] !== undefined) sets.push(sql`${sql.raw(col)} = ${patch[k]}`);
  }
  if (!sets.length) return;
  await db.execute(sql`UPDATE credit_lines SET ${sql.join(sets, sql`, `)}, updated_at = now() WHERE id = ${id}`);
}

/** Create a manual (non-QB) credit line. */
export async function createCreditLine(input: { name: string; type?: string; creditLimit?: number; apr?: number; dueDay?: number }): Promise<void> {
  await db.execute(sql`
    INSERT INTO credit_lines (name, type, credit_limit, apr, due_day)
    VALUES (${input.name}, ${input.type || "card"}, ${input.creditLimit ?? null}, ${input.apr ?? null}, ${input.dueDay ?? null})`);
}
