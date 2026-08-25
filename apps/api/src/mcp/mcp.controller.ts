import { All, Controller, HttpStatus, Logger, Req, Res } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  completeTaskInputSchema,
  harnessAssetTypeSchema,
  resolveTaskInputSchema,
} from '@harnessvault/domain';
import { parseBearerToken } from '../identity/session-token';
import { ApprovalService } from '../approval/approval.service';
import { OutputContractService } from '../output-contract/output-contract.service';
import { TraceService } from '../trace/trace.service';
import { ResourceService } from '../resource/resource.service';
import { type McpIdentity, McpService } from './mcp.service';

/**
 * NestJS 예외에서 구조화된 실패 정보를 꺼낸다.
 * 코드를 잃어버리면 에이전트가 다음 행동을 정할 수 없다.
 */
function toToolError(error: unknown): { code: string; message: string } & Record<string, unknown> {
  if (typeof error === 'object' && error !== null && 'getResponse' in error) {
    const response = (error as { getResponse: () => unknown }).getResponse();
    if (typeof response === 'object' && response !== null) {
      const body = response as Record<string, unknown>;
      return {
        code: typeof body.code === 'string' ? body.code : 'REQUEST_FAILED',
        message: typeof body.message === 'string' ? body.message : '요청을 처리하지 못했습니다',
        ...body,
      };
    }
    return { code: 'REQUEST_FAILED', message: String(response) };
  }
  return {
    code: 'REQUEST_FAILED',
    message: error instanceof Error ? error.message : String(error),
  };
}

/** 도메인은 MCP SDK에 의존하지 않는다(§24). 이 파일이 유일한 접점이다. */
@Controller('mcp')
export class McpController {
  private readonly logger = new Logger(McpController.name);

  constructor(
    private readonly mcp: McpService,
    private readonly resources: ResourceService,
    private readonly approvals: ApprovalService,
    private readonly traces: TraceService,
    private readonly outputContracts: OutputContractService,
  ) {}

  @All()
  async handle(@Req() request: Request, @Res() response: Response): Promise<void> {
    // stateless — 세션도 서버 주도 알림도 없다. GET·DELETE를 지원할 이유가 없다.
    if (request.method !== 'POST') {
      response.status(HttpStatus.METHOD_NOT_ALLOWED).json({
        code: 'METHOD_NOT_ALLOWED',
        message: 'stateless MCP 엔드포인트는 POST만 받습니다',
      });
      return;
    }

    let identity: McpIdentity;
    try {
      identity = await this.mcp.authenticate(
        parseBearerToken(request.header('authorization')),
        request.header('x-harness-organization') ?? null,
      );
    } catch (error) {
      // 인증 실패를 JSON-RPC 성공 본문 안에 감싸지 않는다. HTTP 상태로 낸다.
      const status =
        typeof error === 'object' && error !== null && 'getStatus' in error
          ? (error as { getStatus: () => number }).getStatus()
          : HttpStatus.UNAUTHORIZED;
      const body =
        typeof error === 'object' && error !== null && 'getResponse' in error
          ? (error as { getResponse: () => unknown }).getResponse()
          : { code: 'AUTH_REQUIRED', message: '인증이 필요합니다' };
      response.status(status).json(body);
      return;
    }

    const server = this.buildServer(identity, request.header('user-agent') ?? null);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    response.on('close', () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } catch (error) {
      this.logger.error(
        `MCP 요청 처리 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
      if (!response.headersSent) {
        response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
          code: 'MCP_TRANSPORT_ERROR',
          message: 'MCP 요청을 처리하지 못했습니다',
        });
      }
    }
  }

  private buildServer(identity: McpIdentity, clientName: string | null): McpServer {
    const server = new McpServer(
      { name: 'harnessvault', version: '0.1.0' },
      { capabilities: { tools: {} } },
    );

    /**
     * 클라이언트가 보낸 traceId를 신뢰하지 않는다.
     * 남의 흐름 id를 주면 null로 떨어뜨린다 — 잘못 이어진 감사 기록은 없는 것보다 나쁘다.
     * 신뢰 경계인 여기서 한 번만 검증하고, 아래 서비스는 검증된 값만 받는다.
     */
    const safeTrace = (value: string | undefined) =>
      this.traces.resolveTraceId(identity.organizationId, identity.user.id, value ?? null);

    /**
     * 툴 결과를 MCP 응답 형태로 감싼다.
     *
     * 실패는 구조화된 형태로 전달한다. 메시지 문자열만 주면 에이전트가
     * POLICY_DENIED · APPROVAL_REQUIRED · RESOURCE_UNAVAILABLE을 구분하지 못해
     * §61 실패 코드가 무의미해진다.
     */
    const respond = async (toolName: string, run: () => Promise<unknown>) => {
      try {
        const result = await run();
        const text = JSON.stringify(result, null, 2);
        await this.mcp.recordToolCall(identity, toolName, {
          clientName,
          resultBytes: Buffer.byteLength(text, 'utf8'),
        });
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        const payload = toToolError(error);
        await this.mcp.recordToolCall(identity, toolName, {
          clientName,
          failed: true,
          code: payload.code,
        });
        return {
          isError: true,
          content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
        };
      }
    };

    server.registerTool(
      'company.resolve_task',
      {
        title: '회사 Harness 해석',
        description:
          '현재 사용자·프로젝트·작업·환경에 적용되는 회사 Harness를 해석해 Manifest로 돌려준다. 회사 프로젝트 작업을 시작할 때 가장 먼저 호출한다.',
        inputSchema: resolveTaskInputSchema.shape,
      },
      async (args) =>
        respond('company.resolve_task', () =>
          this.mcp.resolveTask(identity, resolveTaskInputSchema.parse(args)),
        ),
    );

    server.registerTool(
      'company.search_asset',
      {
        title: '회사 Harness 자산 검색',
        description:
          '조직이 보유한 ACTIVE Harness 자산을 검색한다. 결과는 어휘 기반 점수 순이다(method: LEXICAL).',
        inputSchema: {
          query: z.string().min(1).max(500),
          types: z.array(harnessAssetTypeSchema).optional(),
          capability: z.uuid().optional(),
          limit: z.number().int().positive().max(50).optional(),
        },
      },
      async (args) => respond('company.search_asset', () => this.mcp.searchAsset(identity, args)),
    );

    server.registerTool(
      'company.get_asset',
      {
        title: '회사 Harness 자산 조회',
        description:
          'level로 필요한 만큼만 가져간다. 0 메타데이터 · 1 본문(기본) · 2 관계 포함 · 3 structuredContent 원본 포함.',
        inputSchema: {
          assetId: z.uuid(),
          versionId: z.uuid().optional(),
          level: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).optional(),
        },
      },
      async (args) => respond('company.get_asset', () => this.mcp.getAsset(identity, args)),
    );

    server.registerTool(
      'company.find_similar',
      {
        title: '유사 자산 탐색',
        description:
          '새로 만들려는 지식과 비슷한 기존 자산을 찾는다. 중복 기여를 막기 위해 쓴다. Phase 11 전까지는 어휘 기반이다(method: LEXICAL).',
        inputSchema: {
          title: z.string().min(1).max(300),
          description: z.string().max(4000).default(''),
          capability: z.uuid().optional(),
          structuredContent: z.unknown().optional(),
        },
      },
      async (args) => respond('company.find_similar', () => this.mcp.findSimilar(identity, args)),
    );

    /* ---------------- Resource (§26) ---------------- */

    // `purpose`는 전부 필수다. 왜 조회했는지가 남지 않으면 감사가 반쪽이 된다.
    const purpose = z.string().min(1).max(500).describe('이 조회가 필요한 이유');
    // company.resolve_task가 돌려준 traceId를 이어 준다.
    // 없으면 이벤트가 흐름에 묶이지 않고 "흐름 없음"으로 남는다 — 서버가 추측하지 않는다.
    const traceId = z
      .uuid()
      .optional()
      .describe('company.resolve_task가 돌려준 traceId. 같은 작업의 호출을 하나로 묶는다');

    server.registerTool(
      'company.resources',
      {
        title: '접근 가능한 회사 Resource 목록',
        description: '어떤 Resource가 있는지 먼저 확인한다. credential 값은 절대 반환되지 않는다.',
        inputSchema: { type: z.enum(['FILE_SYSTEM', 'DATABASE', 'GIT', 'INTERNAL_API']).optional() },
      },
      async (args) =>
        respond('company.resources', async () => ({
          resources: await this.resources.list(identity.organizationId, args.type),
        })),
    );

    server.registerTool(
      'company.files.search',
      {
        title: '회사 파일 검색',
        description: '등록된 파일 Resource 안에서 이름·내용을 검색한다. 지정된 root 밖은 볼 수 없다.',
        inputSchema: {
          resourceId: z.uuid(),
          query: z.string().min(1).max(500),
          limit: z.number().int().positive().max(100).optional(),
          purpose,
          traceId,
        },
      },
      async (args) =>
        respond('company.files.search', async () =>
          this.resources.filesSearch(identity.organizationId, identity.user.id, {
            ...args,
            traceId: await safeTrace(args.traceId),
          }),
        ),
    );

    server.registerTool(
      'company.files.read',
      {
        title: '회사 파일 읽기',
        description: 'root 기준 상대 경로로 파일을 읽는다. range로 줄 범위를 제한할 수 있다.',
        inputSchema: {
          resourceId: z.uuid(),
          path: z.string().min(1).max(1000),
          range: z
            .object({
              start: z.number().int().positive().optional(),
              end: z.number().int().positive().optional(),
            })
            .optional(),
          purpose,
          traceId,
        },
      },
      async (args) =>
        respond('company.files.read', async () =>
          this.resources.filesRead(identity.organizationId, identity.user.id, {
            ...args,
            traceId: await safeTrace(args.traceId),
          }),
        ),
    );

    server.registerTool(
      'company.db.schema',
      {
        title: '회사 DB 스키마 조회',
        description: '테이블과 컬럼 목록을 돌려준다. object를 주면 그 테이블만 본다.',
        inputSchema: { resourceId: z.uuid(), object: z.string().max(200).optional(), purpose, traceId },
      },
      async (args) =>
        respond('company.db.schema', async () =>
          this.resources.dbSchema(identity.organizationId, identity.user.id, {
            ...args,
            traceId: await safeTrace(args.traceId),
          }),
        ),
    );

    server.registerTool(
      'company.db.query',
      {
        title: '회사 DB 조회',
        description:
          'SELECT 질의만 실행한다. read only 트랜잭션으로 DB가 강제한다. 쓰기는 Policy·Approval이 붙는 이후 Phase에서 열린다.',
        inputSchema: { resourceId: z.uuid(), query: z.string().min(1).max(10_000), purpose, traceId },
      },
      async (args) =>
        respond('company.db.query', async () =>
          this.resources.dbQuery(identity.organizationId, identity.user.id, {
            ...args,
            traceId: await safeTrace(args.traceId),
          }),
        ),
    );

    server.registerTool(
      'company.git.status',
      {
        title: '회사 Git 상태',
        description: '브랜치·HEAD·변경 파일 목록을 돌려준다.',
        inputSchema: { resourceId: z.uuid(), purpose, traceId },
      },
      async (args) =>
        respond('company.git.status', async () =>
          this.resources.gitStatus(identity.organizationId, identity.user.id, {
            ...args,
            traceId: await safeTrace(args.traceId),
          }),
        ),
    );

    server.registerTool(
      'company.git.read',
      {
        title: '회사 Git 파일 읽기',
        description: '특정 ref의 파일 내용을 읽는다. 기본 ref는 HEAD다.',
        inputSchema: {
          resourceId: z.uuid(),
          path: z.string().min(1).max(1000),
          ref: z.string().max(200).optional(),
          purpose,
          traceId,
        },
      },
      async (args) =>
        respond('company.git.read', async () =>
          this.resources.gitRead(identity.organizationId, identity.user.id, {
            ...args,
            traceId: await safeTrace(args.traceId),
          }),
        ),
    );

    /* ---------------- 쓰기 · 승인 (§26 · §34) ---------------- */

    // 승인자가 판단할 수 있어야 한다. reason은 필수다.
    const approvalContext = {
      reason: z.string().min(1).max(2000).describe('이 변경이 필요한 이유'),
      risk: z.string().max(2000).optional().describe('예상되는 위험'),
      rollbackPlan: z.string().max(2000).optional().describe('되돌리는 방법'),
      verificationPlan: z.string().max(2000).optional().describe('변경 후 검증 방법'),
    };

    server.registerTool(
      'company.db.update',
      {
        title: '회사 DB 변경 요청',
        description:
          'INSERT · UPDATE · DELETE를 요청한다. 정책이 승인을 요구하면 실행되지 않고 승인 요청만 만들어진다. 승인 뒤 company.approval.execute로 실행한다.',
        inputSchema: {
          resourceId: z.uuid(),
          query: z.string().min(1).max(10_000),
          purpose,
          projectId: z.uuid().optional(),
          traceId,
          ...approvalContext,
        },
      },
      async (args) =>
        respond('company.db.update', async () =>
          this.resources.requestWrite(identity.organizationId, identity.user.id, {
            resourceId: args.resourceId,
            action: 'db.update',
            payload: { query: args.query },
            proposedChange: args.query,
            purpose: args.purpose,
            projectId: args.projectId ?? null,
            traceId: await safeTrace(args.traceId),
            context: {
              reason: args.reason,
              risk: args.risk ?? null,
              rollbackPlan: args.rollbackPlan ?? null,
              verificationPlan: args.verificationPlan ?? null,
            },
            clientName,
          }),
        ),
    );

    server.registerTool(
      'company.files.write',
      {
        title: '회사 파일 쓰기 요청',
        description:
          '파일을 새로 쓰거나 덮어쓴다. 정책이 승인을 요구하면 실행되지 않고 승인 요청만 만들어진다.',
        inputSchema: {
          resourceId: z.uuid(),
          path: z.string().min(1).max(1000),
          content: z.string().max(1_000_000),
          purpose,
          projectId: z.uuid().optional(),
          traceId,
          ...approvalContext,
        },
      },
      async (args) =>
        respond('company.files.write', async () =>
          this.resources.requestWrite(identity.organizationId, identity.user.id, {
            resourceId: args.resourceId,
            action: 'files.write',
            payload: { path: args.path, content: args.content },
            proposedChange: `${args.path} (${args.content.length}자)`,
            purpose: args.purpose,
            projectId: args.projectId ?? null,
            traceId: await safeTrace(args.traceId),
            context: {
              reason: args.reason,
              risk: args.risk ?? null,
              rollbackPlan: args.rollbackPlan ?? null,
              verificationPlan: args.verificationPlan ?? null,
            },
            clientName,
          }),
        ),
    );

    server.registerTool(
      'company.approval.status',
      {
        title: '승인 요청 상태 확인',
        description:
          '승인 요청의 현재 상태를 확인한다. 스스로 승인 여부를 판단하지 말고 반드시 이 값을 본다.',
        inputSchema: { approvalRequestId: z.uuid() },
      },
      async (args) =>
        respond('company.approval.status', () =>
          this.approvals.status(identity.organizationId, args.approvalRequestId, identity.user.id),
        ),
    );

    server.registerTool(
      'company.approval.execute',
      {
        title: '승인된 요청 실행',
        description:
          '승인된 요청을 실행한다. 서버가 보관한 요청 내용으로 실행되며, 여기서 내용을 바꿀 수 없다.',
        inputSchema: { approvalRequestId: z.uuid() },
      },
      async (args) =>
        respond('company.approval.execute', () =>
          this.resources.executeApproved(
            identity.organizationId,
            identity.user.id,
            args.approvalRequestId,
          ),
        ),
    );

    server.registerTool(
      'company.output_contract',
      {
        title: '적용되는 산출물 계약 조회',
        description:
          '작업을 마칠 때 무엇을 남겨야 하는지 확인한다. Company·Team·Project 계약이 합쳐진 결과다.',
        inputSchema: { projectId: z.uuid().optional() },
      },
      async (args) =>
        respond('company.output_contract', () =>
          this.outputContracts.resolve(
            identity.organizationId,
            identity.user.id,
            args.projectId ?? null,
          ),
        ),
    );

    server.registerTool(
      'company.task.complete',
      {
        title: '작업 흐름 종료',
        description:
          '작업을 마치며 흐름을 닫는다. output에 산출물 계약 항목을 담아 보낸다. 토큰 사용량은 아는 경우에만 보낸다 — 모르면 보내지 않는다(0으로 채우지 않는다).',
        inputSchema: completeTaskInputSchema.shape,
      },
      async (args) =>
        respond('company.task.complete', () =>
          this.traces.complete(identity.organizationId, identity.user.id, args),
        ),
    );

    return server;
  }
}
