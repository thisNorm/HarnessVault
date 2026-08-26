/**
 * 로그인 후 돌아갈 곳. 초대 링크처럼 "여기 오려다 로그인으로 밀린" 경우에 쓴다.
 *
 * **앱 내부 경로만 받는다.** 외부 URL을 그대로 따라가면 로그인 직후
 * 남이 만든 페이지로 보내는 오픈 리다이렉트가 된다.
 */
export const DEFAULT_LANDING = '/admin/organization';

export function safeNext(raw: string | null): string {
  if (!raw) return DEFAULT_LANDING;
  // `//host` 는 슬래시로 시작하지만 브라우저가 프로토콜 상대 URL로 읽어 외부로 나간다.
  if (!raw.startsWith('/') || raw.startsWith('//')) return DEFAULT_LANDING;
  return raw;
}
