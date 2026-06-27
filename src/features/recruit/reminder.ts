/**
 * 「未定」で登録したユーザーへ、人数が揃ったタイミングで希望時間の確定を促すメッセージ。
 */
export function buildUndecidedNudge(): string {
  return "メンバーが揃ってきました！\n希望時間を選択すると、パーティ編成の対象になります。";
}

/**
 * 未定者への再リマインド要否。初回(lastRemindedAtUtc===null)は即時、
 * 以降は前回リマインドから intervalMin 経過ごとに再送する。
 * recomputeMatch は参加者変動（時間選択/未定/取消）時のみ発火するため、
 * 発火ごとにこの判定を行えば「イベント駆動かつ間隔スロットル」になり毎回再送はされない。
 */
export function shouldRemindUndecided(
  lastRemindedAtUtc: string | null,
  nowUtc: Date,
  intervalMin: number,
): boolean {
  if (lastRemindedAtUtc === null) return true;
  return nowUtc.getTime() - new Date(lastRemindedAtUtc).getTime() >= intervalMin * 60_000;
}
