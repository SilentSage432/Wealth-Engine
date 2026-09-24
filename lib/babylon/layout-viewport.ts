/** Tailwind's default `lg` breakpoint. */
export const TAILWIND_LG_MIN_PX = 1024;

export const DESKTOP_LAYOUT_MEDIA_QUERY = `(min-width: ${TAILWIND_LG_MIN_PX}px)`;

/** True at the Tailwind `lg` breakpoint and above. */
export function isDesktopViewport(widthPx: number): boolean {
  return widthPx >= TAILWIND_LG_MIN_PX;
}
