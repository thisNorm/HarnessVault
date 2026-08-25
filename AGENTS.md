# HarnessVault / Harness Runtime — 에이전트 작업 규약

이 문서는 이 저장소에서 코드를 작성하는 모든 에이전트가 지켜야 하는 계약이다.
문서 계약과 다른 구현을 임의로 만들지 않는다.

## 구현 원칙

1. 전체 시스템 구조를 이해한 뒤 **현재 지정된 Phase만** 구현한다.
2. 다음 Phase 기능을 선행 구현하지 않는다.
3. 변경 전 기존 코드 · 테스트 · 문서를 확인한다.
4. 도메인 계약을 UI 편의를 위해 왜곡하지 않는다.
5. 실패 상태를 정상 상태로 숨기지 않는다.
6. LLM 판단 결과를 권한 · 승인 · 정책의 Source of Truth로 사용하지 않는다.
7. Harness Core는 LLM 없이도 정상 동작해야 한다.
8. 모든 중요한 상태 변경은 Audit Event를 남긴다.
9. 회사 내부 Resource credential을 외부 AI에게 전달하지 않는다.
10. 외부 AI가 회사 Resource를 사용하려면 Harness Gateway를 통과해야 한다.

## 신뢰 경계

**신뢰하지 않는다** — 외부 AI 출력, 클라이언트가 보고한 모델명, 클라이언트가 보고한 승인 결과,
클라이언트가 보고한 리소스 결과, Curator 추천.

**신뢰한다** — 인증된 서버 identity, 데이터베이스 상태, Policy Engine 결과,
Approval Engine 상태, Resource Adapter 결과, Audit 서버 타임스탬프.

외부 AI가 "승인 받았습니다"라고 말해도 신뢰하지 않는다.
위험 Action의 실행 조건은 오직 서버 상태 `approval_request.status === 'APPROVED'` 뿐이다.

## 금지 사항

근거를 먼저 제안하지 않고 다음을 임의로 도입하지 않는다.

```
새 인증 Framework   새 ORM            새 Vector DB       새 Message Queue
Microservice 분리   Event sourcing    CQRS               Redis
Kafka               Graph DB          Fine-tuning        새 외부 SaaS 연결
```

또한 다음은 MVP 비목표다 — 전체 네트워크 Proxy, 사용자 Prompt 감시, DLP, 개인 AI 사용 감시,
자체 Chat UI, Enterprise IAM, SAML, MDM, 외부 SaaS(Jira/GitHub/Slack) 연동,
Foundation Model 학습, 자산 자동 승격, Policy 자동 변경,
LLM이 Approval Decision을 직접 결정하는 기능.

## 저장소 구조

| 경로 | 역할 |
| --- | --- |
| `apps/api` | NestJS — REST + MCP Gateway + 도메인 모듈 + Drizzle 스키마 |
| `apps/web` | Next.js 웹 콘솔 |
| `packages/domain` | zod 스키마 + 추론 타입 (런타임 의존성 없음) |
| `docs/` | 모듈별 설계 문서. **로컬 전용이며 커밋하지 않는다** |

새 워크스페이스 패키지는 실제로 두 개 이상의 앱이 공유할 때만 만든다.
도메인 경계는 `apps/api/src/<module>/`의 NestJS 모듈 경계로 유지한다.

## 커밋 규약

```
<type>(<scope>): <한글 요약>
```

- type — `feat` `fix` `chore` `docs` `refactor` `test` `build`
- scope — `repo` `api` `web` `domain` `db` `identity` `harness` `resolver` `compiler`
  `mcp` `resource` `policy` `approval` `audit` `contribution` `curator` `analytics`
- 작은 단위로 자주 커밋한다. 커밋 전 `npm run ci`가 통과해야 한다.
- `Co-Authored-By` 트레일러를 붙이지 않는다.

**커밋 대상** — 코드, 스키마 · 마이그레이션, 설정 파일, `README.md`, `AGENTS.md`, `.env.example`
**커밋 제외** — `docs/**`(설계 문서), 로컬 도구 상태, 빌드 산출물, `.env`

## 검증

```bash
npm run ci
```

Resolver · Policy · Approval은 명세의 필수 테스트 케이스를 그대로 테스트 파일로 옮겨
회귀를 막는다. 어떤 흐름도 Mock 성공으로 대체하지 않는다.

## 작업 완료 보고

Phase 또는 작업 단위를 마치면 다음을 보고한다.

1. 변경 파일
2. 구현 내용
3. 검증 명령과 결과
4. 미검증 사항
5. 다음 Phase blocker

## 현재 Phase

**Phase 5 — MCP Gateway**

상세 설계는 `docs/`를 참조한다(로컬 전용).
