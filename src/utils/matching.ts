export interface Entry {
  userId: string;
  availableFromUtc: string;
}

export interface BestParty {
  memberIds: string[];
  meetTimeUtc: string;
}

function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length === 0) return [];

  const [first, ...rest] = arr;
  const combsWithFirst = combinations(rest, k - 1).map((comb) => [first, ...comb]);
  const combsWithoutFirst = combinations(rest, k);

  return [...combsWithFirst, ...combsWithoutFirst];
}

function sumAvailableFrom(entries: Entry[]): number {
  return entries.reduce((sum, e) => sum + new Date(e.availableFromUtc).getTime(), 0);
}

export function computeBestParty(entries: Entry[]): BestParty {
  if (entries.length <= 5) {
    const memberIds = entries.map((e) => e.userId);
    const meetTime = entries.reduce(
      (latest, e) => {
        const t = new Date(e.availableFromUtc);
        return t.getTime() > latest.getTime() ? t : latest;
      },
      new Date("1970-01-01T00:00:00.000Z"),
    );
    return { memberIds, meetTimeUtc: meetTime.toISOString() };
  }

  let best: BestParty | null = null;
  let bestMeetTime = Infinity;
  let bestSum = Infinity;

  for (const combo of combinations(entries, 5)) {
    const meetTime = combo.reduce(
      (latest, e) => {
        const t = new Date(e.availableFromUtc);
        return t.getTime() > latest.getTime() ? t : latest;
      },
      new Date("1970-01-01T00:00:00.000Z"),
    );

    const meetTimeValue = meetTime.getTime();

    if (meetTimeValue < bestMeetTime) {
      bestMeetTime = meetTimeValue;
      bestSum = sumAvailableFrom(combo);
      best = {
        memberIds: combo.map((e) => e.userId).sort(),
        meetTimeUtc: meetTime.toISOString(),
      };
    } else if (meetTimeValue === bestMeetTime) {
      const currentSum = sumAvailableFrom(combo);
      if (currentSum < bestSum) {
        bestSum = currentSum;
        best = {
          memberIds: combo.map((e) => e.userId).sort(),
          meetTimeUtc: meetTime.toISOString(),
        };
      }
    }
  }

  return best ?? { memberIds: [], meetTimeUtc: "1970-01-01T00:00:00.000Z" };
}
