import { integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const guildSettings = sqliteTable("guild_settings", {
  id: text("id").primaryKey(),
  guildId: text("guild_id").notNull().unique(),
  timezone: text("timezone").notNull().default("Asia/Tokyo"),
  defaultIntervalMin: integer("default_interval_min").notNull().default(30),
  defaultDurationMin: integer("default_duration_min").notNull().default(360),
  defaultTemplate: text("default_template").notNull().default(""),
  reminderIntervalMin: integer("reminder_interval_min"),
});

export const schedules = sqliteTable("schedules", {
  id: text("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  channelId: text("channel_id").notNull(),
  creatorId: text("creator_id").notNull(),
  postTimeHHmm: text("post_time_hhmm").notNull(),
  intervalMin: integer("interval_min").notNull().default(30),
  durationMin: integer("duration_min").notNull().default(360),
  template: text("template").notNull().default(""),
  active: integer("active").notNull().default(1),
});

export const recruits = sqliteTable(
  "recruits",
  {
    id: text("id").primaryKey(),
    scheduleId: text("schedule_id").notNull(),
    guildId: text("guild_id").notNull(),
    channelId: text("channel_id").notNull(),
    // 予約先行で作成するため、Discord 投稿前は空文字のプレースホルダ。投稿成功後に messageId を更新する。
    messageId: text("message_id").notNull(),
    targetDateLocal: text("target_date_local").notNull(),
    status: text("status").notNull().default("open"),
    matchSignature: text("match_signature"),
    lastNotifiedSignature: text("last_notified_signature"),
    matchedMeetTimeUtc: text("matched_meet_time_utc"),
    matchedMemberIdsJson: text("matched_member_ids_json"),
    // 5人未満で成立する少人数(2〜3人)パーティ提案の状態。1募集につき1件のアクティブ提案を保持する。
    smallPartyStatus: text("small_party_status"), // null | "proposed" | "confirmed"
    smallPartyMemberIdsJson: text("small_party_member_ids_json"),
    smallPartyMeetTimeUtc: text("small_party_meet_time_utc"),
    smallPartyConsentJson: text("small_party_consent_json"), // 「行く」を押したユーザーIDの配列
    smallPartyProposedAtUtc: text("small_party_proposed_at_utc"), // 提案対象スロット(UTC)。同一スロット重複提案の抑制に使う
    deletedBy: text("deleted_by"),
    deletedAtUtc: text("deleted_at_utc"),
  },
  // 同一スケジュール・同一日に複数の募集を作らない（cron の重複起動/リトライに対する冪等性の最終保証）
  (t) => [uniqueIndex("schedule_id_target_date_local_unique").on(t.scheduleId, t.targetDateLocal)],
);

export const recruitEntries = sqliteTable(
  "recruit_entries",
  {
    recruitId: text("recruit_id")
      .notNull()
      .references(() => recruits.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    state: text("state").notNull(),
    availableFromUtc: text("available_from_utc"),
    createdAtUtc: text("created_at_utc").notNull(),
    updatedAtUtc: text("updated_at_utc").notNull(),
    lastRemindedAtUtc: text("last_reminded_at_utc"),
  },
  (t) => [primaryKey({ columns: [t.recruitId, t.userId] })],
);

export const riotAccounts = sqliteTable(
  "riot_accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    gameName: text("game_name").notNull(),
    tagLine: text("tag_line").notNull(),
    region: text("region").notNull().default("na"),
    rank: text("rank").notNull(),
    createdAtUtc: text("created_at_utc").notNull(),
    lastFetchedAtUtc: text("last_fetched_at_utc").notNull(),
  },
  (t) => [uniqueIndex("user_id_game_name_tag_line_unique").on(t.userId, t.gameName, t.tagLine)],
);

export const apiRateLimits = sqliteTable("api_rate_limits", {
  id: text("id").primaryKey(),
  apiName: text("api_name").notNull(),
  requestedAtUtc: text("requested_at_utc").notNull(),
});

export type GuildSetting = typeof guildSettings.$inferSelect;
export type Schedule = typeof schedules.$inferSelect;
export type Recruit = typeof recruits.$inferSelect;
export type RecruitEntry = typeof recruitEntries.$inferSelect;
export type RiotAccount = typeof riotAccounts.$inferSelect;
