/**
 * recruit のライフサイクル状態。
 * - open / matched: アクティブ（参加・時間選択・キャンセル等の操作を受け付ける）
 * - closed / cancelled / deleted: 終端（以降の操作は受け付けない）
 */
export type RecruitStatus = "open" | "matched" | "closed" | "cancelled" | "deleted";

const ACTIVE_STATUSES: ReadonlySet<string> = new Set<RecruitStatus>(["open", "matched"]);

/**
 * recruit がまだアクティブ（操作受付可能）かどうか。
 * 終端状態（closed/cancelled/deleted）に対する操作はこれで弾く。
 */
export const isRecruitActive = (status: string): boolean => ACTIVE_STATUSES.has(status);
