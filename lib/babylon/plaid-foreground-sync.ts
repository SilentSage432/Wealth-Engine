/**
 * One foreground observation-sync cycle for the signed-in operator.
 *
 * The page remembers which Item ids were already requested. A re-render,
 * a list refetch, or a Strict Mode effect replay does not ask again.
 * Signing out clears that memory so the next signed-in list can ask once.
 */

const requestedItemIds = new Set<string>();

export function resetForegroundObservationSyncSession(): void {
  requestedItemIds.clear();
}

export function planForegroundObservationSync(input: {
  authenticated: boolean;
  itemsReady: boolean;
  itemIds: readonly string[];
}): readonly string[] {
  if (!input.authenticated) {
    requestedItemIds.clear();
    return [];
  }
  if (!input.itemsReady) return [];

  const due: string[] = [];
  for (const itemId of input.itemIds) {
    const id = itemId.trim();
    if (!id || requestedItemIds.has(id)) continue;
    requestedItemIds.add(id);
    due.push(id);
  }
  return due;
}

export function startForegroundObservationSync(input: {
  authenticated: boolean;
  itemsReady: boolean;
  itemIds: readonly string[];
  request: (itemRowId: string) => void;
}): readonly string[] {
  const due = planForegroundObservationSync(input);
  console.info(
    `[WE-ATTENTION-PROBE] op=foreground-plan requestCount=${due.length}`
  );
  for (const itemRowId of due) input.request(itemRowId);
  return due;
}
