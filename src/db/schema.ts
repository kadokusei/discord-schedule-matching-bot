import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const guildSettings = sqliteTable("guild_settings", {
  id: text("id").primaryKey(),
  guildId: text("guild_id").notNull().unique(),
  timezone: text("timezone").notNull().default("Asia/Tokyo"),
  defaultIntervalMin: integer("default_interval_min").notNull().default(30),
  defaultDurationMin: integer("default_duration_min").notNull().default(360),
  defaultTemplate: text("default_template").notNull().default(""),
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

export const recruits = sqliteTable("recruits", {
  id: text("id").primaryKey(),
  scheduleId: text("schedule_id").notNull(),
  guildId: text("guild_id").notNull(),
  channelId: text("channel_id").notNull(),
  messageId: text("message_id").notNull(),
  targetDateLocal: text("target_date_local").notNull(),
  status: text("status").notNull().default("open"),
  matchSignature: text("match_signature"),
  lastNotifiedSignature: text("last_notified_signature"),
  matchedMeetTimeUtc: text("matched_meet_time_utc"),
  matchedMemberIdsJson: text("matched_member_ids_json"),
  deletedBy: text("deleted_by"),
  deletedAtUtc: text("deleted_at_utc"),
});

export const recruitEntries = sqliteTable("recruit_entries", {
  recruitId: text("recruit_id").notNull().references(() => recruits.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  state: text("state").notNull().default("pending_time"),
  availableFromUtc: text("available_from_utc"),
  updatedAtUtc: text("updated_at_utc").notNull(),
  lastRemindedAtUtc: text("last_reminded_at_utc"),
});

export type GuildSetting = typeof guildSettings.$inferSelect;
export type Schedule = typeof schedules.$inferSelect;
export type Recruit = typeof recruits.$inferSelect;
export type RecruitEntry = typeof recruitEntries.$inferSelect;
