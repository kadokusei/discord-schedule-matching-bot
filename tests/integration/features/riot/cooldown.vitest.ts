import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../../../src/db/schema";
import { readCooldownUntilMs, writeCooldownUntil } from "../../../../src/features/riot/cooldown";

describe("cooldown (D1)", () => {
  const db = drizzle(env.DB, { schema });

  beforeEach(async () => {
    await db.delete(schema.apiRateLimits);
  });

  it("記録がなければ null を返す", async () => {
    expect(await readCooldownUntilMs(db)).toBeNull();
  });

  it("書き込んだ解除時刻(ms)を読み戻せる", async () => {
    const until = 1_700_000_000_000;
    await writeCooldownUntil(db, until);
    expect(await readCooldownUntilMs(db)).toBe(until);
  });

  it("複数回書き込むと最後の解除時刻で上書きされ、行は単一に保たれる", async () => {
    await writeCooldownUntil(db, 1_700_000_000_000);
    await writeCooldownUntil(db, 1_700_000_060_000);

    expect(await readCooldownUntilMs(db)).toBe(1_700_000_060_000);

    const rows = await db
      .select()
      .from(schema.apiRateLimits)
      .where(eq(schema.apiRateLimits.apiName, "henrikdev_cooldown"))
      .all();
    expect(rows.length).toBe(1);
  });
});
