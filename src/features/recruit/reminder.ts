import { buildTimeOptions } from "../../shared/time";

export interface ReminderSlotParams {
  targetDateLocal: string;
  postTimeHHmm: string;
  intervalMin: number;
  durationMin: number;
  /** 参加登録時刻（UTC ISO8601）。登録直後スロットのスキップ判定に使う。 */
  createdAtUtc: string;
  /** 直近リマインドのスロット時刻（UTC ISO8601）。同一スロット重複送信の抑制に使う。 */
  lastRemindedAtUtc: string | null;
}

/**
 * 時間未入力(pending_time)ユーザーへ、いま送るべきリマインドのスロット時刻(UTC ISO8601)を返す。
 * 送信不要なら null。
 *
 * - リマインドは募集開始時刻からの interval スロット境界に揃える（少人数提案と同一グリッド）。
 * - 登録直後のスロットはスキップする（例: 20:13 登録なら 20:15 はスキップし 20:30 が初回）。
 * - 同一スロットで送信済み（lastRemindedAtUtc === currentSlot）なら送らない。
 */
export function reminderSlotToSend(
  params: ReminderSlotParams,
  tz: string,
  nowUtc: Date,
): string | null {
  const slots = buildTimeOptions(
    params.targetDateLocal,
    params.postTimeHHmm,
    params.intervalMin,
    params.durationMin,
    tz,
  ).map((o) => o.value);

  if (slots.length === 0) return null;

  const nowMs = nowUtc.getTime();
  const finalSlotMs = new Date(slots[slots.length - 1]).getTime();

  // 募集枠の最終スロットを過ぎたら対象外
  if (nowMs > finalSlotMs) return null;

  const pastSlots = slots.filter((s) => new Date(s).getTime() <= nowMs);
  if (pastSlots.length === 0) return null; // 最初のスロット前
  const currentSlot = pastSlots[pastSlots.length - 1];

  // 登録直後スロット（slotsAfterJoin[0]）をスキップし、初回送信は slotsAfterJoin[1] から
  const createdMs = new Date(params.createdAtUtc).getTime();
  const slotsAfterJoin = slots.filter((s) => new Date(s).getTime() > createdMs);
  const firstTargetSlot = slotsAfterJoin[1];
  if (!firstTargetSlot) return null; // 送信対象スロットが存在しない

  if (new Date(currentSlot).getTime() < new Date(firstTargetSlot).getTime()) {
    return null; // 初回対象スロット未到来
  }

  if (params.lastRemindedAtUtc === currentSlot) {
    return null; // 同一スロットで送信済み
  }

  return currentSlot;
}

export function buildReminderMessage(_recruitId: string): string {
  return "希望時間の登録がまだです！\n募集メッセージのセレクトメニューから希望時間を選択してください。";
}

/**
 * 「未定」で登録したユーザーへ、人数が揃ったタイミングで希望時間の確定を促すメッセージ。
 */
export function buildUndecidedNudge(): string {
  return "メンバーが揃ってきました！\n希望時間を選択すると、パーティ編成の対象になります。";
}
