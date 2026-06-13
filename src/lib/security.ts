/**
 * 署名検証のバイパス可否を判定する。
 *
 * `DISABLE_SIGNATURE_VERIFICATION` は開発/テスト用の脱出ハッチだが、
 * 本番(production)で誤設定されると Discord インタラクションの署名検証が
 * 全無効化され、誰でもリクエストを偽造できてしまう。そのため
 * **本番では常にバイパスを禁止**し、非本番環境かつ明示的に "true" の
 * ときに限ってバイパスを許可する。
 */
export const isSignatureBypassEnabled = (env: {
  ENVIRONMENT?: string;
  DISABLE_SIGNATURE_VERIFICATION?: string;
}): boolean => env.ENVIRONMENT !== "production" && env.DISABLE_SIGNATURE_VERIFICATION === "true";
