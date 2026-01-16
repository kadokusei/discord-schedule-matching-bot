export interface ReminderEntry {
  userId: string;
  recruitId: string;
  channelId: string;
  lastRemindedAtUtc: string | null;
}

export interface ReminderCheckResult {
  shouldRemind: boolean;
  userIds: string[];
}

export function shouldSendReminder(
  entry: ReminderEntry,
  reminderIntervalMin: number | null | undefined,
  nowUtc: Date,
): boolean {
  if (!entry.lastRemindedAtUtc) {
    return true;
  }

  const intervalMs = (reminderIntervalMin ?? 60) * 60 * 1000;
  const lastReminded = new Date(entry.lastRemindedAtUtc);
  const elapsedMs = nowUtc.getTime() - lastReminded.getTime();

  return elapsedMs >= intervalMs;
}

export function buildReminderMessage(recruitId: string): string {
  return `希望時間の登録がまだです！\n参加ボタンを押した後、セレクトメニューから希望時間を選択してください。`;
}

export function filterPendingReminders(
  entries: ReminderEntry[],
  reminderIntervalMin: number | null | undefined,
  nowUtc: Date,
): ReminderEntry[] {
  return entries.filter((entry) =>
    shouldSendReminder(entry, reminderIntervalMin, nowUtc),
  );
}
