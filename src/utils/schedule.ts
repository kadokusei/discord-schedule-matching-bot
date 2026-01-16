export interface Schedule {
  postTimeHHmm: string;
}

export interface RecruitInstance {
  targetDateLocal: string;
}

export function shouldCreateInstance(
  nowUtc: Date,
  schedule: Schedule,
  tz: string,
  existingInstances: RecruitInstance[],
): boolean {
  const [hours, minutes] = schedule.postTimeHHmm.split(":").map(Number);

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const nowParts = formatter.formatToParts(nowUtc);
  const year = Number(nowParts.find((p) => p.type === "year")?.value);
  const month = Number(nowParts.find((p) => p.type === "month")?.value) - 1;
  const day = Number(nowParts.find((p) => p.type === "day")?.value);

  const nowStartOfDayUtc = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
  const postTimeDate = new Date(nowStartOfDayUtc.getTime() + hours * 3600000 + minutes * 60000);

  if (postTimeDate.getTime() > nowUtc.getTime()) {
    return true;
  }

  if (postTimeDate.getTime() <= nowUtc.getTime()) {
    return false;
  }

  const targetDateLocal = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  const alreadyExists = existingInstances.some(
    (inst) => inst.targetDateLocal === targetDateLocal
  );

  if (alreadyExists) {
    return false;
  }

  return true;
}

