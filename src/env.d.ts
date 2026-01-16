import type { ProvidedEnv } from "@cloudflare/vitest-pool-workers";

interface ExtendedEnv extends ProvidedEnv {
  DISCORD_PUBLIC_KEY: string;
}

declare module "cloudflare:test" {
  export const SELF: Fetcher;
  export const env: ExtendedEnv;
}
