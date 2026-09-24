"use client";

import { useSyncExternalStore } from "react";
import { DESKTOP_LAYOUT_MEDIA_QUERY } from "@/lib/babylon/layout-viewport";

function subscribe(onStoreChange: () => void) {
  const media = window.matchMedia(DESKTOP_LAYOUT_MEDIA_QUERY);
  media.addEventListener("change", onStoreChange);
  return () => media.removeEventListener("change", onStoreChange);
}

function getSnapshot() {
  return window.matchMedia(DESKTOP_LAYOUT_MEDIA_QUERY).matches;
}

/**
 * Server and the hydration render both report mobile.
 * `useSyncExternalStore` then applies the real matchMedia result,
 * and the change listener follows later resizes.
 */
function getServerSnapshot() {
  return false;
}

export function useDesktopLayout(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
