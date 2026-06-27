import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteDiscordMessage,
  postChannelMessage,
  postRecruitMessage,
  updateDiscordMessage,
} from "../../../../src/features/discord";
import type { Env } from "../../../../src/lib/types";

const buildEnv = (token: string): Env => ({
  DISCORD_PUBLIC_KEY: "test-public-key",
  DISCORD_BOT_TOKEN: token,
  DISCORD_APPLICATION_ID: "test-app-id",
  HENRIKDEV_API_KEY: "test-riot-key",
  DB: {
    prepare: vi.fn(),
    batch: vi.fn(),
    exec: vi.fn(),
    withSession: vi.fn(),
    dump: vi.fn(),
  },
});

const getRequestBody = (mockFetch: ReturnType<typeof vi.fn>): string => {
  const call = mockFetch.mock.calls[0];
  if (!call) {
    throw new Error("Expected fetch to be called");
  }
  const body = call[1]?.body;
  if (typeof body !== "string") {
    throw new Error("Expected request body to be a string");
  }
  return body;
};

describe("Discord API Client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("postChannelMessage", () => {
    it("should send POST request with correct payload structure", async () => {
      const mockFetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: "msg-123" }),
        } as Response),
      );
      globalThis.fetch = mockFetch;

      const mockEnv = buildEnv("test-token");

      await postChannelMessage(mockEnv, "ch-123", "Test message");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://discord.com/api/v10/channels/ch-123/messages",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bot test-token",
          },
          body: JSON.stringify({
            content: "Test message",
            allowed_mentions: { parse: [] },
          }),
        },
      );
    });

    it("should throw error on 400 Bad Request", async () => {
      const mockFetch = vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 400,
          text: () => Promise.resolve("Bad Request"),
        } as Response),
      );
      globalThis.fetch = mockFetch;

      const mockEnv = buildEnv("test-token");

      await expect(postChannelMessage(mockEnv, "ch-123", "Test message")).rejects.toThrow(
        "Discord API error: 400 Bad Request",
      );
    });

    it("should throw error on 401 Unauthorized", async () => {
      const mockFetch = vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 401,
          text: () => Promise.resolve("Unauthorized"),
        } as Response),
      );
      globalThis.fetch = mockFetch;

      const mockEnv = buildEnv("invalid-token");

      await expect(postChannelMessage(mockEnv, "ch-123", "Test message")).rejects.toThrow(
        "Discord API error: 401 Unauthorized",
      );
    });

    it("should throw error on 429 Rate Limit", async () => {
      const mockFetch = vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 429,
          text: () => Promise.resolve("Rate Limited"),
        } as Response),
      );
      globalThis.fetch = mockFetch;

      const mockEnv = buildEnv("test-token");

      await expect(postChannelMessage(mockEnv, "ch-123", "Test message")).rejects.toThrow(
        "Discord API error: 429 Rate Limited",
      );
    });

    it("should throw error on 500 Internal Server Error", async () => {
      const mockFetch = vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 500,
          text: () => Promise.resolve("Internal Server Error"),
        } as Response),
      );
      globalThis.fetch = mockFetch;

      const mockEnv = buildEnv("test-token");

      await expect(postChannelMessage(mockEnv, "ch-123", "Test message")).rejects.toThrow(
        "Discord API error: 500 Internal Server Error",
      );
    });
  });

  describe("deleteDiscordMessage", () => {
    it("should send DELETE request with correct headers", async () => {
      const mockFetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 204,
        } as Response),
      );
      globalThis.fetch = mockFetch;

      const mockEnv = buildEnv("test-token");

      await deleteDiscordMessage(mockEnv, "ch-123", "msg-456");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://discord.com/api/v10/channels/ch-123/messages/msg-456",
        {
          method: "DELETE",
          headers: {
            Authorization: "Bot test-token",
          },
        },
      );
    });

    it("should throw error on 404 Not Found", async () => {
      const mockFetch = vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 404,
          text: () => Promise.resolve("Not Found"),
        } as Response),
      );
      globalThis.fetch = mockFetch;

      const mockEnv = buildEnv("test-token");

      await expect(deleteDiscordMessage(mockEnv, "ch-123", "msg-456")).rejects.toThrow(
        "Discord API error: 404 Not Found",
      );
    });

    it("should throw error on 403 Forbidden", async () => {
      const mockFetch = vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 403,
          text: () => Promise.resolve("Forbidden"),
        } as Response),
      );
      globalThis.fetch = mockFetch;

      const mockEnv = buildEnv("test-token");

      await expect(deleteDiscordMessage(mockEnv, "ch-123", "msg-456")).rejects.toThrow(
        "Discord API error: 403 Forbidden",
      );
    });
  });

  describe("updateDiscordMessage", () => {
    it("should send PATCH request with embed structure", async () => {
      const mockFetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
        } as Response),
      );
      globalThis.fetch = mockFetch;

      const mockEnv = buildEnv("test-token");

      await updateDiscordMessage(mockEnv, "ch-123", "msg-456", {
        targetDateLocal: "2026-01-18",
        postTimeHHmm: "20:00",
        status: "open",
        confirmedCount: 3,
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://discord.com/api/v10/channels/ch-123/messages/msg-456",
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bot test-token",
          },
          body: expect.stringContaining('"embeds"'),
        },
      );
    });

    it("should format timezone in embed", async () => {
      const mockFetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
        } as Response),
      );
      globalThis.fetch = mockFetch;

      const mockEnv = buildEnv("test-token");

      await updateDiscordMessage(mockEnv, "ch-123", "msg-456", {
        targetDateLocal: "2026-01-18",
        postTimeHHmm: "20:00",
        status: "matched",
        confirmedCount: 5,
        matchedMembers: ["user1", "user2", "user3", "user4", "user5"],
        matchedTime: "21:00",
        timezone: "Asia/Tokyo",
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const callArgs = JSON.parse(getRequestBody(mockFetch));
      expect(callArgs.embeds).toBeDefined();
    });

    it("should clear components when status is cancelled (terminal)", async () => {
      const mockFetch = vi.fn(() => Promise.resolve({ ok: true, status: 200 } as Response));
      globalThis.fetch = mockFetch;
      const mockEnv = buildEnv("test-token");

      await updateDiscordMessage(mockEnv, "ch-123", "msg-456", {
        targetDateLocal: "2026-01-18",
        postTimeHHmm: "20:00",
        status: "cancelled",
        confirmedCount: 0,
      });

      const callArgs = JSON.parse(getRequestBody(mockFetch));
      // クローズ時はボタンを除去するため components: [] を含める
      expect(callArgs.components).toEqual([]);
    });

    it("should clear components when status is deleted (terminal)", async () => {
      const mockFetch = vi.fn(() => Promise.resolve({ ok: true, status: 200 } as Response));
      globalThis.fetch = mockFetch;
      const mockEnv = buildEnv("test-token");

      await updateDiscordMessage(mockEnv, "ch-123", "msg-456", {
        targetDateLocal: "2026-01-18",
        postTimeHHmm: "20:00",
        status: "deleted",
        confirmedCount: 0,
      });

      const callArgs = JSON.parse(getRequestBody(mockFetch));
      expect(callArgs.components).toEqual([]);
    });

    it("should NOT include components for active statuses (open/matched)", async () => {
      const mockFetch = vi.fn(() => Promise.resolve({ ok: true, status: 200 } as Response));
      globalThis.fetch = mockFetch;
      const mockEnv = buildEnv("test-token");

      await updateDiscordMessage(mockEnv, "ch-123", "msg-456", {
        targetDateLocal: "2026-01-18",
        postTimeHHmm: "20:00",
        status: "open",
        confirmedCount: 1,
      });

      const callArgs = JSON.parse(getRequestBody(mockFetch));
      // open はまだ参加可能なのでボタンを残す（components キー自体を送らない）
      expect(callArgs.components).toBeUndefined();
    });
  });

  describe("postRecruitMessage", () => {
    it("should use template when provided", async () => {
      const mockFetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: "msg-123" }),
        } as Response),
      );
      globalThis.fetch = mockFetch;

      const mockEnv = buildEnv("test-token");

      await postRecruitMessage(mockEnv, "ch-123", {
        recruitId: "recruit-1",
        targetDateLocal: "2026-01-18",
        postTimeHHmm: "20:00",
        template: "Custom template",
        intervalMin: 30,
        durationMin: 360,
        timezone: "Asia/Tokyo",
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const callArgs = JSON.parse(getRequestBody(mockFetch));
      expect(callArgs.content).toBe("Custom template");
    });

    it("should use default content when template is empty", async () => {
      const mockFetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: "msg-123" }),
        } as Response),
      );
      globalThis.fetch = mockFetch;

      const mockEnv = buildEnv("test-token");

      await postRecruitMessage(mockEnv, "ch-123", {
        recruitId: "recruit-1",
        targetDateLocal: "2026-01-18",
        postTimeHHmm: "20:00",
        template: "",
        intervalMin: 30,
        durationMin: 360,
        timezone: "Asia/Tokyo",
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const callArgs = JSON.parse(getRequestBody(mockFetch));
      expect(callArgs.content).toBe("【募集】2026-01-18 20:00");
    });

    it("should include party size select, time select, and register/cancel buttons", async () => {
      const mockFetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: "msg-123" }),
        } as Response),
      );
      globalThis.fetch = mockFetch;

      const mockEnv = buildEnv("test-token");

      await postRecruitMessage(mockEnv, "ch-123", {
        recruitId: "recruit-1",
        targetDateLocal: "2026-01-18",
        postTimeHHmm: "20:00",
        template: "",
        intervalMin: 30,
        durationMin: 360,
        timezone: "Asia/Tokyo",
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const callArgs = JSON.parse(getRequestBody(mockFetch));
      expect(callArgs.components).toBeDefined();
      // 1行目: 希望パーティサイズ select / 2行目: 希望時間 select / 3行目: 登録・キャンセル button
      expect(callArgs.components).toHaveLength(3);

      // 1行目: party size select（3 候補）
      const partySizeSelect = callArgs.components[0].components[0];
      expect(partySizeSelect.type).toBe(3); // StringSelect
      expect(partySizeSelect.custom_id).toBe("recruit:party_size:recruit-1");
      expect(partySizeSelect.options).toHaveLength(3);

      // 2行目: time select（buildTimeOptions 件数 = 360/30 + 1 = 13）
      const timeSelect = callArgs.components[1].components[0];
      expect(timeSelect.type).toBe(3);
      expect(timeSelect.custom_id).toBe("recruit:time:recruit-1");
      expect(timeSelect.options).toHaveLength(13);
      // ISO value（HH:mm 自由入力ではない）を送る
      expect(timeSelect.options[0].value).toMatch(/T\d{2}:\d{2}/);

      // 3行目: 登録・更新 / キャンセル button
      const buttonRow = callArgs.components[2].components;
      expect(buttonRow).toHaveLength(2);
      const registerButton = buttonRow[0];
      expect(registerButton.type).toBe(2); // Button
      expect(registerButton.style).toBe(1); // Primary
      expect(registerButton.label).toBe("登録・更新");
      expect(registerButton.custom_id).toBe("recruit:register:recruit-1");
      const cancelButton = buttonRow[1];
      expect(cancelButton.type).toBe(2);
      expect(cancelButton.label).toBe("キャンセル");
      expect(cancelButton.custom_id).toBe("recruit:cancel:recruit-1");

      const allCustomIds = callArgs.components.flatMap(
        (row: { components: { custom_id: string }[] }) => row.components.map((c) => c.custom_id),
      );
      // 「未定」option や旧 join/delete ボタンは存在しない
      expect(allCustomIds.some((id: string) => id.includes("recruit:join:"))).toBe(false);
      expect(allCustomIds.some((id: string) => id.includes("recruit:delete:"))).toBe(false);
      const partySizeOptionValues = partySizeSelect.options.map((o: { value: string }) => o.value);
      expect(partySizeOptionValues).not.toContain("undecided");
    });

    it("should return message ID", async () => {
      const mockFetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: "msg-returned-id" }),
        } as Response),
      );
      globalThis.fetch = mockFetch;

      const mockEnv = buildEnv("test-token");

      const messageId = await postRecruitMessage(mockEnv, "ch-123", {
        recruitId: "recruit-1",
        targetDateLocal: "2026-01-18",
        postTimeHHmm: "20:00",
        template: "",
        intervalMin: 30,
        durationMin: 360,
        timezone: "Asia/Tokyo",
      });

      expect(messageId).toBe("msg-returned-id");
    });
  });
});
