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

describe("monthly plan Layer-2 conflict evidence", () => {
  const panel = readFileSync(
    "components/babylon/vault-maintenance-panel.tsx",
    "utf8"
  );
  const hook = readFileSync("hooks/useBabylonEngine.ts", "utf8");
  const semantic = readFileSync("lib/babylon/monthly-plan-semantic.ts", "utf8");
  const compareBlock = hook.slice(
    hook.indexOf("const compareConflictCopies"),
    hook.indexOf("const selectNav")
  );

  it("A–B: Layer-2 is rendered only from the conflict compare result", () => {
    expect(panel).toContain("<MonthlyPlanEvidence evidence={result.monthlyPlans} />");
    expect(panel).toContain('vaultSync.kind === "conflict" && onCompareConflictCopies');
    expect(compareBlock).toContain("classifyVaultMonthlyPlans");
    expect(compareBlock).toContain("getCloudVault");
  });

  it("C–H: month, revision, supersedes Yes/No, and relationship copy", () => {
    expect(semantic).toContain("September");
    expect(panel).toContain("Revision {evidence.local.revision}");
    expect(panel).toContain("Supersedes earlier plan:");
    expect(panel).toContain('? "Yes"');
    expect(panel).toContain(': "No"');
    expect(semantic).toContain(
      "These plans are for the same month and contain the same planning intent. Their record identities differ."
    );
    expect(semantic).toContain(
      "These plans are for the same month, but their planning intent differs."
    );
    expect(semantic).toContain(
      "These plans are for different months. Both may represent valid planning history."
    );
  });

  it("I: multiple unique plans are not pairwise matched", () => {
    expect(semantic).toContain('status: "multiple"');
    expect(panel).toContain(
      "Multiple unique monthly plans require further review."
    );
  });

  it("J–M: UI does not render plan ids, timestamps, amounts, or names", () => {
    const block = panel.slice(
      panel.indexOf("function MonthlyPlanEvidence"),
      panel.indexOf("function CollectionRows")
    );
    expect(block).not.toContain("categoryName");
    expect(block).not.toContain("creditor");
    expect(block).not.toContain("finalizedAt");
    expect(block).not.toContain("supersedesId");
    expect(block).not.toContain(".id");
    expect(block).not.toContain("plannedAmount");
    expect(block).not.toContain("remainingDebt");
  });

  it("N–R: compare path stays read-only and reports the fresh cloud revision", () => {
    expect(compareBlock).not.toContain("updateCloudVault");
    expect(compareBlock).not.toContain("applyVault");
    expect(compareBlock).not.toContain("savePersistedState");
    expect(compareBlock).not.toContain("pushActivity");
    expect(compareBlock).not.toContain("setVaultSync");
    expect(compareBlock).not.toContain("writeCloudSyncBaseline");
    expect(compareBlock).toContain("cloudRevision: read.revision");
    expect(semantic).not.toContain("getCloudVault");
    expect(semantic).not.toContain("localStorage");
  });
});
