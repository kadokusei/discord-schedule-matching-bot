/**
 * OpenAPI定義に基づいたHenrikDev API v3 MMRレスポンスのフィクスチャ
 *
 * OpenAPI Schema: https://app.swaggerhub.com/apiproxy/registry/Henrik-3/HenrikDev-API/4.2.1
 * Endpoint: /valorant/v3/mmr/{region}/{platform}/{name}/{tag}
 */

import type { components } from "../features/riot/api.schema";

type TierName = components["schemas"]["tiers"];

/**
 * V3MmrResponse - 実際のAPI実装に基づいた型定義
 *
 * 注: OpenAPI定義（api.schema.ts）では data や current はオプショナル(?)
 *    ですが、実際のAPIでは null が返されるケースがあるため、
 *    ここでは明示的に | null を付けて型安全性を確保しています。
 */
type V3MmrResponse = {
  status: number;
  data: {
    account: {
      puuid?: string;
      name?: string;
      tag?: string;
    };
    peak?: {
      season?: { id?: string; short?: string };
      ranking_schema?: string;
      rr?: number;
      tier?: {
        id?: number;
        name?: TierName;
      };
    } | null;
    current?: {
      tier?: {
        id?: number;
        name?: TierName;
      } | null;
      rr?: number;
      elo?: number;
      last_change?: number;
      games_needed_for_rating?: number;
      rank_protection_shields?: number;
      leaderboard_placement?: {
        rank?: number;
        updated_at?: string;
      } | null;
    } | null;
    seasonal?: {
      season?: { id?: string; short?: string };
      wins?: number;
      games?: number;
      end_tier?: {
        id?: number;
        name?: TierName;
      };
      end_rr?: number;
      ranking_schema?: string;
      leaderboard_placement?: {
        rank?: number;
        updated_at?: string;
      } | null;
      act_wins?: {
        id?: number;
        name?: TierName;
      }[];
    }[];
  } | null;
};

/**
 * tier ID に対応する name のマッピング (OpenAPI tiers enum に基づく)
 */
const TIER_NAMES: readonly [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27] = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22,
  23, 24, 25, 26, 27,
] as const;

const TIER_NAME_MAP = {
  0: "Unrated",
  1: "Unknown 1",
  2: "Unknown 2",
  3: "Iron 1",
  4: "Iron 2",
  5: "Iron 3",
  6: "Bronze 1",
  7: "Bronze 2",
  8: "Bronze 3",
  9: "Silver 1",
  10: "Silver 2",
  11: "Silver 3",
  12: "Gold 1",
  13: "Gold 2",
  14: "Gold 3",
  15: "Platinum 1",
  16: "Platinum 2",
  17: "Platinum 3",
  18: "Diamond 1",
  19: "Diamond 2",
  20: "Diamond 3",
  21: "Ascendant 1",
  22: "Ascendant 2",
  23: "Ascendant 3",
  24: "Immortal 1",
  25: "Immortal 2",
  26: "Immortal 3",
  27: "Radiant",
} as const satisfies Record<number, TierName>;

/**
 * 指定した tier ID の成功レスポンスを生成するヘルパー関数
 */
function createSuccessResponse(
  tierId: number,
  name = "TestPlayer",
  tag = "123",
): V3MmrResponse {
  const tierName = (TIER_NAME_MAP as Record<number, TierName>)[tierId] ?? "Unrated";
  return {
    status: 200,
    data: {
      account: {
        puuid: "00000000-0000-0000-0000-000000000000",
        name,
        tag,
      },
      current: {
        tier: {
          id: tierId,
          name: tierName,
        },
        rr: 50,
        elo: 1500,
        last_change: 10,
        games_needed_for_rating: 0,
        rank_protection_shields: 0,
        leaderboard_placement: null,
      },
      peak: {
        season: { id: "e1a1", short: "e1a1" },
        ranking_schema: "base",
        rr: 100,
        tier: {
          id: tierId,
          name: tierName,
        },
      },
      seasonal: [],
    },
  };
}

/**
 * tier ID 0-27 の全成功レスポンス
 */
const successResponses: Record<number, V3MmrResponse> = {} as Record<
  number,
  V3MmrResponse
>;
for (const tierId of TIER_NAMES) {
  successResponses[tierId] = createSuccessResponse(tierId);
}

/**
 * HenrikDev API v3 MMR エンドポイントのフィクスチャデータ
 */
export const riotApiFixtures = {
  /**
   * 成功レスポンス (tier 0-27 全パターン)
   */
  success: successResponses,

  /**
   * 各ランクの代表サンプル
   */
  samples: {
    /** Unrated (tier 0-2) */
    unrated: createSuccessResponse(0, "UnratedPlayer", "000"),
    /** Iron 2 (tier 4) */
    iron2: createSuccessResponse(4, "IronPlayer", "111"),
    /** Bronze 1 (tier 6) */
    bronze1: createSuccessResponse(6, "BronzePlayer", "222"),
    /** Silver 3 (tier 11) */
    silver3: createSuccessResponse(11, "SilverPlayer", "333"),
    /** Gold 2 (tier 13) */
    gold2: createSuccessResponse(13, "GoldPlayer", "444"),
    /** Platinum 1 (tier 15) */
    platinum1: createSuccessResponse(15, "PlatinumPlayer", "555"),
    /** Diamond 3 (tier 20) */
    diamond3: createSuccessResponse(20, "DiamondPlayer", "666"),
    /** Ascendant 2 (tier 22) */
    ascendant2: createSuccessResponse(22, "AscendantPlayer", "777"),
    /** Immortal 1 (tier 24) */
    immortal1: createSuccessResponse(24, "ImmortalPlayer", "888"),
    /** Radiant (tier 27) */
    radiant: createSuccessResponse(27, "RadiantPlayer", "999"),
  },

  /**
   * エラーレスポンス
   */
  errors: {
    /** 400 Bad Request - 無効なリクエストパラメータ */
    badRequest: {
      status: 400,
      body: "Bad Request",
    },

    /** 401 Unauthorized - 無効なAPIキー */
    unauthorized: {
      status: 401,
      body: "Unauthorized",
    },

    /** 403 Forbidden - APIキーなしまたはアクセス拒否 */
    forbidden: {
      status: 403,
      body: "Forbidden",
    },

    /** 404 Not Found - アカウントが見つからない */
    notFound: {
      status: 404,
      body: "Not Found",
    },

    /** 408 Request Timeout - リクエストタイムアウト */
    requestTimeout: {
      status: 408,
      body: "Request Timeout",
    },

    /** 429 Too Many Requests - レートリミット超過 */
    rateLimit: {
      status: 429,
      body: "Too Many Requests",
    },

    /** 501 Not Implemented */
    notImplemented: {
      status: 501,
      body: "Not Implemented",
    },

    /** 503 Service Unavailable - サーバーメンテナンス等 */
    serviceUnavailable: {
      status: 503,
      body: "Service Unavailable",
    },
  },

  /**
   * 特殊なレスポンスケース
   */
  special: {
    /**
     * data: null - アカウント未検出 (404と同じ扱いになるケース)
     *
     * 注: 実際のAPIでは data が null のケースは 404 として返されることが多いですが、
     *     実装の robustness を確認するためにこのケースもテストします
     */
    accountNotFound: {
      status: 200,
      data: null,
    },

    /**
     * current: null - ランク未設定アカウント
     *
     * アカウントは存在するが、まだランクマッチをプレイしていない場合
     */
    unranked: {
      status: 200,
      data: {
        account: {
          puuid: "00000000-0000-0000-0000-000000000000",
          name: "NewPlayer",
          tag: "000",
        },
        current: null,
        peak: null,
        seasonal: [],
      },
    },

    /**
     * current.tier: null - tier オブジェクトが null のケース
     *
     * tier オブジェクトは存在するが id が null
     */
    tierIdNull: {
      status: 200,
      data: {
        account: {
          puuid: "00000000-0000-0000-0000-000000000000",
          name: "PartialPlayer",
          tag: "111",
        },
        current: {
          tier: null,
          rr: 0,
          elo: 0,
          last_change: 0,
          games_needed_for_rating: 0,
          rank_protection_shields: 0,
          leaderboard_placement: null,
        },
        peak: null,
        seasonal: [],
      },
    },

    /**
     * leaderboard_placement があるケース
     */
    withLeaderboard: {
      status: 200,
      data: {
        account: {
          puuid: "00000000-0000-0000-0000-000000000000",
          name: "TopPlayer",
          tag: "999",
        },
        current: {
          tier: {
            id: 27,
            name: "Radiant",
          },
          rr: 500,
          elo: 2500,
          last_change: 20,
          games_needed_for_rating: 0,
          rank_protection_shields: 0,
          leaderboard_placement: {
            rank: 100,
            updated_at: "2024-01-01T00:00:00Z",
          },
        },
        peak: {
          season: { id: "e1a1", short: "e1a1" },
          ranking_schema: "base",
          rr: 600,
          tier: {
            id: 27,
            name: "Radiant",
          },
        },
        seasonal: [
          {
            season: { id: "e1a1", short: "e1a1" },
            wins: 50,
            games: 100,
            end_tier: {
              id: 27,
              name: "Radiant",
            },
            end_rr: 500,
            ranking_schema: "base",
            leaderboard_placement: {
              rank: 50,
              updated_at: "2024-01-01T00:00:00Z",
            },
            act_wins: [],
          },
        ],
      },
    },
  },

  /**
   * ヘルパー: 指定した tier ID の成功レスポンスを取得
   */
  createSuccessResponse,

  /**
   * ヘルパー: tier ID から tier name を取得
   */
  getTierName: (tierId: number): string => {
    return (TIER_NAME_MAP as Record<number, TierName>)[tierId] ?? "Unrated";
  },

  /**
   * 全 tier ID のリスト
   */
  allTierIds: TIER_NAMES,
} as const;

export type RiotApiFixtures = typeof riotApiFixtures;
