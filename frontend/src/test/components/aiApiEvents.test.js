import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../api/client", () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));

import client from "../../api/client";
import { saveAISettings, toggleAI, toggleAIFeature, getAIStatus, getAISettings, AI_SETTINGS_CHANGED } from "../../api/ai";

describe("AI api: telling the top-bar badge that settings changed", () => {
  let fired;
  beforeEach(() => {
    vi.clearAllMocks();
    fired = 0;
    window.addEventListener(AI_SETTINGS_CHANGED, () => { fired += 1; });
  });

  it("fires after saving, toggling and toggling a feature — and still returns the response", async () => {
    client.post.mockResolvedValue({ data: { saved: true } });
    client.patch.mockResolvedValue({ data: { ok: true } });
    expect((await saveAISettings({ aiEnabled: true })).data).toEqual({ saved: true });
    expect((await toggleAI(false)).data).toEqual({ ok: true });
    await toggleAIFeature("task-assistant");
    expect(fired).toBe(3);
    expect(client.patch).toHaveBeenCalledWith("/ai/settings/toggle", { enabled: false });
    expect(client.patch).toHaveBeenCalledWith("/ai/settings/features/task-assistant");
  });

  it("does not fire when the change fails", async () => {
    client.post.mockRejectedValue(new Error("403"));
    await expect(saveAISettings({})).rejects.toThrow("403");
    expect(fired).toBe(0);
  });

  it("reading status or settings never fires it, and status uses the key-free endpoint", async () => {
    client.get.mockResolvedValue({ data: {} });
    await getAIStatus();
    await getAISettings();
    expect(fired).toBe(0);
    expect(client.get).toHaveBeenCalledWith("/ai/status");
  });
});
