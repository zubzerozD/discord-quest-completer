// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QUEST_DURATION_MS } from "./questTimer";
import { useQuestTimer } from "./useQuestTimer";

describe("useQuestTimer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("label is null for a game with no timer", () => {
    const timer = useQuestTimer(() => {});
    expect(timer.label("g1")).toBeNull();
    timer.dispose();
  });

  it("counts down from 15:10 while running", () => {
    const timer = useQuestTimer(() => {});
    timer.start("g1");
    expect(timer.label("g1")).toBe("15:10");

    vi.advanceTimersByTime(61_000); // ticks fire every 250ms
    expect(timer.label("g1")).toBe("14:09");
    timer.dispose();
  });

  it("fires onExpire exactly once at the deadline, never again", () => {
    const onExpire = vi.fn();
    const timer = useQuestTimer(onExpire);
    timer.start("g1");

    vi.advanceTimersByTime(QUEST_DURATION_MS + 2_000);
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(onExpire).toHaveBeenCalledWith("g1");

    vi.advanceTimersByTime(5 * 60_000); // tab stays open after expiry
    expect(onExpire).toHaveBeenCalledTimes(1);
    timer.dispose();
  });

  it("stop clears the label and prevents expiry (user stopped early)", () => {
    const onExpire = vi.fn();
    const timer = useQuestTimer(onExpire);
    timer.start("g1");
    timer.stop("g1");

    expect(timer.label("g1")).toBeNull();
    vi.advanceTimersByTime(QUEST_DURATION_MS + 2_000);
    expect(onExpire).not.toHaveBeenCalled();
    timer.dispose();
  });

  it("restarting resets the full duration", () => {
    const onExpire = vi.fn();
    const timer = useQuestTimer(onExpire);
    timer.start("g1");
    vi.advanceTimersByTime(10 * 60_000);
    expect(timer.label("g1")).toBe("05:10");

    timer.start("g1"); // play again: fresh full duration
    expect(timer.label("g1")).toBe("15:10");
    vi.advanceTimersByTime(10 * 60_000);
    expect(onExpire).not.toHaveBeenCalled(); // first deadline was replaced
    timer.dispose();
  });

  it("tracks deadlines independently per game", () => {
    const onExpire = vi.fn();
    const timer = useQuestTimer(onExpire);
    timer.start("a");
    vi.advanceTimersByTime(60_000);
    timer.start("b");

    expect(timer.label("a")).toBe("14:10");
    expect(timer.label("b")).toBe("15:10");
    timer.dispose();
  });

  it("dispose stops the interval (no expiry after teardown)", () => {
    const onExpire = vi.fn();
    const timer = useQuestTimer(onExpire);
    timer.start("g1");
    timer.dispose();

    vi.advanceTimersByTime(QUEST_DURATION_MS + 2_000);
    expect(onExpire).not.toHaveBeenCalled();
  });
});
