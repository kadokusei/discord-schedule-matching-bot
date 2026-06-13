# Discord VALORANT Schedule Matching Bot - エージェントガイド

このドキュメントは、本コードベースで作業する AI エージェント（Claude Code など）向けのコンテキストを提供する。

> 本ファイルは日本語で記述する。技術用語・コード識別子・コマンドは原語のまま残す。

## プロジェクト概要

Cloudflare Workers 上で動作する Discord Bot。VALORANT のマッチをスケジューリングし、参加者の都合（時間）とランクに基づいて自動でパーティを編成する。

## 技術スタック

- **Runtime**: Cloudflare Workers（ローカル開発・実行は Bun）。ツールバージョンは `mise.toml` で固定（bun 1.3.6 / prek / actionlint）
- **Framework**: Hono
- **Database**: D1（SQLite）+ Drizzle ORM
- **Language**: TypeScript
- **Lint**: oxlint（`.oxlintrc.json`）
- **Format**: oxfmt（`.oxfmtrc.json`）
- **Test**: Vitest（`@cloudflare/vitest-pool-workers`）
- **Deploy**: Wrangler
- **pre-commit**: prek（`.pre-commit-config.yaml`）

## アーキテクチャ

### ディレクトリ構成

実装ファイルは随時追加されるため全列挙はしない。各ディレクトリの責務を以下に示す。

```
src/
├── index.ts          # エントリポイント。ルーティングのみ
├── db/               # スキーマ定義（schema.ts）
├── lib/              # 共有型（types.ts）、Discord 署名検証（security.ts）
├── features/         # 機能ごとのモジュール（ドメインロジック）
│   ├── matching/     # パーティ編成アルゴリズム（ランクバランス、ランク制限、少人数編成）
│   ├── recruit/      # 募集インスタンスの管理（通知・リマインド・スケジューラ・有効期限・状態・少人数提案）
│   ├── discord/      # Discord API 連携（client / embed / components）
│   └── riot/         # Riot Games API（HenrikDev クライアント、レートリミッタ）
├── shared/           # 横断ユーティリティ
│   ├── time/         # タイムゾーン・時刻変換（buildTimeOptions, localDateTimeToUtc）
│   ├── validation/   # Zod バリデーションスキーマ
│   └── discord/      # Discord 権限ヘルパ（permissions.ts）
└── handlers/         # リクエストハンドラ
    ├── commands.ts   # スラッシュコマンド
    ├── components.ts # コンポーネントインタラクション
    ├── matching.ts   # マッチ計算ヘルパ
    └── scheduled.ts  # スケジュールタスク

scripts/              # 運用スクリプト（register-commands.ts: スラッシュコマンド登録）
migrations/           # Drizzle が生成する D1 マイグレーション（meta/ にスナップショット）
tests/                # unit/（*.test.ts）と integration/（*.vitest.ts）
```

### データベーススキーマ

- `guild_settings`: ギルドごとの設定（タイムゾーン、デフォルト値、リマインド間隔）
- `schedules`: 繰り返しスケジュール定義
- `recruits`: スケジュールから生成される個々の募集インスタンス
- `recruit_entries`: ユーザーの参加エントリ（状態を持つ）
- `riot_accounts`: ユーザーの VALORANT アカウント連携・ランク

### 状態遷移（recruit_entries）

```
pending_time → confirmed
     ↓
   cancelled
```

## 主要コンセプト

### インタラクションフロー

1. **スケジュールタスク**: 設定時刻に募集インスタンスを生成
2. **参加**: 状態を `pending_time` にし、時間選択メニューを表示
3. **時間選択**: 状態を `confirmed` にし、再計算をトリガ
4. **マッチ計算**: confirmed が 5 人以上になると最適パーティを探索

### マッチングアルゴリズム

- 最も早く集合できる時間を優先
- ランクバランス（分散の最小化）を考慮
- 1 ユーザーが複数アカウントを持つ場合、最適な組み合わせを選択
- 5 人に満たない場合の少人数編成（small-party）や、ランク差による制限（rank-restriction）も扱う

### ランクバランス

ティア階層（Iron < Bronze < ... < Radiant）を用いてランク分散を計算し、可能な範囲でバランスの取れたパーティを選ぶ。

## 開発ワークフロー

### セットアップ

```bash
mise install            # bun / prek / actionlint をインストール
mise run setup-hooks    # prek で git pre-commit hooks を導入
bun install             # 依存をインストール
bun run secrets:setup   # .dev.vars.example から .dev.vars を作成（編集して秘密情報を設定）
```

### よく使うコマンド

```bash
bun run dev          # wrangler dev（ローカル実行）
bun run deploy       # wrangler deploy

bun run test         # テスト実行（= bun vitest）
bun run test:ui      # Vitest UI

bun run lint         # oxlint（src/ tests/ scripts/）
bun run lint:fix     # oxlint --fix
bun run format       # oxfmt
bun run format:check # フォーマット検査のみ
bun run typecheck    # tsc --noEmit

bun run check        # typecheck + lint + format:check + test を一括実行

bun run db:generate  # スキーマ変更からマイグレーション生成
bun run db:migrate   # マイグレーション適用
bun run db:studio    # Drizzle Studio
```

### pre-commit hooks

`prek` 経由で以下が commit 前に走る（`.pre-commit-config.yaml`）。

- oxlint（src / tests / scripts）
- oxfmt（フォーマット検査）
- actionlint（`.github/workflows/`）

## テスト

開発は TDD（Explore → Red → Green → Refactor）に従う。バグ修正時はまず再現テストを書く。KPI・カバレッジ目標が与えられた場合は達成まで反復する。

```bash
bun run test --watch                 # 変更を監視して自動再実行
bun run test -- tests/unit/...        # 特定ファイルのみ
```

### テストランナーとファイル命名

全テストは Vitest（`@cloudflare/vitest-pool-workers`）で実行する。`vitest.config.ts` の `include` は `["**/*.test.ts", "**/*.vitest.ts"]`。

- **`*.test.ts`**: ユニットテスト。`tests/unit/` に配置。Cloudflare Workers 環境を必要としない純粋なロジック向け
- **`*.vitest.ts`**: 統合テスト。`tests/integration/` に配置。`cloudflare:test` ユーティリティ（D1 など）を必要とするもの

いずれも `bun run test` で実行される。テスト用バインディングやマイグレーション適用は `tests/setup.ts` で行う。

## コーディングガイドライン

### 関数型プログラミング原則

1. **const を優先**: 再代入が不要な変数は常に `const`。`let` は最小限
2. **純粋関数**: データ変換と副作用（I/O・DB）を分離。コアロジックは「同じ入力 → 同じ出力」を保ち、副作用はハンドラや API クライアントなど端に寄せる
3. **イミュータブル操作**: スプレッド構文（`[...arr, item]` / `{...obj, key}`）を使い、破壊的操作（push/splice/直接代入）を避ける。`map` / `filter` / `reduce` を優先
4. **型安全**: 型システムでコンパイル時保証を得る。エラー処理に union 型・Result 型を活用し、`any` を避ける
5. **構造化ログ**: ログには一貫したプレフィックス `[COMPONENT]` を付け、ID・エラーメッセージ・メタデータなどコンテキストを含める
6. **エラー処理**: 失敗しうる操作は Result 型で扱い、例外を握りつぶさず、文脈のあるメッセージを返す

### 設計原則

- **関心の分離**を保つ
- **state と logic を分離**する
- **可読性・保守性**を最優先する
- **contract 層（API・型）は厳格に**定義し、**実装層は再生成可能**に保つ
- 指示が不明確なら確認する

**例:**

```typescript
// ✅ Good: const、純粋関数、型安全
const parseRankSafely = (rankJson: string | null): ValorantRank | null => {
  if (!rankJson) return null;
  try {
    return JSON.parse(rankJson) as ValorantRank;
  } catch {
    return null;
  }
};

// ❌ Bad: let、ミューテーション、型安全性なし
let result = null;
if (rankJson) {
  try {
    result = JSON.parse(rankJson);
  } catch (e) {
    console.error(e);
  }
}
```

## 環境変数

`.dev.vars.example` を参照。ローカルでは `.dev.vars`、デプロイ環境では `wrangler secret put ... --env <staging|production>` で設定する。

| 変数 | 用途 |
| --- | --- |
| `DISCORD_PUBLIC_KEY` | Discord インタラクションの署名検証 |
| `DISCORD_BOT_TOKEN` | Bot API トークン |
| `DISCORD_APPLICATION_ID` | アプリケーション ID（コマンド登録など） |
| `HENRIKDEV_API_KEY` | VALORANT ランクデータ API キー |
| `DB` | D1 データベースバインディング（Wrangler が自動構成） |

任意・補助:

- `DISCORD_TEST_GUILD_ID`: 単一テストギルドへ即時コマンド登録（省略時はグローバル登録、反映に最大 1 時間）
- `DISABLE_SIGNATURE_VERIFICATION`: テスト時に署名検証を無効化
- `ENVIRONMENT`: 環境識別子（`wrangler.toml` の env ごとに設定）

デプロイ環境は `wrangler.toml` に `development` / `staging` / `production` を定義（staging・production は cron `*/5 * * * *` と各 D1 を持つ）。

## よくあるタスク

### 新しいスラッシュコマンドの追加

1. `scripts/register-commands.ts` にコマンド構造を定義して登録
2. `src/handlers/commands.ts` にハンドラ関数を追加（例: `handleXxxCommand`）
3. `src/index.ts` の APPLICATION_COMMAND ディスパッチャでルーティング
4. 適切な `InteractionResponseType` を返す
5. 必要に応じて `src/shared/validation/schemas.ts` に Zod スキーマを追加

### マッチングロジックの変更

- `src/features/matching/algorithm.ts` を編集
- 主要関数: `computeBestParty(entries)`
- ランクバランスと時間制約を考慮する

### Embed フィールドの追加

- `src/features/discord/embed.ts` を編集
- `buildRecruitEmbed` が Embed 生成を担う
- 新しいパラメータを足す場合は `updateDiscordMessage` の呼び出しも更新

### Discord API 関数の追加

- `src/features/discord/client.ts` を編集
- `src/features/discord/index.ts` から re-export

## 重要な注意点

- ユーザー向けメッセージとコメントは日本語、技術用語は英語のまま
- commit 前に `bun run check`（typecheck + lint + format:check + test）を通す
- コミットはまとめず atomic に
- テストが通ってからコミットする
