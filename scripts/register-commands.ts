import {
  ApplicationCommandOptionType,
  ApplicationCommandType,
  type RESTPostAPIApplicationCommandsJSONBody,
} from "discord-api-types/v10";

const commands: RESTPostAPIApplicationCommandsJSONBody[] = [
  {
    name: "schedule",
    description: "スケジュール管理",
    type: ApplicationCommandType.ChatInput,
    options: [
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: "recruit",
        description: "募集スケジュールを作成します",
        options: [
          {
            type: ApplicationCommandOptionType.String,
            name: "post_time",
            description: "投稿時間 (HH:MM形式)",
            required: true,
          },
          {
            type: ApplicationCommandOptionType.Integer,
            name: "interval",
            description: "間隔（分）",
          },
          {
            type: ApplicationCommandOptionType.Integer,
            name: "duration",
            description: "募集期間（分）",
          },
        ],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: "settings",
        description: "サーバー設定を変更します",
        options: [
          {
            type: ApplicationCommandOptionType.String,
            name: "timezone",
            description: "タイムゾーン (例: Asia/Tokyo)",
            required: true,
          },
        ],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: "list",
        description: "登録済みの定期予定を一覧表示します",
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: "delete",
        description: "定期予定を削除します",
        options: [
          {
            type: ApplicationCommandOptionType.String,
            name: "id",
            description: "削除する定期予定",
            required: true,
            autocomplete: true,
          },
        ],
      },
    ],
  },
  {
    name: "riot",
    description: "VALORANTアカウント管理",
    type: ApplicationCommandType.ChatInput,
    options: [
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: "add",
        description: "VALORANTアカウントを追加します",
        options: [
          {
            type: ApplicationCommandOptionType.String,
            name: "game_name",
            description: "ゲーム名（#タグを含めることも可）",
            required: true,
          },
          {
            type: ApplicationCommandOptionType.String,
            name: "tag_line",
            description: "タグライン（game_nameに#がない場合必須）",
          },
          {
            type: ApplicationCommandOptionType.String,
            name: "region",
            description: "リージョン (ap/na/eu/kr/latam/br)",
          },
        ],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: "remove",
        description: "VALORANTアカウントを削除します",
        options: [
          {
            type: ApplicationCommandOptionType.String,
            name: "game_name",
            description: "ゲーム名",
          },
          {
            type: ApplicationCommandOptionType.String,
            name: "tag_line",
            description: "タグライン",
          },
        ],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: "list",
        description: "登録済みのVALORANTアカウントを一覧表示します",
      },
    ],
  },
];

const applicationId = process.env.DISCORD_APPLICATION_ID;
const botToken = process.env.DISCORD_BOT_TOKEN;
const testGuildId = process.env.DISCORD_TEST_GUILD_ID;

if (!applicationId || !botToken) {
  console.error("DISCORD_APPLICATION_ID と DISCORD_BOT_TOKEN を環境変数に設定してください");
  process.exit(1);
}

// DISCORD_TEST_GUILD_ID があればギルド登録（即時反映）、無ければグローバル登録（最大1時間）
const url = testGuildId
  ? `https://discord.com/api/v10/applications/${applicationId}/guilds/${testGuildId}/commands`
  : `https://discord.com/api/v10/applications/${applicationId}/commands`;

const response = await fetch(url, {
  method: "PUT",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bot ${botToken}`,
  },
  body: JSON.stringify(commands),
});

if (!response.ok) {
  const text = await response.text();
  console.error(`コマンド登録に失敗しました: ${response.status} ${text}`);
  process.exit(1);
}

console.log(
  `コマンドを登録しました (${testGuildId ? `guild ${testGuildId}` : "global"}): ${commands.length} 件`,
);
