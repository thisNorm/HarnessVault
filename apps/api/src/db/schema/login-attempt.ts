import { index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * 로그인 실패 카운터.
 *
 * **사용자 행이 아니라 제출된 이메일 문자열로 센다.** 사용자 행에 붙이면
 * 존재하지 않는 이메일은 잠기지 않아, 잠기는지 여부로 계정 존재가 새어 나간다.
 * 여기서는 없는 계정도 똑같이 기록되고 똑같이 잠긴다.
 */
export const loginAttempts = pgTable(
  'login_attempts',
  {
    // 제출된 값을 소문자로 정규화해 키로 쓴다. users를 참조하지 않는다.
    email: text().primaryKey(),
    failedCount: integer().notNull().default(0),
    lockedUntil: timestamp({ withTimezone: true }),
    lastFailedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('login_attempts_locked_idx').on(table.lockedUntil)],
);
