# Discord VALORANT Schedule Matching Bot

DiscordサーバーでVALORANTのスケジュール募集を行い、参加者の希望時間とランクを考慮して自動的にマッチングを行うボットです。

Cloudflare Workers上で動作し、定期的に募集を作成し、参加者が5人集まった時点で最適なパーティを自動編成します。

## 機能

### 基本機能

- **スケジュール募集**: 指定した時刻に定期的に募集メッセージを投稿
- **時間選択**: 参加者がセレクトメニューから希望時間を選択可能
- **自動マッチング**: 5人以上が確定した時点で、最適な集合時間を自動計算
- **Embed表示**: 参加状況をリアルタイムで更新するEmbed

### ランク機能

- **Riot ID連携**: `/riot account add` でVALORANTアカウントを登録
- **ランク取得**: HenrikDev APIを使用して自動的にランク情報を取得
- **ランク判定**: 5人未満の場合、ランクバランスを評価して通知
- **複数アカウント**: 1ユーザーが複数アカウントを登録可能

### リマインド機能

- **定期的リマインド**: 希望時間未設定のユーザーに自動通知
- **カスタマイズ可能**: ギルドごとにリマインド間隔を設定可能

## インストール

### 必要なもの

- Node.js (Bun推奨)
- Cloudflareアカウント
- Discord Botトークン
- HenrikDev APIキー

### セットアップ

1. リポジトリのクローン

```bash
git clone <repository-url>
cd discord-schedule-matching-bot
```

2. 依存関係のインストール

```bash
bun install
```

3. 環境変数の設定

`wrangler.toml` を編集:

```toml
[env.development]
vars = {
  ENVIRONMENT = "development",
  DISCORD_BOT_TOKEN = "your-bot-token",
  HENRIKDEV_API_KEY = "your-api-key"
}

[[env.development.d1_databases]]
binding = "DB"
database_name = "development-db"
database_id = "local"
```

4. データベースのマイグレーション

**マイグレーションファイルを作成:**

```bash
bun run db:generate
```

**Staging環境:**

```bash
bunx wrangler d1 migrations apply stagingDB --remote --env staging
```

**Production環境:**

```bash
bunx wrangler d1 migrations apply productionDB --remote --env production
```

## 使用方法

### テスト

```bash
bun run test         # Vitestで全テスト実行（推奨）
bun run test:ui      # Vitest UIでテスト実行
bun test             # Bun組み込みテストランナー（ユニットテストのみ）
```

**テストファイル命名規則**:

- `*.test.ts`: Bun組み込みとVitest両方で実行されるユニットテスト
- `*.vitest.ts`: Vitest専用（Cloudflare Workers環境が必要なintegrationテストなど）

### スラッシュコマンドの登録

Bot を初めて使う前に、Discord にスラッシュコマンドを登録する必要があります。
`DISCORD_APPLICATION_ID`（Discord Developer Portal で取得）と `DISCORD_BOT_TOKEN` を環境変数に設定して実行します。

```bash
# テストギルドに即時登録（DISCORD_TEST_GUILD_ID を設定した場合）
DISCORD_APPLICATION_ID=<app_id> DISCORD_BOT_TOKEN=<bot_token> DISCORD_TEST_GUILD_ID=<guild_id> \
  bun run scripts/register-commands.ts

# グローバル登録（反映に最大1時間。DISCORD_TEST_GUILD_ID を省略）
DISCORD_APPLICATION_ID=<app_id> DISCORD_BOT_TOKEN=<bot_token> \
  bun run scripts/register-commands.ts
```

> Interactions Endpoint URL は Worker のルート（`https://<worker>/`）を指定します。

### ローカル開発

```bash
bun run dev
```

### Lint / Format / 型チェック

```bash
bun run lint          # oxlint
bun run format        # oxfmt（書き込み）
bun run format:check  # oxfmt（チェックのみ）
bun run typecheck     # tsc --noEmit
bun run check         # 型チェック + lint + format:check + テストを一括実行
```

### デプロイ

```bash
bun run deploy
```

## Discordコマンド

### `/schedule recruit`

スケジュールを作成します。

- `post_time`: 募集メッセージを投稿する時刻 (HH:MM)
- `interval`: 時間選択の間隔（分）※オプション
- `duration`: 募集期間（分）※オプション

### `/schedule settings`

ギルドの設定を行います。

- `timezone`: タイムゾーン（例: Asia/Tokyo）

### `/riot add`

VALORANTアカウントを登録します。

- `game_name`: ゲーム名（`#タグ` を含めることも可）
- `tag_line`: タグライン（`game_name` に `#` がない場合必須）
- `region`: リージョン（ap/na/eu/kr/latam/br、既定 ap）※オプション

### `/riot remove`

登録したアカウントを削除します。

- `game_name`: ゲーム名 ※オプション（両方省略時は全て削除）
- `tag_line`: タグライン ※オプション

### `/riot list`

登録済みのアカウント一覧を表示します。

## ランクシステム

### 対応ランク

Iron, Bronze, Silver, Gold, Platinum, Diamond, Ascendant, Immortal, Radiant

各ランクは3つのディビジョン（1-3）に分かれています。

### マッチングアルゴリズム

1. **集合時間の優先**: 最も早く集合可能な5人を選択
2. **ランンクバランス**: ランクの分散が最小になる組を優先
3. **複数アカウント**: 1ユーザーが複数アカウントを持つ場合、最適な組を選択

## ライセンス

MIT License

## 貢献

プルリクエストをお待ちしています。
