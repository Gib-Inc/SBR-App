import { describe, expect, it } from "vitest";
import { summarizeTruthChecks, type TruthCheck } from "./finance-truth-audit-service";

const check = (severity: TruthCheck["severity"]): TruthCheck => ({
  id: severity,
  label: severity,
  severity,
  status: severity === "pass" ? "actual" : severity === "warn" ? "estimate" : "broken",
  source: "test",
  asOf: "2026-07-17T00:00:00.000Z",
  value: 1,
  detail: "test",
  nextAction: "test",
});

describe("summarizeTruthChecks", () => {
  it("allows narration only when every check passes", () => {
    expect(summarizeTruthChecks([check("pass"), check("pass")])).toEqual({
      overall: "pass",
      aiNumberPolicy: "allow_narration",
    });
  });

  it("allows narration with warnings when no blocking checks exist", () => {
    expect(summarizeTruthChecks([check("pass"), check("warn")])).toEqual({
      overall: "warn",
      aiNumberPolicy: "narrate_with_warnings",
    });
  });

  it("blocks unverified numbers when any check blocks", () => {
    expect(summarizeTruthChecks([check("warn"), check("block"), check("pass")])).toEqual({
      overall: "block",
      aiNumberPolicy: "block_unverified_numbers",
    });
  });
});
