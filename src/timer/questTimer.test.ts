import { describe, expect, it, vi } from "vitest";
import {
  formatCountdown,
  isComplete,
  questDeadline,
  QUEST_DURATION_MS,
  remainingMs,
} from "./questTimer";

const T0 = 1_700_000_000_000;

describe("QUEST_DURATION_MS", () => {
  it("is exactly 15 minutes", () => {
    expect(QUEST_DURATION_MS).toBe(15 * 60 * 1000);
  });

  it("honors a VITE_QUEST_DURATION_MS override for testing", async () => {
    vi.stubEnv("VITE_QUEST_DURATION_MS", "1000");
    vi.resetModules();
    const fresh = await import("./questTimer");
    expect(fresh.QUEST_DURATION_MS).toBe(1000);
    vi.unstubAllEnvs();
    vi.resetModules();
  });
});

describe("questDeadline", () => {
  it("adds the full quest duration to the start time", () => {
    expect(questDeadline(T0)).toBe(T0 + QUEST_DURATION_MS);
  });
});

describe("remainingMs", () => {
  it("returns the full duration at start", () => {
    expect(remainingMs(questDeadline(T0), T0)).toBe(QUEST_DURATION_MS);
  });

  it("counts down as time passes", () => {
    const deadline = questDeadline(T0);
    expect(remainingMs(deadline, T0 + 60_000)).toBe(QUEST_DURATION_MS - 60_000);
  });

  it("clamps at zero past the deadline", () => {
    const deadline = questDeadline(T0);
    expect(remainingMs(deadline, T0 + QUEST_DURATION_MS + 999)).toBe(0);
  });
});

describe("isComplete", () => {
  it("is false one millisecond before the deadline", () => {
    const deadline = questDeadline(T0);
    expect(isComplete(deadline, deadline - 1)).toBe(false);
  });

  it("is true at exactly the deadline", () => {
    const deadline = questDeadline(T0);
    expect(isComplete(deadline, deadline)).toBe(true);
  });

  it("stays true after the deadline", () => {
    const deadline = questDeadline(T0);
    expect(isComplete(deadline, deadline + 5 * 60_000)).toBe(true);
  });
});

describe("formatCountdown", () => {
  it("formats the full duration as 15:00", () => {
    expect(formatCountdown(QUEST_DURATION_MS)).toBe("15:00");
  });

  it("formats minutes and seconds with zero padding", () => {
    expect(formatCountdown(7 * 60_000 + 31_000)).toBe("07:31");
    expect(formatCountdown(59_000)).toBe("00:59");
  });

  it("formats zero and clamps negatives to 00:00", () => {
    expect(formatCountdown(0)).toBe("00:00");
    expect(formatCountdown(-5_000)).toBe("00:00");
  });

  it("truncates partial seconds (1.5s left shows 00:01, not 00:02)", () => {
    expect(formatCountdown(1_500)).toBe("00:01");
  });
});
