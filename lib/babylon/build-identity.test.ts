import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { wealthEngineBuildLabel } from "@/lib/babylon/build-identity";

describe("wealth engine build identity", () => {
  const previous = process.env.NEXT_PUBLIC_WE_BUILD_REF;

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.NEXT_PUBLIC_WE_BUILD_REF;
    } else {
      process.env.NEXT_PUBLIC_WE_BUILD_REF = previous;
    }
  });

  it("uses a short sha when build metadata is present", () => {
    process.env.NEXT_PUBLIC_WE_BUILD_REF = "33f9c8eb0338c8f715184e6d7f1031a9b39ae62a";
    expect(wealthEngineBuildLabel()).toBe("Build: 33f9c8e");
  });

  it("says unavailable when metadata is absent or not a sha", () => {
    delete process.env.NEXT_PUBLIC_WE_BUILD_REF;
    expect(wealthEngineBuildLabel()).toBe("Build: unavailable");
    process.env.NEXT_PUBLIC_WE_BUILD_REF = "not-a-commit";
    expect(wealthEngineBuildLabel()).toBe("Build: unavailable");
  });

  it("is not persisted, fingerprinted, or wired into sync state", () => {
    const source = readFileSync("lib/babylon/build-identity.ts", "utf8");
    const cloud = readFileSync("lib/babylon/cloud-vault.ts", "utf8");
    const persistence = readFileSync("lib/babylon/persistence.ts", "utf8");
    const panel = readFileSync(
      "components/babylon/vault-maintenance-panel.tsx",
      "utf8"
    );
    const config = readFileSync("next.config.ts", "utf8");
    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("financialVaultFingerprint");
    expect(cloud).not.toContain("NEXT_PUBLIC_WE_BUILD_REF");
    expect(cloud).not.toContain("wealthEngineBuildLabel");
    expect(persistence).not.toContain("wealthEngineBuildLabel");
    expect(panel).toContain("wealthEngineBuildLabel()");
    expect(panel).not.toContain("setVaultSync");
    expect(config).toContain("VERCEL_GIT_COMMIT_SHA");
    expect(config).not.toContain("33f9c8e");
  });
});
