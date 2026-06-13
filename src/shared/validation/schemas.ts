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

export const riotAccountAddOptionsSchema = z
  .object({
    game_name: z.string().min(1, { error: "エラー: game_nameは必須です" }),
    tag_line: z.string().min(1, { error: "エラー: tag_lineは必須です" }).optional(),
    region: regionSchema.default("ap"),
  })
  .refine((data) => data.game_name.includes("#") || data.tag_line !== undefined, {
    error: "エラー: game_nameに#が含まれない場合、tag_lineは必須です",
  });

// --- スキーマ定義: Riotアカウント削除 ---

export const riotAccountRemoveOptionsSchema = z
  .object({
    game_name: z.string().optional(),
    tag_line: z.string().optional(),
  })
  .refine((data) => (data.game_name && data.tag_line) || (!data.game_name && !data.tag_line), {
    error: "エラー: game_nameとtag_lineは両方指定するか、両方省略してください",
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

// --- 型推論エクスポート ---

export type RiotAccountAddOptions = z.infer<typeof riotAccountAddOptionsSchema>;
export type RiotAccountRemoveOptions = z.infer<typeof riotAccountRemoveOptionsSchema>;
export type RecruitOptions = z.infer<typeof recruitOptionsSchema>;
export type SettingsOptions = z.infer<typeof settingsOptionsSchema>;
