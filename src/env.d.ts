import type { Env } from "./lib/types";
import type { D1Migration } from "cloudflare:test";

interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

declare module "cloudflare:test" {
  interface ProvidedEnv extends TestEnv {}
}
