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

## 시크릿 스캔

`npm install`이 `core.hooksPath`를 `.githooks`로 설정하므로 커밋 시 자격증명 검사가 자동 실행된다.
`.env` 계열 파일과 API 키·토큰·개인키 리터럴은 커밋되지 않는다.

```bash
npm run scan:secrets
```

오탐이면 해당 줄 끝에 `secret-scan:allow` 주석을 남긴다.

## 에이전트로 작업할 때

`AGENTS.md`를 먼저 읽는다.
