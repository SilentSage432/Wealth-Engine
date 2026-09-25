/**
 * Local binding between a future synchronized vault and one Supabase user.
 * This key is not part of the financial vault and not part of a JSON backup.
 * Nothing in the sign-in path writes it. WE-SYNC-003 sets it only on an
 * explicit bootstrap.
 */

import { isUuid } from "@/lib/babylon/cloud-mappers";

export const CLOUD_OWNER_STORAGE_KEY = "wealth-engine-cloud-owner";

export type CloudOwnerStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

function browserStore(): CloudOwnerStore | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

/** The bound Supabase user id, or null when this device has not been bound. */
export function readCloudOwnerId(
  store: CloudOwnerStore | null = browserStore()
): string | null {
  if (!store) return null;
  try {
    const value = store.getItem(CLOUD_OWNER_STORAGE_KEY);
    return isUuid(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Record the owner explicitly. Returns false for a non-UUID.
 * Callers must not use this during ordinary sign-in.
 */
export function bindCloudOwnerId(
  userId: string,
  store: CloudOwnerStore | null = browserStore()
): boolean {
  if (!isUuid(userId) || !store) return false;
  try {
    store.setItem(CLOUD_OWNER_STORAGE_KEY, userId);
    return true;
  } catch {
    return false;
  }
}
