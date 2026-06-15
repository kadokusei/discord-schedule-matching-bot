import { z } from "zod";

// --- 基本スキーマ ---

export const regionSchema = z.enum(["na", "eu", "ap", "kr", "latam", "br"], {
  error: "エラー: 無効なリージョンです。na, eu, ap, kr, latam, br のいずれかを指定してください",
});

export const timezoneSchema = z.string().refine(
  (tz) => {
    try {
      Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
      return true;
    } catch {
      return false;
    }
  },
  { error: "エラー: 無効なタイムゾーンです" },
);

export const positiveNumberSchema = z
  .number({ error: "エラー: 数値を指定してください" })
  .int("エラー: 整数を指定してください")
  .positive("エラー: 正の数を指定してください");

// --- スキーマ定義: Riotアカウント追加 ---
// game_name は「名前#タグ」形式に統一。前後がともに非空であることを要求する。

export const riotAccountAddOptionsSchema = z.object({
  game_name: z
    .string()
    .min(1, { error: "エラー: game_nameは必須です" })
    .refine(
      (name) => {
        const [namePart, tagPart] = name.split("#");
        return name.includes("#") && namePart.length > 0 && tagPart.length > 0;
      },
      { error: "エラー: game_nameは「名前#タグ」の形式で指定してください（例: Player#JP1）" },
    ),
  region: regionSchema.default("ap"),
});

// --- スキーマ定義: Riotアカウント削除 ---
// game_name は全削除センチネル、または「名前#タグ」形式を受け取る。

export const riotAccountDeleteOptionsSchema = z.object({
  game_name: z.string().min(1, { error: "エラー: 削除するアカウントを指定してください" }),
});

// --- スキーマ定義: 募集コマンド ---

export const recruitOptionsSchema = z.object({
  post_time: z.string().regex(/^\d{2}:\d{2}$/, {
    error: "エラー: post_timeはHH:MM形式で指定してください",
  }),
  interval: z.coerce.number().int().positive().optional(),
  duration: z.coerce.number().int().positive().optional(),
});

// --- スキーマ定義: 設定コマンド ---

export const settingsOptionsSchema = z.object({
  timezone: timezoneSchema,
});

// --- スキーマ定義: 定期予定の削除コマンド ---

export const scheduleDeleteOptionsSchema = z.object({
  id: z.string().min(1, { error: "エラー: 削除する定期予定を指定してください" }),
});

// --- 型推論エクスポート ---

export type RiotAccountAddOptions = z.infer<typeof riotAccountAddOptionsSchema>;
export type RiotAccountDeleteOptions = z.infer<typeof riotAccountDeleteOptionsSchema>;
export type RecruitOptions = z.infer<typeof recruitOptionsSchema>;
export type SettingsOptions = z.infer<typeof settingsOptionsSchema>;
export type ScheduleDeleteOptions = z.infer<typeof scheduleDeleteOptionsSchema>;
