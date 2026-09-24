import { describe, expect, it } from "vitest";
import {
  isDesktopViewport,
  TAILWIND_LG_MIN_PX,
} from "@/lib/babylon/layout-viewport";

describe("isDesktopViewport", () => {
  it("matches the Tailwind lg breakpoint", () => {
    expect(isDesktopViewport(TAILWIND_LG_MIN_PX - 1)).toBe(false);
    expect(isDesktopViewport(TAILWIND_LG_MIN_PX)).toBe(true);
    expect(isDesktopViewport(1440)).toBe(true);
  });
});
