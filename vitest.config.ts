import path from "node:path";
import {
  defineWorkersConfig,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig(async () => {
  // Read all migrations in `migrations` directory
  const migrationsPath = path.join(__dirname, "migrations");
  const migrations = await readD1Migrations(migrationsPath);

  return {
    test: {
      globals: true,
      include: ["**/*.test.ts", "**/*.vitest.ts"],
      pool: "@cloudflare/vitest-pool-workers",
      setupFiles: ["./tests/setup.ts"],
      // discord-api-types の v10.mjs→v10.js サブパス解決が workerd で失敗するため、
      // Vite 側でバンドルさせる（vitest-pool-workers の既知の問題）。
      deps: {
        optimizer: {
          ssr: {
            enabled: true,
            include: ["discord-api-types/v10"],
          },
        },
      },
      poolOptions: {
        workers: {
          singleWorker: true,
          main: "./src/index.ts",
          wrangler: {
            configPath: "./wrangler.toml",
          },
          miniflare: {
            // Add a test-only binding for migrations, so we can apply them in a
            // setup file
            bindings: {
              DISCORD_PUBLIC_KEY: "test-public-key",
              DISCORD_APPLICATION_ID: "test-app-id",
              DISCORD_BOT_TOKEN: "test-bot-token",
              HENRIKDEV_API_KEY: "test-api-key",
              DISABLE_SIGNATURE_VERIFICATION: "true",
              TEST_MIGRATIONS: migrations,
            },
            d1Databases: {
              DB: ":memory:",
            },
          },
        },
      },
    },
  };
});
