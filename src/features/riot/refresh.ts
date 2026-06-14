import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../../db/schema";
import { fetchValorantRankWithCache } from "./api";
import type { FetchRankResult } from "./api";

/** アカウント 1 件分の再取得結果。 */
export interface AccountRefreshResult {
  gameName: string;
  tagLine: string;
  result: FetchRankResult;
}

export interface RefreshUserRanksOptions {
  /** キャッシュ有効期間(ms)。0 を渡すとキャッシュを強制バイパスする（手動 refresh 用）。 */
  cacheDurationMs?: number;
  /** 参加時フラグ。cacheDurationMs 未指定時にキャッシュ期間を短縮する。 */
  isJoining?: boolean;
}

/**
 * ユーザーの登録済み全 VALORANT アカウントのランクを再取得する。
 * 副作用（DB 読み書き・API 呼び出し）は fetchValorantRankWithCache に委譲し、
 * ここではアカウントごとの結果を集約して返すだけにする（呼び出し側で表示・件数に利用）。
 */
export const refreshUserRanks = async (
  userId: string,
  db: DrizzleD1Database<typeof schema>,
  apiKey: string,
  options?: RefreshUserRanksOptions,
): Promise<AccountRefreshResult[]> => {
  const userAccounts = await db
    .select()
    .from(schema.riotAccounts)
    .where(eq(schema.riotAccounts.userId, userId))
    .all();

  const settledResults = await Promise.allSettled(
    userAccounts.map((account) =>
      fetchValorantRankWithCache(account.gameName, account.tagLine, userId, db, apiKey, {
        cacheDurationMs: options?.cacheDurationMs,
        isJoining: options?.isJoining,
      }),
    ),
  );

  return userAccounts.map((account, i) => {
    const settled = settledResults[i];
    const result: FetchRankResult =
      settled?.status === "fulfilled"
        ? settled.value
        : {
            success: false,
            account: null,
            error: settled?.reason instanceof Error ? settled.reason.message : "Unknown error",
            errorCode: "network",
          };
    return { gameName: account.gameName, tagLine: account.tagLine, result };
  });
};

/**
 * 再取得結果からユーザー向けの要約メッセージを組み立てる（純粋関数）。
 * 更新成功・レート制限（前回値）・取得失敗を区別して 1 行ずつ表示する。
 */
export const buildRefreshSummary = (results: AccountRefreshResult[]): string => {
  const updatedCount = results.filter(
    (r) => r.result.success && r.result.fromCache !== true,
  ).length;

  const lines = results.map(({ gameName, tagLine, result }) => {
    const label = `${gameName}#${tagLine}`;
    const rank = result.account?.rank?.rank;

    // 新規取得に成功（キャッシュ由来でない）
    if (result.success && result.fromCache !== true) {
      return `- ${label} (${rank ?? "Unrated"})`;
    }
    // レート制限中（cooldown 含む）。前回値があれば併記する。
    if (result.errorCode === "rate_limited" || (result.success && result.fromCache === true)) {
      return `- ${label} (レート制限中: ${rank ? `${rank}・前回値` : "前回値なし"})`;
    }
    // その他の取得失敗
    return `- ${label} (取得失敗${rank ? `: ${rank}・前回値` : ""})`;
  });

  return [`${results.length}件中 ${updatedCount}件を更新しました`, ...lines].join("\n");
};
