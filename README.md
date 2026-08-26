# HarnessVault

조직의 AI 업무 수행 능력을 개인 자산에서 **조직이 소유하는 실행 가능한 자산**으로 전환하는
플랫폼이다. 실행 엔진의 이름은 **Harness Runtime**이다.

외부/개인 AI(Codex · Claude Code · Cursor 등)가 회사 영역에 들어오면 다음을 강제한다.

```
Resolve → Execute → Govern → Observe → Validate → Contribute → Evolve
```

사용자를 식별하고, 회사 Harness를 내려주고, 접근 권한을 판정하고, 필요하면 사람 승인을 받고,
실행 내역을 감사 로그로 남기고, 회사 산출물 계약을 적용하고, 새로 발견된 재사용 가능한 지식을
조직 Harness로 환류시킨다.

> People change. Models change. Organizational capability remains.

## 구성

| 경로 | 역할 |
| --- | --- |
| `apps/api` | NestJS — REST API + MCP Gateway + 도메인 모듈 + Drizzle 스키마 |
| `apps/web` | Next.js 웹 콘솔 |
| `packages/domain` | zod 스키마와 추론 타입 (api · web 공유) |

## 요구 사항

- Node.js 24 이상
- Docker (PostgreSQL + pgvector)

## 시작하기

```bash
npm install
cp .env.example .env
npm run db:up          # PostgreSQL + pgvector (Docker)
npm run db:migrate
```

터미널 두 개로 API와 콘솔을 띄운다.

```bash
npm run dev            # API      http://localhost:3000
npm run dev:web        # 웹 콘솔  http://localhost:3100
```

개발용 샘플 데이터를 넣는다. 조직·팀·프로젝트와 Harness 자산 6개가 생성된다.

```bash
SEED_EMAIL=test@test.com SEED_PASSWORD=1234 npm run db:seed
```

개발 환경에서는 비밀번호 최소 길이가 4자다. 운영(`NODE_ENV=production`)에서는 12자로 강제된다.

## 검증

`npm run test:e2e`의 마지막 스위트(`mvp-e2e.mjs`)가 전체 흐름을 한 번에 돈다 —
가입부터 다른 사용자가 다른 AI로 재사용하기까지. Mock으로 대체된 구간은 없다:
실제 파일을 읽고, 실제 PostgreSQL에 행을 넣고, 다른 계정이 실제로 승인한다.

```bash
npm run ci
```

`typecheck → lint → test → build` 순으로 실행한다.

API가 떠 있는 상태에서 Identity 전 구간을 확인한다.

```bash
npm run test:e2e
```

## Resource 연결 (Phase 6)

회사 파일·DB·Git을 등록하면 에이전트가 `company.*` MCP 툴로 **raw credential 없이** 읽는다.

접속 문자열은 DB에 저장하지 않는다. `resources.credential_ref`에는 **환경변수 이름**만 담고
실제 값은 실행 시점에 `.env`에서 읽는다.

```bash
# .env
HARNESS_RESOURCE_DEMO_DB=postgresql://user:pw@host:5432/db
```

이름은 반드시 `HARNESS_RESOURCE_`로 시작해야 한다. 이 제약이 없으면 조직 관리자가
`DATABASE_URL`을 지정해 이 애플리케이션 자신의 DB를 열 수 있다.

검증용 준비물을 만든다.

```bash
npm run setup:resources
```

Phase 6은 **읽기 전용**이다. `company.db.query`는 SELECT만 실행하며
`read only` 트랜잭션으로 DB가 강제한다. 쓰기는 Policy(Phase 7)·Approval(Phase 8)이 붙은 뒤 열린다.

## MCP로 연결하기

에이전트(Codex · Claude Code)를 붙일 때 쓴다. 세션 토큰은 로그인 응답의
`harness_session` 쿠키 값이다.

```jsonc
{
  "mcpServers": {
    "company": {
      "type": "http",
      "url": "http://localhost:3000/mcp",
      "headers": {
        "Authorization": "Bearer <session token>",
        "X-Harness-Organization": "<organizationId>"
      }
    }
  }
}
```

조직에 하나만 속해 있으면 `X-Harness-Organization`을 생략할 수 있다.
여러 조직에 속해 있으면 반드시 지정해야 한다 — 어느 조직 Harness를 받았는지
모른 채 일하게 두지 않기 위해서다.

## 의미 검색 (선택)

중복 기여를 찾는 `company.find_similar`와 `company.contribute`는 기본적으로
**어휘 기반**으로 동작한다(응답의 `method: "LEXICAL"`). 임베딩 제공자를 붙이면
pgvector 의미 검색으로 바뀐다(`method: "VECTOR"`).

```bash
ollama pull nomic-embed-text
```

```bash
# .env
EMBEDDING_URL=http://localhost:11434/api/embed
EMBEDDING_MODEL=nomic-embed-text
```

- **768차원 모델만 쓸 수 있다.** 컬럼 DDL이 차원을 요구하므로 다른 차원의 모델을 붙이면
  저장을 거부하고 로그에 이유를 남긴다 — 잘라 넣어 유사도를 조용히 망가뜨리지 않는다.
- 제공자가 없거나 죽어 있어도 기여·검색은 그대로 동작한다. 부가 기능의 장애가 본 경로를 막지 않는다.
- 기존 자산에 임베딩을 채우려면 조직 관리자로 아래를 호출한다.

```bash
curl -X POST http://localhost:3000/organizations/<orgId>/contributions/embeddings/backfill -b harness_session=<token>
```

## 무엇이 쓰이는지 보기

`/analytics`가 자산별 주입·제외 횟수와 "한 번도 주입되지 않은 자산"을 보여준다.
쌓기만 하고 안 쓰는 자산을 찾아 정리하는 것이 이 화면의 목적이다.

기록은 Phase 13 이후의 해석부터 쌓인다. 그 전 흐름은 개수만 남아 있어 소급 복원할 수 없다.

- 모든 평균에 표본 수가 함께 표시된다. 모르는 값을 0으로 세지 않았다는 뜻이다.
- 분모가 0이면 비율을 `—`로 둔다. 0%로 표시하면 거짓이다.
- **개인별 생산성 점수는 만들지 않는다.** 집계를 사용자로 그룹핑하지 않는다.

## Curator (선택)

Candidate가 기존 자산과 어떤 관계인지 추천을 낸다. 설정하지 않으면 배선 검증용 대역이 돌고,
**결과에 `MOCK`이 박혀 실제 모델이 판단한 것이 아님을 화면과 감사 양쪽에 밝힌다.**

```bash
ollama pull gemma3:4b
```

```bash
# .env
CURATOR_URL=http://localhost:11434/api/chat
CURATOR_MODEL=gemma3:4b
```

- **판정은 추천이다.** `CONFLICTS_WITH`가 나와도 기여는 그대로 있고 `DUPLICATE`가 나와도 거절되지 않는다.
  승격·거절은 `/candidates`에서 사람이 한다.
- Curator가 죽어 있어도 승격·거절 경로는 그대로 열려 있다(§61).
- 모델은 갈아끼울 수 있다. 코드가 특정 모델에 묶여 있지 않다.

## 시크릿 스캔

`npm install`이 `core.hooksPath`를 `.githooks`로 설정하므로 커밋 시 자격증명 검사가 자동 실행된다.
`.env` 계열 파일과 API 키·토큰·개인키 리터럴은 커밋되지 않는다.

```bash
npm run scan:secrets
```

오탐이면 해당 줄 끝에 `secret-scan:allow` 주석을 남긴다.

## 에이전트로 작업할 때

`AGENTS.md`를 먼저 읽는다.
