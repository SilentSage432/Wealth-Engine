/**
 * Privacy-safe build label for Data & Cloud.
 * Inlined at build time from VERCEL_GIT_COMMIT_SHA when that metadata exists.
 * Not part of the vault, backup, or fingerprint.
 */

const SHA = /^[0-9a-f]{7,40}$/i;

export function wealthEngineBuildLabel(): string {
  const raw = process.env.NEXT_PUBLIC_WE_BUILD_REF?.trim() ?? "";
  if (!SHA.test(raw)) return "Build: unavailable";
  return `Build: ${raw.slice(0, 7)}`;
}
