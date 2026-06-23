import { describe, it, expect } from "vitest";
import { classifyVariance } from "./stock-variance-service";

describe("classifyVariance", () => {
  it("flags a stale sellable counter (afs far below 3PL stock)", () => {
    // The Push 1.0 case: afs=0 while Pivot holds 137.
    const r = classifyVariance({ hildale: 86, pivot: 137, afs: 0 });
    expect(r.drift).toBe(137);
    expect(r.flag).toBe("AFS_STALE");
  });

  it("is OK when afs tracks the 3PL count closely", () => {
    const r = classifyVariance({ hildale: 20, pivot: 36, afs: 35 });
    expect(r.flag).toBe("OK");
  });

  it("flags afs running ahead of the 3PL (oversell / pending restock)", () => {
    const r = classifyVariance({ hildale: 0, pivot: 5, afs: 40 });
    expect(r.flag).toBe("AFS_AHEAD");
  });

  it("flags negative stock", () => {
    const r = classifyVariance({ hildale: 0, pivot: -1, afs: 0 });
    expect(r.flag).toBe("NEGATIVE");
  });

  it("ignores tiny gaps as noise", () => {
    const r = classifyVariance({ hildale: 10, pivot: 12, afs: 10 });
    expect(r.flag).toBe("OK");
  });
});
