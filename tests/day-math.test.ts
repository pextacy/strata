import { describe, expect, it } from "vitest";
import { currentDay, dayEnd, dayProgress, dayStart, isDayOpen, padDay } from "../src/core/day-math.ts";
import { DAY_DURATION, DAY_ONE_START } from "../src/core/constants.ts";

describe("currentDay", () => {
  it("matches the three anchors in DOCS.md §2", () => {
    expect(currentDay(DAY_ONE_START)).toBe(1);
    expect(currentDay(DAY_ONE_START + 86399)).toBe(1);
    expect(currentDay(DAY_ONE_START + 86400)).toBe(2);
  });

  it("round-trips against dayStart", () => {
    for (const day of [1, 2, 365, 366, 500, 1000, 4242]) {
      expect(currentDay(dayStart(day))).toBe(day);
      expect(currentDay(dayEnd(day) - 1)).toBe(day);
      expect(currentDay(dayEnd(day))).toBe(day + 1);
    }
  });
});

describe("dayStart / dayEnd", () => {
  it("spans exactly one day", () => {
    expect(dayEnd(742) - dayStart(742)).toBe(DAY_DURATION);
  });

  it("puts day 1 at the epoch anchor", () => {
    expect(dayStart(1)).toBe(DAY_ONE_START);
  });
});

describe("isDayOpen", () => {
  it("is true only inside the window", () => {
    expect(isDayOpen(500, dayStart(500))).toBe(true);
    expect(isDayOpen(500, dayEnd(500) - 1)).toBe(true);
    expect(isDayOpen(500, dayEnd(500))).toBe(false);
    expect(isDayOpen(500, dayStart(500) - 1)).toBe(false);
  });
});

describe("dayProgress", () => {
  it("clamps outside the day", () => {
    expect(dayProgress(500, dayStart(500) - 10_000)).toBe(0);
    expect(dayProgress(500, dayEnd(500) + 10_000)).toBe(1);
    expect(dayProgress(500, dayStart(500) + DAY_DURATION / 2)).toBeCloseTo(0.5);
  });
});

describe("padDay", () => {
  it("pads to four digits for the artwork URL", () => {
    expect(padDay(1)).toBe("0001");
    expect(padDay(500)).toBe("0500");
    expect(padDay(10_000)).toBe("10000");
  });
});
