import { describe, it, expect, vi, beforeEach } from "vitest";

// Replace the storage module entirely so importing the middleware never touches
// a real DB. requireRole's only dependency is storage.getUser.
const getUser = vi.fn();
vi.mock("../storage", () => ({ storage: { getUser: (...a: any[]) => getUser(...a) } }));

import { roleLevel, normalizeRole, requireRole } from "./auth";

function makeRes() {
  const res: any = { statusCode: 200 };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: any) => { res.body = b; return res; };
  return res;
}

// Run a requireRole middleware against a user with the given stored role.
async function run(gate: any, role: string | null | undefined) {
  getUser.mockResolvedValueOnce(role === undefined ? undefined : { id: "u1", role });
  const req: any = { session: { userId: "u1" } };
  const res = makeRes();
  let nexted = false;
  await gate(req, res, () => { nexted = true; });
  return { nexted, status: res.statusCode };
}

describe("roleLevel", () => {
  it("maps known roles by privilege (admin == owner)", () => {
    expect(roleLevel("owner")).toBe(4);
    expect(roleLevel("admin")).toBe(4);
    expect(roleLevel("manager")).toBe(3);
    expect(roleLevel("member")).toBe(2);
    expect(roleLevel("office")).toBe(2);
    expect(roleLevel("warehouse")).toBe(1);
    expect(roleLevel("floor")).toBe(1);
  });

  it("maps unknown/null/empty to 0 — least privilege, never grandfathered", () => {
    expect(roleLevel(null)).toBe(0);
    expect(roleLevel(undefined)).toBe(0);
    expect(roleLevel("")).toBe(0);
    expect(roleLevel("superuser")).toBe(0);
  });
});

describe("normalizeRole (display only, level-based)", () => {
  it("no longer falls back to owner for unknown roles", () => {
    expect(normalizeRole("admin")).toBe("owner");
    expect(normalizeRole("warehouse")).toBe("floor");
    expect(normalizeRole(null)).toBe("office"); // was 'owner' — the bug
    expect(normalizeRole("ghost")).toBe("office");
  });
});

describe("requireRole — the RBAC keystone", () => {
  beforeEach(() => getUser.mockReset());

  it("DENIES a warehouse user from an admin/owner gate (the core fix)", async () => {
    const r = await run(requireRole(["admin", "owner"]), "warehouse");
    expect(r.nexted).toBe(false);
    expect(r.status).toBe(403);
  });

  it("DENIES a null/unknown role from every gate (no grandfathering to access)", async () => {
    expect((await run(requireRole(["admin"]), null)).status).toBe(403);
    expect((await run(requireRole("manager"), "ghost")).status).toBe(403);
    expect((await run(requireRole(["admin"]), undefined)).status).toBe(403);
  });

  it("ALLOWS admin and owner through every gate", async () => {
    expect((await run(requireRole(["admin"]), "admin")).nexted).toBe(true);
    expect((await run(requireRole("manager"), "owner")).nexted).toBe(true);
    expect((await run(requireRole("manager"), "admin")).nexted).toBe(true);
  });

  it("admits a member to a member-level gate but blocks a manager gate", async () => {
    expect((await run(requireRole(["admin", "member"]), "member")).nexted).toBe(true);
    expect((await run(requireRole("manager"), "member")).status).toBe(403);
  });

  it("admits warehouse to the widened cycle-count gate", async () => {
    expect((await run(requireRole(["admin", "member", "warehouse"]), "warehouse")).nexted).toBe(true);
  });

  it("a gate naming only an unrecognized role still requires a real role (fail-safe, never level 0)", async () => {
    expect((await run(requireRole("bogus" as any), "warehouse")).nexted).toBe(true); // level 1 >= bar 1
    expect((await run(requireRole("bogus" as any), null)).status).toBe(403);
  });

  it("rejects when unauthenticated regardless of gate", async () => {
    const req: any = { session: {} };
    const res = makeRes();
    let nexted = false;
    await requireRole(["admin"])(req, res, () => { nexted = true; });
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(401);
  });
});
