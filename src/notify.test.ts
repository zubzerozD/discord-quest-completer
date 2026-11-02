// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendNotification, isPermissionGranted, requestPermission } = vi.hoisted(
  () => ({
    sendNotification: vi.fn(),
    isPermissionGranted: vi.fn(),
    requestPermission: vi.fn(),
  }),
);

vi.mock("@tauri-apps/plugin-notification", () => ({
  sendNotification,
  isPermissionGranted,
  requestPermission,
}));

import { formatPlayedDuration, notifyQuestComplete } from "./notify";
import { QUEST_DURATION_MS } from "./timer/questTimer";

beforeEach(() => {
  vi.clearAllMocks();
  isPermissionGranted.mockResolvedValue(true);
  requestPermission.mockResolvedValue("denied");
});

describe("formatPlayedDuration", () => {
  it("says minutes for the production 15-minute timer", () => {
    expect(formatPlayedDuration(15 * 60 * 1000)).toBe("15 minutes");
  });

  it("says seconds for sub-minute probe durations", () => {
    // The dev probe runs with VITE_QUEST_DURATION_MS=8000; the notification
    // must not claim "15 minutes" when the timer was not 15 minutes.
    expect(formatPlayedDuration(8_000)).toBe("8 seconds");
  });
});

describe("notifyQuestComplete", () => {
  it("sends the real configured duration and the game name", async () => {
    await notifyQuestComplete("Project Arrhythmia");
    expect(sendNotification).toHaveBeenCalledTimes(1);
    const body = sendNotification.mock.calls[0][0].body as string;
    expect(body).toContain(formatPlayedDuration(QUEST_DURATION_MS));
    expect(body).toContain("Project Arrhythmia");
  });

  it("stays silent when permission is denied, without throwing", async () => {
    isPermissionGranted.mockResolvedValue(false);
    requestPermission.mockResolvedValue("denied");
    await expect(notifyQuestComplete("G")).resolves.toBeUndefined();
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("never throws when the plugin fails", async () => {
    isPermissionGranted.mockRejectedValue(new Error("plugin missing"));
    requestPermission.mockRejectedValue(new Error("plugin missing"));
    await expect(notifyQuestComplete("G")).resolves.toBeUndefined();
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
