import { SELF, env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../../src/db/schema";

// 実 Discord インタラクション JSON を POST "/" に流し、ルータ経由の dispatch を検証する。
// （署名検証は DISABLE_SIGNATURE_VERIFICATION=true で無効化、ヘッダ存在は必須）
const post = (payload: Record<string, unknown>) =>
  SELF.fetch(
    new Request("http://localhost/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature-Ed25519": "test-signature",
        "X-Signature-Timestamp": "test-timestamp",
      },
      body: JSON.stringify(payload),
    }),
  );

const commandPayload = (
  name: string,
  sub: string,
  options: { name: string; value: string | number; type?: number }[],
  ids: { guildId?: string; channelId?: string; userId?: string } = {},
) => ({
  type: 2,
  id: "i",
  application_id: "test-app-id",
  token: "tok",
  guild_id: ids.guildId,
  channel: ids.channelId ? { id: ids.channelId } : undefined,
  member: ids.userId ? { user: { id: ids.userId } } : undefined,
  data: {
    id: "c",
    name,
    type: 1,
    options: [{ type: 1, name: sub, options: options.map((o) => ({ type: o.type ?? 3, ...o })) }],
  },
});

const componentPayload = (customId: string) => ({
  type: 3,
  id: "i",
  application_id: "test-app-id",
  token: "tok",
  member: { user: { id: "clicker" } },
  data: { custom_id: customId, component_type: 2 },
});

describe("E2E: interaction routing through app.fetch", () => {
  const db = drizzle(env.DB, { schema });

  beforeEach(async () => {
    await db.delete(schema.recruitEntries);
    await db.delete(schema.recruits);
    await db.delete(schema.schedules);
    await db.delete(schema.guildSettings);
    await db.delete(schema.riotAccounts);
  });

  it("routes /schedule settings subcommand to the settings handler", async () => {
    const response = await post(
      commandPayload("schedule", "settings", [{ name: "timezone", value: "Asia/Tokyo" }], {
        guildId: "guild-1",
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { type: number; data?: { content?: string } };
    expect(body.type).toBe(4); // ChannelMessageWithSource
    expect(body.data?.content).toContain("Asia/Tokyo");

    const settings = await db
      .select()
      .from(schema.guildSettings)
      .where(eq(schema.guildSettings.guildId, "guild-1"))
      .get();
    expect(settings?.timezone).toBe("Asia/Tokyo");
  });

  it("routes /riot list subcommand to the list handler", async () => {
    const response = await post(commandPayload("riot", "list", [], { userId: "u-1" }));
    const body = (await response.json()) as { type: number; data?: { content?: string } };
    expect(body.type).toBe(4);
    expect(body.data?.content).toBe("登録されているアカウントはありません");
  });

  it("routes recruit:join component (colon-delimited custom_id) to a deferred ephemeral response", async () => {
    const response = await post(componentPayload("recruit:join:some-recruit-id"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { type: number; data?: { flags?: number } };
    // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE + EPHEMERAL
    expect(body.type).toBe(5);
    expect(body.data?.flags).toBe(64);
  });

  it("routes recruit:cancel component to a deferred ephemeral response", async () => {
    const response = await post(componentPayload("recruit:cancel:some-recruit-id"));
    const body = (await response.json()) as { type: number; data?: { flags?: number } };
    expect(body.type).toBe(5);
    expect(body.data?.flags).toBe(64);
  });

  it("returns an error message for an unknown command", async () => {
    const response = await post(commandPayload("unknown", "nope", [], { userId: "u-1" }));
    const body = (await response.json()) as { type: number; data?: { content?: string } };
    expect(body.data?.content).toContain("エラー");
  });
});
