import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("conflict copy comparison wiring", () => {
  const panel = readFileSync(
    "components/babylon/vault-maintenance-panel.tsx",
    "utf8"
  );
  const hook = readFileSync("hooks/useBabylonEngine.ts", "utf8");
  const dashboard = readFileSync(
    "components/babylon/wealth-engine-dashboard.tsx",
    "utf8"
  );
  const more = readFileSync("components/babylon/mobile-more.tsx", "utf8");
  const sidebar = readFileSync("components/babylon/app-sidebar.tsx", "utf8");
  const diff = readFileSync("lib/babylon/vault-structural-diff.ts", "utf8");

  it("A–B: Compare copies only for conflict (not clean)", () => {
    expect(panel).toContain('vaultSync.kind === "conflict" && onCompareConflictCopies');
    expect(panel).toContain("<ConflictCopyCompare");
    expect(panel).toContain("Compare copies");
    expect(panel).toContain("Compare preserved copies");
    expect(panel).not.toMatch(/kind === "clean"[\s\S]{0,120}onCompareConflictCopies/);
  });

  it("C–D: compare uses getCloudVault only; never updateCloudVault/CAS in compare path", () => {
    const compareBlock = hook.slice(
      hook.indexOf("const compareConflictCopies"),
      hook.indexOf("const selectNav")
    );
    expect(compareBlock).toContain("getCloudVault");
    expect(compareBlock).toContain("compareVaultStructure");
    expect(compareBlock).not.toContain("updateCloudVault");
    expect(compareBlock).not.toContain("compareAndSwap");
    expect(compareBlock).not.toContain("applyVault");
    expect(compareBlock).not.toContain("writeCloudSyncBaseline");
    expect(compareBlock).not.toContain("setVaultSync");
    expect(compareBlock).not.toContain("pushActivity");
    expect(compareBlock).not.toContain("savePersistedState");
  });

  it("E–I: conflict state / activity / local fingerprint not mutated by compare helper", () => {
    expect(diff).not.toContain("localStorage");
    expect(diff).not.toContain("getCloudVault");
    expect(diff).not.toContain("savePersistedState");
    expect(diff).not.toContain("setVaultSync");
  });

  it("J–L: wires compare through dashboard, sidebar, and phone More", () => {
    expect(dashboard).toContain(
      "onCompareConflictCopies={engine.compareConflictCopies}"
    );
    expect(sidebar).toContain("onCompareConflictCopies");
    expect(more).toContain("onCompareConflictCopies");
    expect(panel).toContain("{error}");
    expect(panel).toContain("Try again");
    expect(panel).toContain("Cloud revision");
    expect(hook).toContain("Couldn't compare copies right now.");
  });

  it("M: Layer-1 copy avoids winner language", () => {
    expect(panel).not.toContain("winner");
    expect(panel).not.toContain("correct copy");
    expect(panel).not.toContain("safe to overwrite");
    expect(panel).toContain("does not change either copy");
  });
});
