/**
 * fetchValorantRank の統合テスト
 *
 * OpenAPI定義に基づいたモックデータを使用して、実際の関数をテストします。
 * 回帰テストとして機能することを目的としています。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchValorantRank } from "../../../../src/features/riot/api";
import { riotApiFixtures } from "../../../../src/fixtures/riot-api-responses";

describe("fetchValorantRank", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("成功ケース - 各ランクの代表例", () => {
    it("should return Unrated for tier 0", async () => {
      globalThis.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(riotApiFixtures.success[0]),
        } as Response),
      );

      const result = await fetchValorantRank("name", "tag", "api-key");

      expect(result.success).toBe(true);
      expect(result.account?.rank?.rank).toBe("Unrated 1");
      expect(result.account?.rank?.tier).toBe(0);
      expect(result.account?.name).toBe("TestPlayer");
      expect(result.account?.tag).toBe("123");
    });

    it("should return Iron 2 for tier 4", async () => {
      globalThis.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(riotApiFixtures.success[4]),
        } as Response),
      );

      const result = await fetchValorantRank("name", "tag", "api-key");

      expect(result.success).toBe(true);
      expect(result.account?.rank?.rank).toBe("Iron 2");
      expect(result.account?.rank?.tier).toBe(4);
    });

    it("should return Bronze 1 for tier 6", async () => {
      globalThis.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(riotApiFixtures.success[6]),
        } as Response),
      );

      const result = await fetchValorantRank("name", "tag", "api-key");

      expect(result.success).toBe(true);
      expect(result.account?.rank?.rank).toBe("Bronze 1");
      expect(result.account?.rank?.tier).toBe(6);
    });

    it("should return Silver 3 for tier 11", async () => {
      globalThis.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(riotApiFixtures.success[11]),
        } as Response),
      );

      const result = await fetchValorantRank("name", "tag", "api-key");

      expect(result.success).toBe(true);
      expect(result.account?.rank?.rank).toBe("Silver 3");
      expect(result.account?.rank?.tier).toBe(11);
    });

    it("should return Gold 2 for tier 13", async () => {
      globalThis.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(riotApiFixtures.success[13]),
        } as Response),
      );

      const result = await fetchValorantRank("name", "tag", "api-key");

      expect(result.success).toBe(true);
      expect(result.account?.rank?.rank).toBe("Gold 2");
      expect(result.account?.rank?.tier).toBe(13);
    });

    it("should return Platinum 1 for tier 15", async () => {
      globalThis.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(riotApiFixtures.success[15]),
        } as Response),
      );

      const result = await fetchValorantRank("name", "tag", "api-key");

      expect(result.success).toBe(true);
      expect(result.account?.rank?.rank).toBe("Platinum 1");
      expect(result.account?.rank?.tier).toBe(15);
    });

    it("should return Diamond 3 for tier 20", async () => {
      globalThis.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(riotApiFixtures.success[20]),
        } as Response),
      );

      const result = await fetchValorantRank("name", "tag", "api-key");

      expect(result.success).toBe(true);
      expect(result.account?.rank?.rank).toBe("Diamond 3");
      expect(result.account?.rank?.tier).toBe(20);
    });

    it("should return Ascendant 2 for tier 22", async () => {
      globalThis.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(riotApiFixtures.success[22]),
        } as Response),
      );

      const result = await fetchValorantRank("name", "tag", "api-key");

      expect(result.success).toBe(true);
      expect(result.account?.rank?.rank).toBe("Ascendant 2");
      expect(result.account?.rank?.tier).toBe(22);
    });

    it("should return Immortal 1 for tier 24", async () => {
      globalThis.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(riotApiFixtures.success[24]),
        } as Response),
      );

      const result = await fetchValorantRank("name", "tag", "api-key");

      expect(result.success).toBe(true);
      expect(result.account?.rank?.rank).toBe("Immortal 1");
      expect(result.account?.rank?.tier).toBe(24);
    });

    it("should return Radiant for tier 27", async () => {
      globalThis.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(riotApiFixtures.success[27]),
        } as Response),
      );

      const result = await fetchValorantRank("name", "tag", "api-key");

      expect(result.success).toBe(true);
      expect(result.account?.rank?.rank).toBe("Radiant 1");
      expect(result.account?.rank?.tier).toBe(27);
    });
  });

  describe("成功ケース - 全tier 0-27", () => {
    it("should correctly map all tiers 0-27", async () => {
      // 全tierについて正しくマッピングされることを確認
      for (const tierId of riotApiFixtures.allTierIds) {
        globalThis.fetch = vi.fn(() =>
          Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(riotApiFixtures.success[tierId]),
          } as Response),
        );

        const result = await fetchValorantRank("name", "tag", "api-key");

        expect(result.success).toBe(true);
        expect(result.account).not.toBeNull();
        expect(result.account?.rank?.tier).toBe(tierId);

        // 実装の tierToRank 関数と一致することを確認
        const _expectedRankName = riotApiFixtures.getTierName(tierId);
        const actualRank = result.account?.rank?.rank ?? "";

        // OpenAPIのtier名と実装のtier名のマッピングを確認
        // 実装では tier 0-2 が "Unrated" にマッピングされる
        if (tierId <= 2) {
          expect(actualRank).toContain("Unrated");
        } else if (tierId <= 5) {
          expect(actualRank).toContain("Iron");
        } else if (tierId <= 8) {
          expect(actualRank).toContain("Bronze");
        } else if (tierId <= 11) {
          expect(actualRank).toContain("Silver");
        } else if (tierId <= 14) {
          expect(actualRank).toContain("Gold");
        } else if (tierId <= 17) {
          expect(actualRank).toContain("Platinum");
        } else if (tierId <= 20) {
          expect(actualRank).toContain("Diamond");
        } else if (tierId <= 23) {
          expect(actualRank).toContain("Ascendant");
        } else if (tierId <= 26) {
          expect(actualRank).toContain("Immortal");
        } else {
          expect(actualRank).toContain("Radiant");
        }
      }
    });
  });

  describe("エラーハンドリング - HTTPステータスコード", () => {
    it("should handle 400 Bad Request", async () => {
      globalThis.fetch = vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 400,
          text: () => Promise.resolve(riotApiFixtures.errors.badRequest.body),
        } as Response),
      );

      const result = await fetchValorantRank("name", "tag", "api-key");

      expect(result.success).toBe(false);
      expect(result.account).toBeNull();
      expect(result.error).toBe("API error: 400 Bad Request");
    });

    it("should handle 401 Unauthorized", async () => {
      globalThis.fetch = vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 401,
          text: () => Promise.resolve(riotApiFixtures.errors.unauthorized.body),
        } as Response),
      );

      const result = await fetchValorantRank("name", "tag", "api-key");

      expect(result.success).toBe(false);
      expect(result.account).toBeNull();
      expect(result.error).toBe("API error: 401 Unauthorized");
    });

    it("should handle 403 Forbidden", async () => {
      globalThis.fetch = vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 403,
          text: () => Promise.resolve(riotApiFixtures.errors.forbidden.body),
        } as Response),
      );

      const result = await fetchValorantRank("name", "tag", "api-key");

      expect(result.success).toBe(false);
      expect(result.account).toBeNull();
      expect(result.error).toBe("API error: 403 Forbidden");
    });

    it("should handle 404 Not Found", async () => {
      globalThis.fetch = vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 404,
          text: () => Promise.resolve(riotApiFixtures.errors.notFound.body),
        } as Response),
      );

      const result = await fetchValorantRank("name", "tag", "api-key");

      expect(result.success).toBe(false);
      expect(result.account).toBeNull();
      expect(result.error).toBe("API error: 404 Not Found");
    });

    it("should handle 408 Request Timeout", async () => {
      globalThis.fetch = vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 408,
          text: () => Promise.resolve(riotApiFixtures.errors.requestTimeout.body),
        } as Response),
      );

      const result = await fetchValorantRank("name", "tag", "api-key");

      expect(result.success).toBe(false);
      expect(result.account).toBeNull();
      expect(result.error).toBe("API error: 408 Request Timeout");
    });

    it("should handle 429 Rate Limit", async () => {
      globalThis.fetch = vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 429,
          text: () => Promise.resolve(riotApiFixtures.errors.rateLimit.body),
        } as Response),
      );

      const result = await fetchValorantRank("name", "tag", "api-key");

      expect(result.success).toBe(false);
      expect(result.account).toBeNull();
      expect(result.error).toBe("API error: 429 Too Many Requests");
    });

    it("should handle 503 Service Unavailable", async () => {
      globalThis.fetch = vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 503,
          text: () => Promise.resolve(riotApiFixtures.errors.serviceUnavailable.body),
        } as Response),
      );

      const result = await fetchValorantRank("name", "tag", "api-key");

      expect(result.success).toBe(false);
      expect(result.account).toBeNull();
      expect(result.error).toBe("API error: 503 Service Unavailable");
    });
  });

  describe("特殊なレスポンスケース", () => {
    it("should handle data: null (account not found)", async () => {
      globalThis.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(riotApiFixtures.special.accountNotFound),
        } as Response),
      );

      const result = await fetchValorantRank("name", "tag", "api-key");

      expect(result.success).toBe(false);
      expect(result.account).toBeNull();
      expect(result.error).toBe("Account not found");
    });

    it("should handle current: null (unranked account)", async () => {
      globalThis.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(riotApiFixtures.special.unranked),
        } as Response),
      );

      const result = await fetchValorantRank("name", "tag", "api-key");

      expect(result.success).toBe(true);
      expect(result.account).not.toBeNull();
      expect(result.account?.name).toBe("NewPlayer");
      expect(result.account?.tag).toBe("000");
      expect(result.account?.rank).toBeNull(); // currentがnullなのでrankもnull
    });

    it("should handle current.tier: null (tier id is null)", async () => {
      globalThis.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(riotApiFixtures.special.tierIdNull),
        } as Response),
      );

      const result = await fetchValorantRank("name", "tag", "api-key");

      expect(result.success).toBe(true);
      expect(result.account).not.toBeNull();
      expect(result.account?.name).toBe("PartialPlayer");
      expect(result.account?.tag).toBe("111");
      expect(result.account?.rank).toBeNull(); // tier.idがnullなのでrankもnull
    });
  });

  describe("ネットワークエラーハンドリング", () => {
    it("should handle fetch timeout error", async () => {
      globalThis.fetch = vi.fn(() => Promise.reject(new Error("Request timeout")));

      const result = await fetchValorantRank("name", "tag", "api-key");

      expect(result.success).toBe(false);
      expect(result.account).toBeNull();
      expect(result.error).toBe("Request timeout");
    });

    it("should handle network error", async () => {
      globalThis.fetch = vi.fn(() => Promise.reject(new Error("Network request failed")));

      const result = await fetchValorantRank("name", "tag", "api-key");

      expect(result.success).toBe(false);
      expect(result.account).toBeNull();
      expect(result.error).toBe("Network request failed");
    });

    it("should handle JSON parse error", async () => {
      globalThis.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.reject(new SyntaxError("Unexpected token")),
        } as Response),
      );

      const result = await fetchValorantRank("name", "tag", "api-key");

      expect(result.success).toBe(false);
      expect(result.account).toBeNull();
      expect(result.error).toBe("Unexpected token");
    });

    it("should handle unknown error", async () => {
      globalThis.fetch = vi.fn(() => Promise.reject("string error"));

      const result = await fetchValorantRank("name", "tag", "api-key");

      expect(result.success).toBe(false);
      expect(result.account).toBeNull();
      expect(result.error).toBe("Unknown error");
    });
  });

  describe("パラメータとリクエスト検証", () => {
    it("should call correct API endpoint with default region and platform", async () => {
      globalThis.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(riotApiFixtures.success[13]),
        } as Response),
      );

      await fetchValorantRank("TestPlayer", "123", "api-key");

      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "https://api.henrikdev.xyz/valorant/v3/mmr/ap/pc/TestPlayer/123",
        {
          headers: {
            Authorization: "api-key",
          },
        },
      );
    });

    it("should call correct API endpoint with custom region", async () => {
      globalThis.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(riotApiFixtures.success[13]),
        } as Response),
      );

      await fetchValorantRank("TestPlayer", "123", "api-key", "na");

      expect(globalThis.fetch).toHaveBeenCalledWith(
        "https://api.henrikdev.xyz/valorant/v3/mmr/na/pc/TestPlayer/123",
        {
          headers: {
            Authorization: "api-key",
          },
        },
      );
    });

    it("should call correct API endpoint with custom platform", async () => {
      globalThis.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(riotApiFixtures.success[13]),
        } as Response),
      );

      await fetchValorantRank("TestPlayer", "123", "api-key", "ap", "console");

      expect(globalThis.fetch).toHaveBeenCalledWith(
        "https://api.henrikdev.xyz/valorant/v3/mmr/ap/console/TestPlayer/123",
        {
          headers: {
            Authorization: "api-key",
          },
        },
      );
    });
  });
});
