import { describe, expect, it } from "vitest";
import { MOBILE_NAV_ITEMS, NAV_ITEMS } from "@/lib/babylon/constants";

describe("phone navigation", () => {
  it("lists Home, Budget, Ledger, and More", () => {
    expect(MOBILE_NAV_ITEMS.map((item) => item.id)).toEqual([
      "home",
      "budget",
      "ledger",
      "more",
    ]);
    expect(MOBILE_NAV_ITEMS.map((item) => item.label)).toEqual([
      "Home",
      "Budget",
      "Ledger",
      "More",
    ]);
  });

  it("keeps desktop navigation on Overview, Ledger, and Financial Guidance", () => {
    expect(NAV_ITEMS.map((item) => item.id)).toEqual([
      "overview",
      "ledgers",
      "wisdom",
    ]);
    expect(NAV_ITEMS.map((item) => item.label)).toEqual([
      "Overview",
      "Ledger",
      "Financial Guidance",
    ]);
  });
});
