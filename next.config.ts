import type { NextConfig } from "next";

/** Short git sha from the host build, or empty when that metadata is absent. */
function readBuildRef(): string {
  const raw = process.env.VERCEL_GIT_COMMIT_SHA?.trim() ?? "";
  if (!/^[0-9a-f]{7,40}$/i.test(raw)) return "";
  return raw.slice(0, 7);
}

const nextConfig: NextConfig = {
  serverExternalPackages: ["web-push"],
  env: {
    NEXT_PUBLIC_WE_BUILD_REF: readBuildRef(),
  },
};

export default nextConfig;
