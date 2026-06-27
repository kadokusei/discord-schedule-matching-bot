export interface Env {
  DISCORD_PUBLIC_KEY: string;
  DISCORD_BOT_TOKEN: string;
  DISCORD_APPLICATION_ID: string;
  HENRIKDEV_API_KEY: string;
  DB: D1Database;
  /** wrangler.toml の vars で設定される実行環境名（development/staging/production）。 */
  ENVIRONMENT?: string;
  DISABLE_SIGNATURE_VERIFICATION?: string;
  /** コマンド登録スクリプト用（ギルド限定登録）。本番はグローバル登録。 */
  DISCORD_TEST_GUILD_ID?: string;
}

/** ハンドラが必要とする ExecutionContext の最小インターフェース（waitUntil のみ） */
export interface WaitUntilContext {
  waitUntil(promise: Promise<unknown>): void;
}
