/**
 * Discreet Mode — presentation masks monetary values.
 * Preference persistence is Application-owned; this module owns the mask contract.
 */

export const DISCREET_MASK = "••••••";
export const DISCREET_STORAGE_KEY = "babylon_discreet_mode";

export function formatDiscreetCurrency(
  value: number,
  discreet: boolean,
  format: (n: number) => string
): string {
  if (discreet) return DISCREET_MASK;
  return format(value);
}
