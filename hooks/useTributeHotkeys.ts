"use client";

import { useEffect } from "react";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest("[contenteditable='true']"));
}

/**
 * Global Record Tribute hotkeys:
 * - `N` when focus is not in an editable field
 * - `Ctrl+N` / `Cmd+N` from anywhere in the app shell
 */
export function useTributeHotkeys(
  onOpenTribute: () => void,
  options?: { enabled?: boolean }
) {
  const enabled = options?.enabled !== false;

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (key !== "n") return;

      const chord = event.metaKey || event.ctrlKey;
      if (chord) {
        event.preventDefault();
        onOpenTribute();
        return;
      }

      if (event.altKey || event.shiftKey) return;
      if (isEditableTarget(event.target)) return;

      event.preventDefault();
      onOpenTribute();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, onOpenTribute]);
}
