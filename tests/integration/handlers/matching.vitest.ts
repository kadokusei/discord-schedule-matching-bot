import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as schema from "../../../src/db/schema";
import { recomputeMatch } from "../../../src/handlers/matching";

describe("recomputeMatch - Integration Tests", () => {
  const db = drizzle(env.DB, { schema });

  const cleanup = async () => {
    await db.delete(schema.recruitEntries);
    await db.delete(schema.recruits);
    await db.delete(schema.schedules);
    await db.delete(schema.guildSettings);
    await db.delete(schema.riotAccounts);
  };

  const setupBase = async () => {
    await cleanup();

    await db.insert(schema.guildSettings).values({
      id: crypto.randomUUID(),
      guildId: "test-guild",
      timezone: "Asia/Tokyo",
      defaultIntervalMin: 30,
      defaultDurationMin: 360,
      defaultTemplate: "",
    });

    const scheduleId = crypto.randomUUID();
    await db.insert(schema.schedules).values({
      id: scheduleId,
      guildId: "test-guild",
      channelId: "test-channel",
      creatorId: "creator",
      postTimeHHmm: "20:00",
      intervalMin: 30,
      durationMin: 360,
      template: "",
      active: 1,
    });

    const recruitId = crypto.randomUUID();
    await db.insert(schema.recruits).values({
      id: recruitId,
      scheduleId,
      guildId: "test-guild",
      channelId: "test-channel",
      messageId: "msg-123",
      targetDateLocal: "2026-01-18",
      status: "open",
    });

    return { scheduleId, recruitId };
  };

  const insertEntry = async (
    recruitId: string,
    userId: string,
    state: string,
    availableFromUtc: string | null,
  ) => {
    await db.insert(schema.recruitEntries).values({
      recruitId,
      userId,
      state,
      availableFromUtc,
      createdAtUtc: "2026-01-18T10:00:00.000Z",
      updatedAtUtc: "2026-01-18T10:00:00.000Z",
    });
  };

  // rankName 例: "Gold 2" / "Iron 1" / "Radiant"。tier/division は major-tier 判定に無関係。
  const insertRiotAccount = async (userId: string, rankName: string) => {
    await db.insert(schema.riotAccounts).values({
      id: crypto.randomUUID(),
      userId,
      gameName: `${userId}-name`,
      tagLine: "JP1",
      region: "ap",
      rank: JSON.stringify({ tier: 0, division: 1, rank: rankName }),
      createdAtUtc: "2026-01-18T10:00:00.000Z",
      lastFetchedAtUtc: "2026-01-18T10:00:00.000Z",
    });
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should keep status open when fewer than 5 confirmed entries", async () => {
    const { recruitId } = await setupBase();

    // 3 confirmed (5 人未満)
    await insertEntry(recruitId, "user1", "confirmed", "2026-01-18T11:00:00.000Z");
    await insertEntry(recruitId, "user2", "confirmed", "2026-01-18T11:30:00.000Z");
    await insertEntry(recruitId, "user3", "confirmed", "2026-01-18T12:00:00.000Z");

    // Track fetch calls
    const calls: { url: string; method: string }[] = [];
    const mockFetch = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? "GET" });
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve(""),
      } as Response);
    });
    globalThis.fetch = mockFetch as typeof globalThis.fetch;

    await recomputeMatch(env, recruitId);

    const recruit = await db
      .select()
      .from(schema.recruits)
      .where(eq(schema.recruits.id, recruitId))
      .get();

    expect(recruit?.status).toBe("open");
    expect(recruit?.matchSignature).toBeNull();
    expect(recruit?.matchedMeetTimeUtc).toBeNull();
    expect(recruit?.matchedMemberIdsJson).toBeNull();

    // updateDiscordMessage should have been called once (PATCH)
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/channels/test-channel/messages/msg-123");
    expect(calls[0].method).toBe("PATCH");
  });

  it("should set status matched when 5+ confirmed entries", async () => {
    const { recruitId } = await setupBase();

    // 5 confirmed entries with the same available time
    const baseTime = "2026-01-18T11:00:00.000Z";
    for (let i = 1; i <= 5; i++) {
      await insertEntry(recruitId, `user${i}`, "confirmed", baseTime);
    }

    // Mock Discord API — PATCH (updateDiscordMessage) + POST (postChannelMessage notification)
    const mockFetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve(""),
      } as Response),
    );
    globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

    await recomputeMatch(env, recruitId);

    const recruit = await db
      .select()
      .from(schema.recruits)
      .where(eq(schema.recruits.id, recruitId))
      .get();

    expect(recruit?.status).toBe("matched");
    expect(recruit?.matchSignature).toBeTruthy();
    expect(recruit?.matchedMeetTimeUtc).toBe(baseTime);

    const memberIds = JSON.parse(recruit?.matchedMemberIdsJson ?? "[]") as string[];
    expect(memberIds).toHaveLength(5);
    expect(memberIds).toContain("user1");
    expect(memberIds).toContain("user5");
  });

  it("should skip DB update when Discord API fails", async () => {
    const { recruitId } = await setupBase();

    // 3 confirmed
    await insertEntry(recruitId, "user1", "confirmed", "2026-01-18T11:00:00.000Z");
    await insertEntry(recruitId, "user2", "confirmed", "2026-01-18T11:30:00.000Z");
    await insertEntry(recruitId, "user3", "confirmed", "2026-01-18T12:00:00.000Z");

    // Mock Discord API failure
    const mockFetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Internal Server Error"),
      } as Response),
    );
    globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

    // Suppress expected console.error
    vi.spyOn(console, "error").mockImplementation(() => {});

    await recomputeMatch(env, recruitId);

    // DB should remain unchanged (status stays "open", no match fields set)
    const recruit = await db
      .select()
      .from(schema.recruits)
      .where(eq(schema.recruits.id, recruitId))
      .get();

    expect(recruit?.status).toBe("open");
    expect(recruit?.matchSignature).toBeNull();
  });

  it("should return early when recruit does not exist", async () => {
    await cleanup();

    const mockFetch = vi.fn();
    globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

    // Should not throw
    await recomputeMatch(env, "non-existent-id");

    // No Discord API calls should be made
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("should send notification when match is formed", async () => {
    const { recruitId } = await setupBase();

    const baseTime = "2026-01-18T11:00:00.000Z";
    for (let i = 1; i <= 5; i++) {
      await insertEntry(recruitId, `user${i}`, "confirmed", baseTime);
    }

    const fetchCalls: { url: string; method: string; body?: string }[] = [];
    const mockFetch = vi.fn((url: RequestInfo | URL, options?: RequestInit) => {
      fetchCalls.push({
        url: String(url),
        method: options?.method ?? "GET",
        body: options?.body?.toString(),
      });
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve(""),
      } as Response);
    });
    globalThis.fetch = mockFetch as typeof globalThis.fetch;

    await recomputeMatch(env, recruitId);

    // Should have called:
    // 1. PATCH to update Discord embed (matched status)
    // 2. POST to send notification message
    // 3. (possibly another PATCH for lastNotifiedSignature update — done via DB)
    const patchCalls = fetchCalls.filter((c) => c.method === "PATCH");
    const postCalls = fetchCalls.filter((c) => c.method === "POST");

    expect(patchCalls.length).toBeGreaterThanOrEqual(1);
    expect(postCalls.length).toBeGreaterThanOrEqual(1);

    // Verify notification was sent to the correct channel
    const notificationCall = postCalls.find((c) =>
      c.url.includes("/channels/test-channel/messages"),
    );
    expect(notificationCall).toBeTruthy();
  });

  it("should ping prev members except the trigger on cancellation", async () => {
    const { recruitId } = await setupBase();

    // 事前にマッチ済み状態を作る（5人 + signature）
    const matchedMembers = ["user1", "user2", "user3", "user4", "user5"];
    const baseTime = "2026-01-18T11:00:00.000Z";
    await db
      .update(schema.recruits)
      .set({
        status: "matched",
        matchedMeetTimeUtc: baseTime,
        matchedMemberIdsJson: JSON.stringify(matchedMembers),
        lastNotifiedSignature: `${[...matchedMembers].sort().join(",")}|${baseTime}`,
      })
      .where(eq(schema.recruits.id, recruitId));

    // user3 がキャンセルし、確定は 4 人に減る
    for (const id of ["user1", "user2", "user4", "user5"]) {
      await insertEntry(recruitId, id, "confirmed", baseTime);
    }

    const fetchCalls: { url: string; method: string; body?: string }[] = [];
    const mockFetch = vi.fn((url: RequestInfo | URL, options?: RequestInit) => {
      fetchCalls.push({
        url: String(url),
        method: options?.method ?? "GET",
        body: options?.body?.toString(),
      });
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve(""),
      } as Response);
    });
    globalThis.fetch = mockFetch as typeof globalThis.fetch;

    await recomputeMatch(env, recruitId, "user3");

    const notification = fetchCalls.find(
      (c) => c.method === "POST" && c.url.includes("/channels/test-channel/messages"),
    );
    expect(notification).toBeTruthy();

    const payload = JSON.parse(notification?.body ?? "{}") as {
      content: string;
      allowed_mentions: { users?: string[] };
    };

    // 解消前メンバー（トリガーの user3 を除く）が本文と allowed_mentions に含まれる
    expect(payload.content).toContain("【取消】");
    for (const id of ["user1", "user2", "user4", "user5"]) {
      expect(payload.content).toContain(`<@${id}>`);
      expect(payload.allowed_mentions.users).toContain(id);
    }
    expect(payload.content).not.toContain("<@user3>");
    expect(payload.allowed_mentions.users).not.toContain("user3");
  });

  it("should ping all current members on update (no trigger exclusion)", async () => {
    const { recruitId } = await setupBase();

    // 事前にマッチ済み状態（user1〜user5）
    const prevMembers = ["user1", "user2", "user3", "user4", "user5"];
    const baseTime = "2026-01-18T11:00:00.000Z";
    await db
      .update(schema.recruits)
      .set({
        status: "matched",
        matchedMeetTimeUtc: baseTime,
        matchedMemberIdsJson: JSON.stringify(prevMembers),
        lastNotifiedSignature: `${[...prevMembers].sort().join(",")}|${baseTime}`,
      })
      .where(eq(schema.recruits.id, recruitId));

    // user5 が抜け user6 が加わる（5人維持 → 更新）
    const nextMembers = ["user1", "user2", "user3", "user4", "user6"];
    for (const id of nextMembers) {
      await insertEntry(recruitId, id, "confirmed", baseTime);
    }

    const fetchCalls: { url: string; method: string; body?: string }[] = [];
    const mockFetch = vi.fn((url: RequestInfo | URL, options?: RequestInit) => {
      fetchCalls.push({
        url: String(url),
        method: options?.method ?? "GET",
        body: options?.body?.toString(),
      });
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve(""),
      } as Response);
    });
    globalThis.fetch = mockFetch as typeof globalThis.fetch;

    // user6 がトリガーでも更新では除外しない
    await recomputeMatch(env, recruitId, "user6");

    const notification = fetchCalls.find(
      (c) => c.method === "POST" && c.url.includes("/channels/test-channel/messages"),
    );
    expect(notification).toBeTruthy();

    const payload = JSON.parse(notification?.body ?? "{}") as {
      content: string;
      allowed_mentions: { users?: string[] };
    };

    expect(payload.content).toContain("【更新】");
    // 現在の確定メンバー全員（トリガー含む）が ping 対象
    for (const id of nextMembers) {
      expect(payload.allowed_mentions.users).toContain(id);
    }
    expect(payload.allowed_mentions.users).not.toContain("user5");
  });

  it("時刻のみ変更時は【更新】通知を1回だけ送り、取消通知は送らない", async () => {
    const { recruitId } = await setupBase();

    // 事前にマッチ済み状態（user1〜user5 が 20:00 JST = 11:00 UTC で確定）
    const members = ["user1", "user2", "user3", "user4", "user5"];
    const baseTime = "2026-01-18T11:00:00.000Z";
    await db
      .update(schema.recruits)
      .set({
        status: "matched",
        matchedMeetTimeUtc: baseTime,
        matchedMemberIdsJson: JSON.stringify(members),
        lastNotifiedSignature: `${[...members].sort().join(",")}|${baseTime}`,
      })
      .where(eq(schema.recruits.id, recruitId));

    // メンバーは不変のまま、user3 だけが時刻を 21:00 JST = 12:00 UTC に更新したケース。
    // confirmed への直接 upsert により confirmed を抜けないため、取消(<5)→確定(=5) の
    // 二重通知は発生せず、単一の【更新】通知のみとなることを保証する。
    const updatedTime = "2026-01-18T12:00:00.000Z";
    for (const id of members) {
      await insertEntry(recruitId, id, "confirmed", id === "user3" ? updatedTime : baseTime);
    }

    const fetchCalls: { url: string; method: string; body?: string }[] = [];
    const mockFetch = vi.fn((url: RequestInfo | URL, options?: RequestInit) => {
      fetchCalls.push({
        url: String(url),
        method: options?.method ?? "GET",
        body: options?.body?.toString(),
      });
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve(""),
      } as Response);
    });
    globalThis.fetch = mockFetch as typeof globalThis.fetch;

    await recomputeMatch(env, recruitId, "user3");

    // 通知（POST /channels/.../messages）は正確に1件だけ
    const notifications = fetchCalls.filter(
      (c) => c.method === "POST" && c.url.includes("/channels/test-channel/messages"),
    );
    expect(notifications).toHaveLength(1);

    const payload = JSON.parse(notifications[0]?.body ?? "{}") as {
      content: string;
      allowed_mentions: { users?: string[] };
    };

    // 【更新】通知のみで【取消】は含まない
    expect(payload.content).toContain("【更新】");
    expect(payload.content).not.toContain("【取消】");
    // 集合時刻は最遅時刻（21:00 JST）へ更新される
    expect(payload.content).toContain("🕘 集合時刻: 20:00 → 21:00");

    // マッチは matched を維持
    const recruit = await db
      .select()
      .from(schema.recruits)
      .where(eq(schema.recruits.id, recruitId))
      .get();
    expect(recruit?.status).toBe("matched");
    expect(recruit?.matchedMeetTimeUtc).toBe(updatedTime);
  });

  describe("undecided nudge (人数充足リマインド)", () => {
    // postChannelMessage(POST /channels/.../messages) のうち、未定者宛て(本人 ping 1名)を抽出する
    const findNudge = (calls: { url: string; method: string; body: string }[], userId: string) =>
      calls.find((c) => {
        if (c.method !== "POST" || !c.url.includes("/channels/test-channel/messages")) return false;
        try {
          const payload = JSON.parse(c.body) as { allowed_mentions?: { users?: string[] } };
          return payload.allowed_mentions?.users?.includes(userId) ?? false;
        } catch {
          return false;
        }
      });

    const trackFetch = () => {
      const calls: { url: string; method: string; body: string }[] = [];
      const mockFetch = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
        calls.push({
          url: String(url),
          method: init?.method ?? "GET",
          body: typeof init?.body === "string" ? init.body : "",
        });
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({}),
          text: () => Promise.resolve(""),
        } as Response);
      });
      globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;
      return calls;
    };

    it("notifies an undecided user when confirmed + undecided >= 2, and marks them reminded", async () => {
      const { recruitId } = await setupBase();
      await insertEntry(recruitId, "userC", "confirmed", "2026-01-18T11:00:00.000Z");
      await insertEntry(recruitId, "userU", "undecided", null);
      // 確定者と未定者がランク差制限を満たして組める（少人数局面なのでランク必須）
      await insertRiotAccount("userC", "Gold 1");
      await insertRiotAccount("userU", "Gold 2");

      const calls = trackFetch();
      await recomputeMatch(env, recruitId);

      const nudge = findNudge(calls, "userU");
      expect(nudge).toBeTruthy();

      const entry = await db
        .select()
        .from(schema.recruitEntries)
        .where(eq(schema.recruitEntries.userId, "userU"))
        .get();
      expect(entry?.lastRemindedAtUtc).toBeTruthy();
    });

    it("少人数局面: アカウント未登録の未定者へは nudge を送らない（報告ケース）", async () => {
      const { recruitId } = await setupBase();
      await insertEntry(recruitId, "userC", "confirmed", "2026-01-18T11:00:00.000Z");
      await insertEntry(recruitId, "userU", "undecided", null);
      await insertRiotAccount("userC", "Gold 1");
      // userU はアカウント未登録

      const calls = trackFetch();
      await recomputeMatch(env, recruitId);

      expect(findNudge(calls, "userU")).toBeFalsy();
    });

    it("少人数局面: ランク差が大きすぎて組めない未定者へは nudge を送らない", async () => {
      const { recruitId } = await setupBase();
      await insertEntry(recruitId, "userC", "confirmed", "2026-01-18T11:00:00.000Z");
      await insertEntry(recruitId, "userU", "undecided", null);
      await insertRiotAccount("userC", "Iron 1");
      await insertRiotAccount("userU", "Radiant");

      const calls = trackFetch();
      await recomputeMatch(env, recruitId);

      expect(findNudge(calls, "userU")).toBeFalsy();
    });

    it("5人局面: confirmed+undecided>=5 ならランクが外れた未定者にも nudge を送る", async () => {
      const { recruitId } = await setupBase();
      const baseTime = "2026-01-18T11:00:00.000Z";
      // 確定 4 ＋ 未定 1 = 5。フルマッチに届きうるのでランク差は不問。
      for (let i = 1; i <= 4; i++) {
        await insertEntry(recruitId, `user${i}`, "confirmed", baseTime);
        await insertRiotAccount(`user${i}`, "Iron 1");
      }
      await insertEntry(recruitId, "userU", "undecided", null);
      await insertRiotAccount("userU", "Radiant"); // Iron とは少人数で組めないランク差

      const calls = trackFetch();
      await recomputeMatch(env, recruitId);

      expect(findNudge(calls, "userU")).toBeTruthy();
    });

    it("does NOT notify when total (confirmed + undecided) is below 2", async () => {
      const { recruitId } = await setupBase();
      await insertEntry(recruitId, "userU", "undecided", null);

      const calls = trackFetch();
      await recomputeMatch(env, recruitId);

      expect(findNudge(calls, "userU")).toBeFalsy();
    });

    it("間隔内(前回リマインドから intervalMin 未満)は再送しない", async () => {
      const { recruitId } = await setupBase();
      await insertEntry(recruitId, "userC", "confirmed", "2026-01-18T11:00:00.000Z");
      // ランク差制限は満たす（少人数局面なのでランク必須）。間隔のみを変数化するため。
      await insertRiotAccount("userC", "Gold 1");
      await insertRiotAccount("userU", "Gold 2");
      // 既にリマインド済み
      await db.insert(schema.recruitEntries).values({
        recruitId,
        userId: "userU",
        state: "undecided",
        availableFromUtc: null,
        createdAtUtc: "2026-01-18T10:00:00.000Z",
        updatedAtUtc: "2026-01-18T10:00:00.000Z",
        lastRemindedAtUtc: new Date(Date.now() - 5 * 60_000).toISOString(),
      });

      const calls = trackFetch();
      await recomputeMatch(env, recruitId);

      expect(findNudge(calls, "userU")).toBeFalsy();
    });

    it("間隔経過後(前回リマインドから intervalMin 以上)は再送する", async () => {
      const { recruitId } = await setupBase();
      await insertEntry(recruitId, "userC", "confirmed", "2026-01-18T11:00:00.000Z");
      // ランク差制限は満たす。間隔のみを変数化するため。
      await insertRiotAccount("userC", "Gold 1");
      await insertRiotAccount("userU", "Gold 2");
      // 90分前にリマインド済み（デフォルト間隔60分を超過）
      await db.insert(schema.recruitEntries).values({
        recruitId,
        userId: "userU",
        state: "undecided",
        availableFromUtc: null,
        createdAtUtc: "2026-01-18T10:00:00.000Z",
        updatedAtUtc: "2026-01-18T10:00:00.000Z",
        lastRemindedAtUtc: new Date(Date.now() - 90 * 60_000).toISOString(),
      });

      const calls = trackFetch();
      await recomputeMatch(env, recruitId);

      expect(findNudge(calls, "userU")).toBeTruthy();
    });

    it("シナリオ: 5人確定後に1人が未定へ変更すると open に戻る。本人トリガでは本人へ nudge を送らないが、別メンバーの動きでは送る", async () => {
      const { recruitId } = await setupBase();
      const baseTime = "2026-01-18T11:00:00.000Z";
      for (let i = 1; i <= 5; i++) {
        await insertEntry(recruitId, `user${i}`, "confirmed", baseTime);
      }

      // まず 5 人で matched にする
      trackFetch();
      await recomputeMatch(env, recruitId);
      const matched = await db
        .select()
        .from(schema.recruits)
        .where(eq(schema.recruits.id, recruitId))
        .get();
      expect(matched?.status).toBe("matched");

      // user5 が「未定」へ変更（handleRecruitTime の未定分岐相当: lastRemindedAtUtc は null へ）
      await db
        .update(schema.recruitEntries)
        .set({ state: "undecided", availableFromUtc: null, lastRemindedAtUtc: null })
        .where(eq(schema.recruitEntries.userId, "user5"));

      // 本人(user5)がトリガした recompute
      const calls = trackFetch();
      await recomputeMatch(env, recruitId, "user5");

      const reopened = await db
        .select()
        .from(schema.recruits)
        .where(eq(schema.recruits.id, recruitId))
        .get();
      // 確定が 4 人に減るため open へ戻り、マッチ情報はクリアされる
      expect(reopened?.status).toBe("open");
      expect(reopened?.matchedMemberIdsJson).toBeNull();
      expect(reopened?.matchSignature).toBeNull();
      // 本人がトリガした recompute では本人へ nudge を送らない
      expect(findNudge(calls, "user5")).toBeFalsy();

      // その後、別メンバー(user1)の動きで recompute が走ると、未定者へ 1 回通知される
      const calls2 = trackFetch();
      await recomputeMatch(env, recruitId, "user1");
      expect(findNudge(calls2, "user5")).toBeTruthy();

      // 通知済みになったので、さらに別の recompute では再送されない
      const calls3 = trackFetch();
      await recomputeMatch(env, recruitId, "user2");
      expect(findNudge(calls3, "user5")).toBeFalsy();
    });

    it("シナリオ: 6人確定＋1人未定 → 未定を除いた5人で確定する", async () => {
      const { recruitId } = await setupBase();
      const baseTime = "2026-01-18T11:00:00.000Z";
      for (let i = 1; i <= 6; i++) {
        await insertEntry(recruitId, `user${i}`, "confirmed", baseTime);
      }
      await insertEntry(recruitId, "userU", "undecided", null);

      const calls = trackFetch();
      await recomputeMatch(env, recruitId);

      const recruit = await db
        .select()
        .from(schema.recruits)
        .where(eq(schema.recruits.id, recruitId))
        .get();
      expect(recruit?.status).toBe("matched");

      const memberIds = JSON.parse(recruit?.matchedMemberIdsJson ?? "[]") as string[];
      // 確定 6 人から 5 人が選ばれ、未定者は計算対象外
      expect(memberIds).toHaveLength(5);
      expect(memberIds).not.toContain("userU");
      // 確定 6 ＋ 未定 1 のため、未定者へ nudge も飛ぶ
      expect(findNudge(calls, "userU")).toBeTruthy();
    });
  });

  describe("5人マッチの早期サブ組併記", () => {
    // 確定メッセージ(PATCH)の embed フィールドを抽出する
    const matchedEmbedFields = (
      calls: { url: string; method: string; body: string }[],
    ): { name: string; value: string }[] => {
      const patch = calls.find(
        (c) => c.method === "PATCH" && c.url.includes("/channels/test-channel/messages/"),
      );
      if (!patch) return [];
      const payload = JSON.parse(patch.body) as {
        embeds?: { fields?: { name: string; value: string }[] }[];
      };
      return payload.embeds?.[0]?.fields ?? [];
    };

    const trackFetch = () => {
      const calls: { url: string; method: string; body: string }[] = [];
      const mockFetch = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
        calls.push({
          url: String(url),
          method: init?.method ?? "GET",
          body: typeof init?.body === "string" ? init.body : "",
        });
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({}),
          text: () => Promise.resolve(""),
        } as Response);
      });
      globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;
      return calls;
    };

    it("全員集合より早く始められるランク適合の組があれば確定 embed に併記する", async () => {
      const { recruitId } = await setupBase();
      // 3人は 20:00(11:00Z) から、2人は 20:30(11:30Z) から。全員 Gold。
      const early = "2026-01-18T11:00:00.000Z";
      const late = "2026-01-18T11:30:00.000Z";
      for (let i = 1; i <= 3; i++) {
        await insertEntry(recruitId, `user${i}`, "confirmed", early);
        await insertRiotAccount(`user${i}`, "Gold 1");
      }
      for (let i = 4; i <= 5; i++) {
        await insertEntry(recruitId, `user${i}`, "confirmed", late);
        await insertRiotAccount(`user${i}`, "Gold 2");
      }

      const calls = trackFetch();
      await recomputeMatch(env, recruitId);

      const field = matchedEmbedFields(calls).find((f) => f.name === "早く始めるなら");
      expect(field).toBeTruthy();
      expect(field?.value).toContain("20:00"); // 早期サブ組の集合時刻(JST)
    });

    it("全員が同時刻なら早期サブ組は併記しない", async () => {
      const { recruitId } = await setupBase();
      const same = "2026-01-18T11:00:00.000Z";
      for (let i = 1; i <= 5; i++) {
        await insertEntry(recruitId, `user${i}`, "confirmed", same);
        await insertRiotAccount(`user${i}`, "Gold 1");
      }

      const calls = trackFetch();
      await recomputeMatch(env, recruitId);

      expect(matchedEmbedFields(calls).find((f) => f.name === "早く始めるなら")).toBeUndefined();
    });
  });
});
