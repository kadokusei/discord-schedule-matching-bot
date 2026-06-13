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
