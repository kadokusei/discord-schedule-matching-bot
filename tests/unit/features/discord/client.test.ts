import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteDiscordMessage,
  postChannelMessage,
  postRecruitMessage,
  updateDiscordMessage,
} from "../../../../src/features/discord";

const buildEnv = (token: string): Env => ({
  DISCORD_PUBLIC_KEY: "test-public-key",
  DISCORD_BOT_TOKEN: token,
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
          body: JSON.stringify({ content: "Test message" }),
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
        pendingCount: 1,
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
        pendingCount: 0,
        matchedMembers: ["user1", "user2", "user3", "user4", "user5"],
        matchedTime: "21:00",
        timezone: "Asia/Tokyo",
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const callArgs = JSON.parse(getRequestBody(mockFetch));
      expect(callArgs.embeds).toBeDefined();
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
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const callArgs = JSON.parse(getRequestBody(mockFetch));
      expect(callArgs.content).toBe("【募集】2026-01-18 20:00");
    });

    it("should include components with join, cancel, and delete buttons", async () => {
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
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const callArgs = JSON.parse(getRequestBody(mockFetch));
      expect(callArgs.components).toBeDefined();
      expect(callArgs.components).toHaveLength(1);
      expect(callArgs.components[0].components).toHaveLength(3);
      expect(callArgs.components[0].components[0].custom_id).toContain("recruit:join:");
      expect(callArgs.components[0].components[1].custom_id).toContain("recruit:cancel:");
      expect(callArgs.components[0].components[2].custom_id).toContain("recruit:delete:");
      // Delete button should be Danger style (4)
      expect(callArgs.components[0].components[2].style).toBe(4);
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
      });

      expect(messageId).toBe("msg-returned-id");
    });
  });
});
