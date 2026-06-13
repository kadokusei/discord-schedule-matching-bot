import { and, eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../../db/schema";
import { RateLimiter } from "./rate-limiter";

// キャッシュ期間の定数
const CACHE_DURATION_MS_NORMAL = 24 * 60 * 60 * 1000; // 24時間
const CACHE_DURATION_MS_JOINING = 5 * 60 * 1000; // 5分

export interface ValorantRank {
  tier: number;
  division: string;
  rank: string;
}

export interface ValorantAccount {
  name: string;
  tag: string;
  rank: ValorantRank | null;
}

/** 失敗理由のカテゴリ。ユーザー向け文言の出し分けに使う（error は詳細・ログ用）。 */
export type FetchRankErrorCode = "not_found" | "rate_limited" | "upstream" | "network";

export interface FetchRankResult {
  success: boolean;
  account: ValorantAccount | null;
  error: string | null;
  /** 機械可読な失敗カテゴリ。success 時は undefined。 */
  errorCode?: FetchRankErrorCode;
  fromCache?: boolean;
  remainingRequests?: number;
}

export interface FetchRankWithCacheOptions {
  /** キャッシュの有効期間（ミリ秒）。デフォルト: 1時間 */
  cacheDurationMs?: number;
  /** 参加時フラグ。trueの場合、キャッシュ期間を短くして更新頻度を上げる */
  isJoining?: boolean;
  /** リージョン（例: "ap", "na", "eu", "kr"）。指定なしの場合、既存アカウントのリージョンまたは "ap" を使用 */
  region?: string;
}

export async function fetchValorantRank(
  gameName: string,
  tagLine: string,
  apiKey: string,
  region = "ap",
  platform = "pc",
): Promise<FetchRankResult> {
  try {
    // ゲーム名・タグは空白や記号を含み得るため、パスインジェクション/リクエスト破損を防ぐべく
    // 全セグメントを encodeURIComponent でエンコードする。
    const path = [region, platform, gameName, tagLine].map(encodeURIComponent).join("/");
    const response = await fetch(`https://api.henrikdev.xyz/valorant/v3/mmr/${path}`, {
      headers: {
        Authorization: apiKey,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      return {
        success: false,
        account: null,
        error: `API error: ${response.status} ${text}`,
        errorCode: "upstream",
      };
    }

    const data = (await response.json()) as {
      data: {
        account: {
          name: string;
          tag: string;
        };
        current: {
          tier: {
            id: number;
            name: string;
          };
        } | null;
      } | null;
    };

    if (!data.data) {
      return {
        success: false,
        account: null,
        error: "Account not found",
        errorCode: "not_found",
      };
    }

    const currentTier = data.data.current?.tier?.id ?? null;
    const rank = currentTier !== null ? tierToRank(currentTier, 0) : null;

    return {
      success: true,
      account: {
        name: data.data.account.name,
        tag: data.data.account.tag,
        rank,
      },
      error: null,
    };
  } catch (error) {
    return {
      success: false,
      account: null,
      error: error instanceof Error ? error.message : "Unknown error",
      errorCode: "network",
    };
  }
}

function tierToRank(tier: number, _division: number): ValorantRank {
  const ranks = [
    "Unrated",
    "Iron",
    "Bronze",
    "Silver",
    "Gold",
    "Platinum",
    "Diamond",
    "Ascendant",
    "Immortal",
    "Radiant",
  ];

  const tierIndex = Math.floor(tier / 3);
  const divisionIndex = tier % 3;

  const rankName = ranks[tierIndex] ?? "Unrated";
  const divisions = ["1", "2", "3"];
  const divisionName = divisions[divisionIndex] ?? "1";

  return {
    tier,
    division: divisionName,
    rank: `${rankName} ${divisionName}`,
  };
}

export function formatRankLabel(account: ValorantAccount): string {
  if (!account.rank) {
    return `${account.name}#${account.tag} (Unrated)`;
  }
  return `${account.name}#${account.tag} (${account.rank.rank})`;
}

/**
 * /riot add の結果からユーザー向け文言とログ用詳細を生成する。
 * 上流APIの生エラー（ステータス・本文）はユーザーに見せず汎用文言にし、
 * 詳細は logDetail（呼び出し側で console.error する）へ回す。
 */
export const buildRiotAddOutcome = (
  result: FetchRankResult,
): { message: string; logDetail: string | null } => {
  if (result.success && result.account) {
    const cacheMessage = result.fromCache ? " (キャッシュ)" : "";
    return {
      message: `アカウントを登録しました${cacheMessage}: ${formatRankLabel(result.account)}`,
      logDetail: null,
    };
  }

  switch (result.errorCode) {
    case "not_found":
      return {
        message:
          "エラー: 指定したアカウントが見つかりませんでした。ゲーム名・タグ・リージョンをご確認ください",
        logDetail: null,
      };
    case "rate_limited":
      return {
        message: "エラー: 現在リクエストが集中しています。しばらくしてから再度お試しください",
        logDetail: result.error,
      };
    default:
      // upstream / network / 未分類: 生エラーはユーザーに出さずログのみに残す
      return {
        message: "エラー: アカウント情報の取得に失敗しました。しばらくしてから再度お試しください",
        logDetail: result.error,
      };
  }
};

const parseRankSafely = (rankJson: string | null): ValorantRank | null => {
  if (!rankJson) return null;

  try {
    return JSON.parse(rankJson) as ValorantRank;
  } catch {
    return null;
  }
};

/**
 * riot_accounts.rank に保存された JSON 文字列からランク表示名（例: "Gold 2"）を取り出す。
 * 未ランク/未保存/不正は null。
 */
export const rankStringFromStored = (rankJson: string | null): string | null => {
  const parsed = parseRankSafely(rankJson);
  return parsed?.rank ?? null;
};

export async function fetchValorantRankWithCache(
  gameName: string,
  tagLine: string,
  userId: string,
  db: DrizzleD1Database<typeof schema>,
  apiKey: string,
  options?: FetchRankWithCacheOptions,
): Promise<FetchRankResult> {
  const isJoining = options?.isJoining ?? false;
  const cacheDurationMs =
    options?.cacheDurationMs ?? (isJoining ? CACHE_DURATION_MS_JOINING : CACHE_DURATION_MS_NORMAL);
  const explicitRegion = options?.region;
  const nowUtc = Date.now();
  const cacheExpiryUtc = nowUtc - cacheDurationMs;

  // 既存アカウントを検索（gameName/tagLineで一致するものを探す）
  const existingAccount = await db
    .select()
    .from(schema.riotAccounts)
    .where(
      and(
        eq(schema.riotAccounts.userId, userId),
        eq(schema.riotAccounts.gameName, gameName),
        eq(schema.riotAccounts.tagLine, tagLine),
      ),
    )
    .get();

  // キャッシュの有効性チェック
  if (existingAccount) {
    const lastFetchedTime = new Date(existingAccount.lastFetchedAtUtc).getTime();
    if (lastFetchedTime > cacheExpiryUtc) {
      // キャッシュが有効
      const rank = parseRankSafely(existingAccount.rank);
      return {
        success: true,
        account: {
          name: existingAccount.gameName,
          tag: existingAccount.tagLine,
          rank,
        },
        error: null,
        fromCache: true,
      };
    }
  }

  // リージョンの決定: 明示指定 > 既存アカウントの保存値 > デフォルト "ap"
  const region = explicitRegion ?? existingAccount?.region ?? "ap";

  // レートリミットチェック
  const rateLimiter = new RateLimiter(db);
  const rateLimitResult = await rateLimiter.checkRateLimit();

  if (!rateLimitResult.allowed) {
    // レートリミット到達時：古いキャッシュがあればそれを返す
    if (existingAccount) {
      const rank = parseRankSafely(existingAccount.rank);
      return {
        success: true,
        account: {
          name: existingAccount.gameName,
          tag: existingAccount.tagLine,
          rank,
        },
        error: null,
        fromCache: true,
      };
    }
    // キャッシュもない場合はエラー
    return {
      success: false,
      account: null,
      error: `Rate limit exceeded. Please wait ${Math.ceil((rateLimitResult.waitTimeMs ?? 0) / 1000)} seconds.`,
      errorCode: "rate_limited",
      remainingRequests: 0,
    };
  }

  // API呼び出し
  const apiResult = await fetchValorantRank(gameName, tagLine, apiKey, region);

  if (!apiResult.success || !apiResult.account) {
    // API失敗時：古いキャッシュがあればそれを返す
    if (existingAccount) {
      const rank = parseRankSafely(existingAccount.rank);
      return {
        success: true,
        account: {
          name: existingAccount.gameName,
          tag: existingAccount.tagLine,
          rank,
        },
        error: null,
        fromCache: true,
      };
    }
    // キャッシュもない場合はAPIエラーを返す
    return {
      ...apiResult,
      remainingRequests: rateLimitResult.remainingRequests,
    };
  }

  // API成功時：アカウント情報を更新
  const currentUtc = new Date(nowUtc).toISOString();
  const rankJson = apiResult.account.rank ? JSON.stringify(apiResult.account.rank) : "";

  // アカウント情報をupsert
  await db
    .insert(schema.riotAccounts)
    .values({
      id: crypto.randomUUID(),
      userId,
      gameName: apiResult.account.name,
      tagLine: apiResult.account.tag,
      region,
      rank: rankJson,
      createdAtUtc: currentUtc,
      lastFetchedAtUtc: currentUtc,
    })
    .onConflictDoUpdate({
      target: [
        schema.riotAccounts.userId,
        schema.riotAccounts.gameName,
        schema.riotAccounts.tagLine,
      ],
      set: {
        rank: rankJson,
        lastFetchedAtUtc: currentUtc,
      },
    });

  return {
    success: true,
    account: apiResult.account,
    error: null,
    fromCache: false,
    remainingRequests: rateLimitResult.remainingRequests - 1,
  };
}
