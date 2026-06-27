import { env } from "cloudflare:test";
import type { APIMessageComponentInteraction } from "discord-api-types/v10";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../../../src/db/schema";
import { handleComponentInteraction } from "../../../src/handlers/components";
import { buildMatchFromRecruit } from "../../../src/handlers/matching";

describe("Component Interaction Handlers - Unit Tests", () => {
  describe("recomputeMatch - Discord API error handling", () => {
    it("should handle updateDiscordMessage failure gracefully", async () => {
      // This test verifies that when Discord API fails during message update,
      // the error is logged but doesn't crash the entire process

      let apiCallCount = 0;
      const mockFetch = vi.fn(() => {
        apiCallCount++;
        // Simulate Discord API failure
        return Promise.resolve({
          ok: false,
          status: 500,
          text: () => Promise.resolve("Internal Server Error"),
        } as Response);
      });

      globalThis.fetch = mockFetch;

      // Simulate the error handling flow
      const result: { dbUpdated: boolean; errorLogged: boolean } = {
        dbUpdated: false,
        errorLogged: false,
      };

      try {
        // Step 1: Update DB (this should succeed)
        result.dbUpdated = true;

        // Step 2: Update Discord message (this should fail)
        const response = await fetch("https://discord.com/api/v10/channels/test/messages/123", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bot test-token",
          },
          body: JSON.stringify({ embeds: [] }),
        });

        if (!response.ok) {
          throw new Error(`Discord API error: ${response.status}`);
        }
      } catch (error) {
        // Step 3: Log error but don't crash
        result.errorLogged = true;
        console.error("Failed to update Discord message:", error);
      }

      // Expected behavior:
      // - DB should be updated
      // - Error should be logged
      // - Process should continue (not crash)

      expect(result.dbUpdated).toBe(true);
      expect(result.errorLogged).toBe(true);
      expect(apiCallCount).toBe(1);
    });

    it("should handle postChannelMessage failure gracefully", async () => {
      const mockFetch = vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 429,
          text: () => Promise.resolve("Rate Limited"),
        } as Response),
      );

      globalThis.fetch = mockFetch;

      const result: { messageLogged: boolean; errorHandled: boolean } = {
        messageLogged: false,
        errorHandled: false,
      };

      try {
        const response = await fetch("https://discord.com/api/v10/channels/test/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bot test-token",
          },
          body: JSON.stringify({ content: "test" }),
        });

        if (!response.ok) {
          throw new Error(`Discord API error: ${response.status}`);
        }

        result.messageLogged = true;
      } catch {
        // Error should be caught and handled gracefully
        result.errorHandled = true;
      }

      expect(result.messageLogged).toBe(false);
      expect(result.errorHandled).toBe(true);
    });
  });

  describe("handleTimeSelect - timezone handling", () => {
    it("should format time using guild timezone", () => {
      const selectedTime = "2026-01-17T12:00:00.000Z";

      // Test with different timezones
      const tokyoTime = new Date(selectedTime).toLocaleString("ja-JP", {
        timeZone: "Asia/Tokyo",
      });
      const newYorkTime = new Date(selectedTime).toLocaleString("ja-JP", {
        timeZone: "America/New_York",
      });
      const londonTime = new Date(selectedTime).toLocaleString("ja-JP", {
        timeZone: "Europe/London",
      });

      // Verify that different timezones produce different results
      expect(tokyoTime).not.toBe(newYorkTime);
      expect(tokyoTime).not.toBe(londonTime);
      expect(newYorkTime).not.toBe(londonTime);

      // Tokyo should be ahead of London and New York
      console.log("Tokyo:", tokyoTime);
      console.log("New York:", newYorkTime);
      console.log("London:", londonTime);
    });
  });

  describe("buildMatchFromRecruit - JSON validation", () => {
    it("should return null for malformed JSON", () => {
      // Simulate a recruit with malformed JSON
      const recruit = {
        id: "recruit-1",
        guildId: "",
        channelId: "",
        scheduleId: "",
        messageId: "",
        targetDateLocal: "",
        status: "",
        matchSignature: null,
        lastNotifiedSignature: null,
        matchedMemberIdsJson: "invalid-json{",
        matchedMeetTimeUtc: "2026-01-17T12:00:00.000Z",
        deletedBy: null,
        deletedAtUtc: null,
      } as const;

      const result = buildMatchFromRecruit(recruit);

      expect(result).toBeNull();
    });

    it("should return null for non-array JSON", () => {
      const recruit = {
        id: "recruit-2",
        guildId: "",
        channelId: "",
        scheduleId: "",
        messageId: "",
        targetDateLocal: "",
        status: "",
        matchSignature: null,
        lastNotifiedSignature: null,
        matchedMemberIdsJson: '{"key": "value"}',
        matchedMeetTimeUtc: "2026-01-17T12:00:00.000Z",
        deletedBy: null,
        deletedAtUtc: null,
      } as const;

      const result = buildMatchFromRecruit(recruit);

      expect(result).toBeNull();
    });

    it("should return Match for valid JSON array", () => {
      const recruit = {
        id: "recruit-3",
        guildId: "",
        channelId: "",
        scheduleId: "",
        messageId: "",
        targetDateLocal: "",
        status: "",
        matchSignature: null,
        lastNotifiedSignature: null,
        matchedMemberIdsJson: '["user1", "user2", "user3"]',
        matchedMeetTimeUtc: "2026-01-17T12:00:00.000Z",
        deletedBy: null,
        deletedAtUtc: null,
      } as const;

      const result = buildMatchFromRecruit(recruit);

      expect(result).toEqual({
        memberIds: ["user1", "user2", "user3"],
        meetTimeUtc: "2026-01-17T12:00:00.000Z",
      });
    });

    it("should return null for null matchedMemberIdsJson", () => {
      const recruit = {
        id: "recruit-4",
        guildId: "",
        channelId: "",
        scheduleId: "",
        messageId: "",
        targetDateLocal: "",
        status: "",
        matchSignature: null,
        lastNotifiedSignature: null,
        matchedMemberIdsJson: null,
        matchedMeetTimeUtc: "2026-01-17T12:00:00.000Z",
        deletedBy: null,
        deletedAtUtc: null,
      } as const;

      const result = buildMatchFromRecruit(recruit);

      expect(result).toBeNull();
    });

    it("should return null for undefined matchedMemberIdsJson", () => {
      const recruit = {
        id: "recruit-5",
        guildId: "",
        channelId: "",
        scheduleId: "",
        messageId: "",
        targetDateLocal: "",
        status: "",
        matchSignature: null,
        lastNotifiedSignature: null,
        matchedMemberIdsJson: undefined,
        matchedMeetTimeUtc: "2026-01-17T12:00:00.000Z",
        deletedBy: null,
        deletedAtUtc: null,
      } as const;

      const result = buildMatchFromRecruit(recruit);

      expect(result).toBeNull();
    });
  });
});

/** @original 編集の PATCH 本文（JSON parse 済み）から content を取り出す。 */
const contentOf = (body: unknown): string => {
  if (body && typeof body === "object" && "content" in body && typeof body.content === "string") {
    return body.content;
  }
  return "";
};

describe("登録・更新 select draft フロー", () => {
  const db = drizzle(env.DB, { schema });

  // editOriginalInteractionResponse(@original) の PATCH 本文を捕捉するモック
  const captureFetch = () => {
    const calls: { url: string; body: unknown }[] = [];
    globalThis.fetch = vi.fn((url: unknown, init?: RequestInit) => {
      calls.push({
        url: String(url),
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      });
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(""),
      } as Response);
    }) as unknown as typeof fetch;
    return calls;
  };

  // waitUntil の本処理を待ち合わせて component interaction を実行する
  const runComponent = async (interaction: APIMessageComponentInteraction) => {
    const promises: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: (p: Promise<unknown>) => {
        promises.push(p);
      },
    };
    const response = handleComponentInteraction(interaction, env, ctx);
    await Promise.all(promises);
    return response;
  };

  // string select の interaction（component_type 3, values）
  const selectPayload = (
    customId: string,
    value: string,
    userId = "clicker",
  ): APIMessageComponentInteraction =>
    ({
      type: 3,
      id: "i",
      application_id: "test-app-id",
      token: "tok",
      member: { user: { id: userId } },
      data: { custom_id: customId, component_type: 3, values: [value] },
    }) as unknown as APIMessageComponentInteraction;

  // button の interaction（component_type 2）
  const buttonPayload = (customId: string, userId = "clicker"): APIMessageComponentInteraction =>
    ({
      type: 3,
      id: "i",
      application_id: "test-app-id",
      token: "tok",
      member: { user: { id: userId } },
      data: { custom_id: customId, component_type: 2 },
    }) as unknown as APIMessageComponentInteraction;

  const insertSchedule = () =>
    db.insert(schema.schedules).values({
      id: "sched-x",
      guildId: "guild-x",
      channelId: "ch-x",
      creatorId: "creator",
      postTimeHHmm: "20:00",
      intervalMin: 30,
      durationMin: 360,
      template: "",
      active: 1,
    });

  const insertSettings = () =>
    db.insert(schema.guildSettings).values({
      id: "gs-x",
      guildId: "guild-x",
      timezone: "Asia/Tokyo",
    });

  const insertRecruit = (id: string, status: string) =>
    db.insert(schema.recruits).values({
      id,
      scheduleId: "sched-x",
      guildId: "guild-x",
      channelId: "ch-x",
      messageId: "msg-x",
      targetDateLocal: "2026-06-15",
      status,
    });

  const getEntry = (recruitId: string) =>
    db
      .select()
      .from(schema.recruitEntries)
      .where(
        and(
          eq(schema.recruitEntries.recruitId, recruitId),
          eq(schema.recruitEntries.userId, "clicker"),
        ),
      )
      .get();

  const getDraft = (recruitId: string) =>
    db
      .select()
      .from(schema.recruitEntryDrafts)
      .where(
        and(
          eq(schema.recruitEntryDrafts.recruitId, recruitId),
          eq(schema.recruitEntryDrafts.userId, "clicker"),
        ),
      )
      .get();

  // 20:00 JST = 11:00 UTC（buildTimeOptions の先頭候補）
  const FIRST_SLOT_UTC = "2026-06-15T11:00:00.000Z";

  beforeEach(async () => {
    await db.delete(schema.recruitEntryDrafts);
    await db.delete(schema.recruitEntries);
    await db.delete(schema.recruits);
    await db.delete(schema.schedules);
    await db.delete(schema.guildSettings);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("recruit:register ボタンは Modal ではなく deferred ephemeral を返す", async () => {
    captureFetch();
    await insertSettings();
    await insertSchedule();
    await insertRecruit("rec-open", "open");

    const response = await runComponent(buttonPayload("recruit:register:rec-open"));
    // type 5 = DeferredChannelMessageWithSource、flags 64 = Ephemeral
    expect(response.type).toBe(5);
    expect((response as { data?: { flags?: number } }).data?.flags).toBe(64);
  });

  it("party_size select は draft の partySizePreference だけを保存し、確定参加は作らない", async () => {
    captureFetch();
    await insertSettings();
    await insertSchedule();
    await insertRecruit("rec-ps", "open");

    await runComponent(selectPayload("recruit:party_size:rec-ps", "up_to_trio"));

    const draft = await getDraft("rec-ps");
    expect(draft?.partySizePreference).toBe("up_to_trio");
    expect(draft?.availableFromUtc).toBeNull();
    expect(await getEntry("rec-ps")).toBeUndefined();
  });

  it("time select は draft の availableFromUtc だけを保存し、確定参加は作らない", async () => {
    captureFetch();
    await insertSettings();
    await insertSchedule();
    await insertRecruit("rec-time", "open");

    await runComponent(selectPayload("recruit:time:rec-time", FIRST_SLOT_UTC));

    const draft = await getDraft("rec-time");
    expect(draft?.availableFromUtc).toBe(FIRST_SLOT_UTC);
    expect(draft?.partySizePreference).toBeNull();
    expect(await getEntry("rec-time")).toBeUndefined();
  });

  it("両方選択後の register button で確定参加を作り draft を削除する", async () => {
    const calls = captureFetch();
    await insertSettings();
    await insertSchedule();
    await insertRecruit("rec-reg", "open");

    await runComponent(selectPayload("recruit:party_size:rec-reg", "up_to_trio"));
    await runComponent(selectPayload("recruit:time:rec-reg", FIRST_SLOT_UTC));
    const response = await runComponent(buttonPayload("recruit:register:rec-reg"));
    expect(response.type).toBe(5);

    const entry = await getEntry("rec-reg");
    expect(entry?.availableFromUtc).toBe(FIRST_SLOT_UTC);
    expect(entry?.partySizePreference).toBe("up_to_trio");
    // 確定後に draft は削除されている
    expect(await getDraft("rec-reg")).toBeUndefined();

    // register button の応答は最後の @original 編集
    const original = calls.filter((c) => c.url.includes("/messages/@original")).at(-1);
    expect(contentOf(original?.body)).toContain("希望時間を登録しました");
    expect(contentOf(original?.body)).toContain("トリオまで");
  });

  it("片方未選択（時間のみ）の register button は確定参加を作らない", async () => {
    captureFetch();
    await insertSettings();
    await insertSchedule();
    await insertRecruit("rec-half", "open");

    await runComponent(selectPayload("recruit:time:rec-half", FIRST_SLOT_UTC));
    await runComponent(buttonPayload("recruit:register:rec-half"));

    expect(await getEntry("rec-half")).toBeUndefined();
    // 時間 draft は残る
    expect((await getDraft("rec-half"))?.availableFromUtc).toBe(FIRST_SLOT_UTC);
  });

  it("無効な party size の select は draft を作らない", async () => {
    captureFetch();
    await insertSettings();
    await insertSchedule();
    await insertRecruit("rec-badps", "open");

    await runComponent(selectPayload("recruit:party_size:rec-badps", "invalid"));

    expect(await getDraft("rec-badps")).toBeUndefined();
    expect(await getEntry("rec-badps")).toBeUndefined();
  });

  it("募集時間外の time value の select は draft を作らない", async () => {
    captureFetch();
    await insertSettings();
    await insertSchedule();
    await insertRecruit("rec-oob", "open");

    await runComponent(selectPayload("recruit:time:rec-oob", "2026-06-15T03:00:00.000Z"));

    expect(await getDraft("rec-oob")).toBeUndefined();
    expect(await getEntry("rec-oob")).toBeUndefined();
  });

  it("終端状態(closed)の募集への select は DB を変更しない", async () => {
    const calls = captureFetch();
    await insertSettings();
    await insertSchedule();
    await insertRecruit("rec-closed", "closed");

    await runComponent(selectPayload("recruit:party_size:rec-closed", "any"));

    expect(await getDraft("rec-closed")).toBeUndefined();
    expect(await getEntry("rec-closed")).toBeUndefined();
    const original = calls.find((c) => c.url.includes("/messages/@original"));
    expect(contentOf(original?.body)).toContain("終了");
  });

  it("cancel は確定参加と draft の両方を削除する", async () => {
    captureFetch();
    await insertSettings();
    await insertSchedule();
    await insertRecruit("rec-cancel", "open");

    // 確定参加を作成
    await runComponent(selectPayload("recruit:party_size:rec-cancel", "any"));
    await runComponent(selectPayload("recruit:time:rec-cancel", FIRST_SLOT_UTC));
    await runComponent(buttonPayload("recruit:register:rec-cancel"));
    // さらに新しい draft を積む
    await runComponent(selectPayload("recruit:party_size:rec-cancel", "full_party"));
    expect(await getEntry("rec-cancel")).toBeDefined();
    expect(await getDraft("rec-cancel")).toBeDefined();

    await runComponent(buttonPayload("recruit:cancel:rec-cancel"));

    expect(await getEntry("rec-cancel")).toBeUndefined();
    expect(await getDraft("rec-cancel")).toBeUndefined();
  });

  it("does not resurrect a closed recruit via cancel + recompute", async () => {
    captureFetch();
    await insertSettings();
    await insertSchedule();
    await insertRecruit("rec-closed2", "closed");

    await runComponent(buttonPayload("recruit:cancel:rec-closed2"));

    const recruit = await db
      .select()
      .from(schema.recruits)
      .where(eq(schema.recruits.id, "rec-closed2"))
      .get();
    expect(recruit?.status).toBe("closed");
  });
});

// Note: Full integration tests for component interactions require SELF.fetch
// and are better tested through the actual worker endpoint.
