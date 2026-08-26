import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { AuthService } from './auth.service';
import { getEnv } from '../env';

/**
 * 만료·폐기된 세션 행과 창을 벗어난 로그인 시도 기록을 주기적으로 지운다.
 *
 * `@nestjs/schedule`을 넣지 않았다. 주기 작업이 이것 하나뿐인데 의존성을 늘릴 이유가 없다(§70).
 * 인스턴스가 여럿이면 각자 돌지만 `delete ... where expired`는 멱등이라 겹쳐도 해롭지 않다 —
 * 분산 락을 넣을 이유가 없다.
 */
@Injectable()
export class SessionPurgeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SessionPurgeService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly auth: AuthService) {}

  onModuleInit(): void {
    const minutes = getEnv().SESSION_PURGE_INTERVAL_MINUTES;
    if (minutes === 0) {
      this.logger.log('세션 정리가 꺼져 있습니다 (SESSION_PURGE_INTERVAL_MINUTES=0)');
      return;
    }

    // 부팅 직후 한 번 돈다. 오래 꺼져 있었으면 그동안 쌓인 것부터 치운다.
    void this.purge();
    this.timer = setInterval(() => void this.purge(), minutes * 60_000);
    // unref가 없으면 타이머가 프로세스를 붙잡아 종료가 걸린다.
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** 실패해도 던지지 않는다. 정리 실패는 서비스 정지 사유가 아니다. */
  private async purge(): Promise<void> {
    try {
      const sessions = await this.auth.purgeExpiredSessions();
      if (sessions > 0) this.logger.log(`만료 세션 ${sessions}건 정리`);
      // IP 축이 (ip, 계정) 쌍마다 한 줄을 만들어 방치하면 무한히 쌓인다.
      const attempts = await this.auth.purgeStaleLoginAttempts();
      if (attempts > 0) this.logger.log(`오래된 로그인 시도 ${attempts}건 정리`);
    } catch (error) {
      this.logger.warn(
        `세션 정리 실패 — 다음 주기에 다시 시도합니다: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
