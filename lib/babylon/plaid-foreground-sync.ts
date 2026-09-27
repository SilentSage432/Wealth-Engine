/**
 * One foreground observation-sync cycle for the signed-in operator.
 *
 * The page remembers which Item ids were already requested. A re-render,
 * a list refetch, or a Strict Mode effect replay does not ask again.
 * Signing out clears that memory so the next signed-in list can ask once.
 */

const requestedItemIds = new Set<string>();
let initialReadyListSeen = false;

export function resetForegroundObservationSyncSession(): void {
  requestedItemIds.clear();
  initialReadyListSeen = false;
}

export function planForegroundObservationSync(input: {
  authenticated: boolean;
  itemsReady: boolean;
  itemIds: readonly string[];
}): readonly string[] {
  if (!input.authenticated) {
    requestedItemIds.clear();
    initialReadyListSeen = false;
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

/**
 * The first ready Item list is covered by the visibility balance ask.
 * An Item that appears after that list is not. Signing out forgets the list.
 * An empty ready list still counts as the first list.
 */
export function itemIdsBeyondInitialReadyList(input: {
  authenticated: boolean;
  itemsReady: boolean;
  dueItemIds: readonly string[];
}): readonly string[] {
  if (!input.authenticated) {
    initialReadyListSeen = false;
    return [];
  }
  if (!input.itemsReady) return [];
  if (!initialReadyListSeen) {
    initialReadyListSeen = true;
    return [];
  }
  return input.dueItemIds.filter((id) => id.trim().length > 0);
}

export function startForegroundObservationSync(input: {
  authenticated: boolean;
  itemsReady: boolean;
  itemIds: readonly string[];
  request: (itemRowId: string) => void;
}): readonly string[] {
  const due = planForegroundObservationSync(input);
  for (const itemRowId of due) input.request(itemRowId);
  return due;
}
