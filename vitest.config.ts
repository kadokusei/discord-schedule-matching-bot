import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    globals: true,
    pool: "@cloudflare/vitest-pool-workers",
    poolOptions: {
      workers: {
        singleWorker: true,
        wrangler: {
          configPath: "./wrangler.toml",
        },
        miniflare: {
          bindings: {
            DISCORD_PUBLIC_KEY: "test-public-key",
          },
        },
      },
    },
  },
});
