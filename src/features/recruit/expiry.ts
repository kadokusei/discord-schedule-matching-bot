import { localDateTimeToUtc } from "../../shared/time/utils";

export interface RecruitExpiry {
  targetDateLocal: string;
  postTimeHHmm: string;
  durationMin: number;
}

/**
 * 募集が期限切れかどうかを判定する。
 * 期限 = targetDateLocal の postTimeHHmm + durationMin
 */
export const isRecruitExpired = (
  recruit: RecruitExpiry,
  timezone: string,
  nowUtc: Date,
): boolean => {
  const startUtc = localDateTimeToUtc(
    recruit.targetDateLocal,
    recruit.postTimeHHmm,
    timezone,
  );
  const expiryUtc = new Date(
    startUtc.getTime() + recruit.durationMin * 60 * 1000,
  );

  return nowUtc.getTime() >= expiryUtc.getTime();
};
