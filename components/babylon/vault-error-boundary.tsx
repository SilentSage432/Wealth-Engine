"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Landmark, Lock, Shield } from "lucide-react";

type VaultErrorBoundaryProps = {
  children: ReactNode;
  /** Optional recovery callback after reset. */
  onReset?: () => void;
  /**
   * Compact inline recovery (CommandBar / deck cards) instead of full-page vault recovery.
   */
  compact?: boolean;
};

type VaultErrorBoundaryState = {
  hasError: boolean;
  message: string | null;
};

/**
 * Presentation fail-soft shell — catches client crashes so the steward can recover
 * without a white screen.
 */
export class VaultErrorBoundary extends Component<
  VaultErrorBoundaryProps,
  VaultErrorBoundaryState
> {
  state: VaultErrorBoundaryState = { hasError: false, message: null };

  static getDerivedStateFromError(error: Error): VaultErrorBoundaryState {
    return {
      hasError: true,
      message:
        error?.message?.trim() ||
        "Something went wrong. You can continue safely.",
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[VaultErrorBoundary] client crash caught", error, info.componentStack);
  }

  private handleReset = () => {
    this.setState({ hasError: false, message: null });
    this.props.onReset?.();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    if (this.props.compact) {
      return (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={this.handleReset}
          aria-label="Retry bank link control"
          title={this.state.message ?? "Retry"}
          className="shrink-0"
        >
          <Landmark className="h-4 w-4 text-amber-300" aria-hidden="true" />
        </Button>
      );
    }

    return (
      <div className="relative min-h-dvh overflow-hidden bg-slate-950">
        <div
          className="pointer-events-none absolute inset-0 luxury-grid opacity-40 blur-sm"
          aria-hidden="true"
        />
        <div className="relative z-10 flex min-h-dvh items-center justify-center px-4 py-10">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950/90 p-6 shadow-2xl backdrop-blur-xl sm:p-8">
            <div className="mb-6 flex items-center gap-3">
              <div className="rounded-xl bg-rose-500/10 p-3 text-rose-300">
                <Shield className="h-6 w-6" aria-hidden="true" />
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Privacy Shield
                </p>
                <h1 className="font-[family-name:var(--font-display)] text-2xl text-slate-50">
                  Vault Recovery
                </h1>
              </div>
            </div>
            <p role="alert" className="mb-4 text-sm text-slate-400">
              {this.state.message}
            </p>
            <Button type="button" className="w-full" onClick={this.handleReset}>
              <Lock className="h-4 w-4" aria-hidden="true" />
              Continue with PIN
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
