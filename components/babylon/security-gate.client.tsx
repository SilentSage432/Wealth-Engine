"use client";

import dynamic from "next/dynamic";
import { VaultLoading } from "@/components/babylon/vault-loading";

/**
 * Client-only SecurityGate mount — never SSR.
 * Prevents WebAuthn / storage / crypto paths from participating in the
 * server render or hydrating into a stuck "Opening the vault..." state.
 */
export const SecurityGate = dynamic(
  () =>
    import("@/components/babylon/security-gate").then((mod) => mod.SecurityGate),
  {
    ssr: false,
    loading: () => <VaultLoading />,
  }
);
