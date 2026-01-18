import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    globals: true,
    include: ["**/*.test.ts", "**/*.vitest.ts"],
    pool: "@cloudflare/vitest-pool-workers",
    poolOptions: {
      workers: {
        singleWorker: true,
        main: "./src/index.ts",
        miniflare: {
          bindings: {
            DISCORD_PUBLIC_KEY: "test-public-key",
            HENRIKDEV_API_KEY: "test-api-key",
            DISABLE_SIGNATURE_VERIFICATION: "true",
          },
          d1Databases: {
            DB: ":memory:",
          },
        },
      },
    },
  },
});
