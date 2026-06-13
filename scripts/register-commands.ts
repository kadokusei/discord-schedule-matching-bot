import { Command, Option, register } from "discord-hono";

const scheduleRecruitCommand = new Command("recruit", "募集スケジュールを作成します").options(
  new Option("post_time", "投稿時間 (HH:MM形式)", 3).required(),
  new Option("interval", "間隔（分）", 4),
  new Option("duration", "募集期間（分）", 4),
);

const scheduleSettingsCommand = new Command("settings", "サーバー設定を変更します").options(
  new Option("timezone", "タイムゾーン (例: Asia/Tokyo)", 3).required(),
);

const riotAccountAddCommand = new Command("add", "VALORANTアカウントを追加します").options(
  new Option("game_name", "ゲーム名（#タグを含めることも可）", 3).required(),
  new Option("tag_line", "タグライン（game_nameに#がない場合必須）", 3),
  new Option("region", "リージョン (ap/na/eu/kr/latam/br)", 3),
);

const riotAccountRemoveCommand = new Command("remove", "VALORANTアカウントを削除します").options(
  new Option("game_name", "ゲーム名", 3),
  new Option("tag_line", "タグライン", 3),
);

const riotAccountListCommand = new Command("list", "登録済みのVALORANTアカウントを一覧表示します");

const scheduleCommand = new Command("schedule", "スケジュール管理")
  .options(scheduleRecruitCommand)
  .options(scheduleSettingsCommand);

const riotCommand = new Command("riot", "VALORANTアカウント管理")
  .options(riotAccountAddCommand)
  .options(riotAccountRemoveCommand)
  .options(riotAccountListCommand);

const commands = [scheduleCommand, riotCommand];

await register(
  commands,
  process.env.DISCORD_APPLICATION_ID ?? "",
  process.env.DISCORD_BOT_TOKEN ?? "",
);
