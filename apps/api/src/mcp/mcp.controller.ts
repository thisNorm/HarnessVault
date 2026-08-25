import { All, Controller, HttpStatus, Logger, Req, Res } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  harnessAssetTypeSchema,
  resolveTaskInputSchema,
} from '@harnessvault/domain';
import { parseBearerToken } from '../identity/session-token';
import { type McpIdentity, McpService } from './mcp.service';

/** 도메인은 MCP SDK에 의존하지 않는다(§24). 이 파일이 유일한 접점이다. */
@Controller('mcp')
export class McpController {
  private readonly logger = new Logger(McpController.name);

  constructor(private readonly mcp: McpService) {}

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

    /** 툴 결과를 MCP 응답 형태로 감싼다. 실패는 감싸지 않고 그대로 던진다. */
    const respond = async (toolName: string, run: () => Promise<unknown>) => {
      const result = await run();
      const text = JSON.stringify(result, null, 2);
      await this.mcp.recordToolCall(identity, toolName, {
        clientName,
        resultBytes: Buffer.byteLength(text, 'utf8'),
      });
      return { content: [{ type: 'text' as const, text }] };
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

    return server;
  }
}
