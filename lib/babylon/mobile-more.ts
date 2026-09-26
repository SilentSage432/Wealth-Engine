/**
 * Phone More composition. Group order only.
 * Cloud, backup, reset, and guidance behavior stay in the shared maintenance panel.
 */

export const PHONE_MORE_GROUPS = [
  "financial-setup",
  "connections",
  "guidance",
  "data-cloud",
  "danger-zone",
] as const;

export type PhoneMoreGroup = (typeof PHONE_MORE_GROUPS)[number];
