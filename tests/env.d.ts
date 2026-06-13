interface Env {
  DB: D1Database;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_BOT_TOKEN: string;
  HENRIKDEV_API_KEY: string;
}

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}
