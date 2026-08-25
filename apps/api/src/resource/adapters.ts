import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, relative, sep } from 'node:path';
import { promisify } from 'node:util';
import postgres from 'postgres';
import type { ResourceConfig } from '@harnessvault/domain';
import {
  ResourceCredentialError,
  assertReadOnlyQuery,
  assertWriteQuery,
  redactSecrets,
  resolveCredential,
  resolveInsideRoot,
} from './guards';

const run = promisify(execFile);

export class ResourceUnavailableError extends Error {
  readonly code = 'RESOURCE_UNAVAILABLE';

  constructor(message: string) {
    super(message);
    this.name = 'ResourceUnavailableError';
  }
}

/** 감사 기록용. 원문 payload를 저장하지 않는다(§39). */
export interface AccessTrace {
  objects: string[];
  rowCount?: number;
  byteCount?: number;
  queryFingerprint?: string;
}

export interface AdapterResult<T> {
  data: T;
  trace: AccessTrace;
}

export function fingerprint(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function requireRoot(config: ResourceConfig): string {
  if (!config.root) {
    throw new ResourceUnavailableError('Resource에 root 경로가 설정되지 않았습니다');
  }
  return config.root;
}

/* ---------------- FILE_SYSTEM ---------------- */

const SKIP_DIRECTORIES = new Set(['.git', 'node_modules', '.next', 'dist', 'coverage']);
const DEFAULT_MAX_BYTES = 200_000;

async function walk(root: string, current: string, out: string[], limit: number): Promise<void> {
  if (out.length >= limit) return;
  let entries;
  try {
    entries = await readdir(current, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= limit) return;
    if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
    const full = join(current, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      await walk(root, full, out, limit);
    } else if (entry.isFile()) {
      out.push(relative(root, full).split(sep).join('/'));
    }
  }
}

export const fileSystemAdapter = {
  type: 'FILE_SYSTEM' as const,

  async search(
    config: ResourceConfig,
    request: { query: string; limit?: number },
  ): Promise<AdapterResult<{ matches: Array<{ path: string; line?: number; preview?: string }> }>> {
    const root = requireRoot(config);
    const limit = Math.min(request.limit ?? 20, 100);
    const paths: string[] = [];
    // 후보를 넉넉히 모은 뒤 내용까지 본다. 파일 이름만 맞아도 결과에 넣는다.
    await walk(root, root, paths, 2000);

    const needle = request.query.toLowerCase();
    const matches: Array<{ path: string; line?: number; preview?: string }> = [];

    for (const path of paths) {
      if (matches.length >= limit) break;
      if (path.toLowerCase().includes(needle)) {
        matches.push({ path });
        continue;
      }
      try {
        const info = await stat(join(root, path));
        if (info.size > DEFAULT_MAX_BYTES) continue;
        const content = await readFile(join(root, path), 'utf8');
        const lines = content.split(/\r?\n/);
        const index = lines.findIndex((line) => line.toLowerCase().includes(needle));
        if (index >= 0) {
          matches.push({ path, line: index + 1, preview: lines[index]?.trim().slice(0, 200) });
        }
      } catch {
        // 바이너리이거나 읽을 수 없는 파일이다. 검색 결과에서 빠지는 것이 맞다.
      }
    }

    return {
      data: { matches },
      trace: { objects: matches.map((match) => match.path), rowCount: matches.length },
    };
  },

  async read(
    config: ResourceConfig,
    request: { path: string; range?: { start?: number; end?: number } },
  ): Promise<AdapterResult<{ path: string; content: string; truncated: boolean; totalLines: number }>> {
    const root = requireRoot(config);
    const target = resolveInsideRoot(root, request.path);
    const maxBytes = config.maxBytes ?? DEFAULT_MAX_BYTES;

    let info;
    try {
      info = await stat(target);
    } catch {
      // "파일이 없다"와 "읽을 수 없다"는 다른 사실이다. 빈 내용으로 바꾸지 않는다.
      throw new ResourceUnavailableError(`파일을 찾을 수 없습니다: ${request.path}`);
    }
    if (!info.isFile()) {
      throw new ResourceUnavailableError(`파일이 아닙니다: ${request.path}`);
    }

    const raw = await readFile(target, 'utf8');
    const lines = raw.split(/\r?\n/);
    const start = Math.max(1, request.range?.start ?? 1);
    const end = Math.min(lines.length, request.range?.end ?? lines.length);
    let content = lines.slice(start - 1, end).join('\n');

    const truncated = Buffer.byteLength(content, 'utf8') > maxBytes;
    if (truncated) content = content.slice(0, maxBytes);

    return {
      data: { path: request.path, content, truncated, totalLines: lines.length },
      trace: {
        objects: [request.path],
        byteCount: Buffer.byteLength(content, 'utf8'),
        rowCount: end - start + 1,
      },
    };
  },

  /** 승인을 거친 뒤에만 도달한다. root 밖으로는 여전히 나갈 수 없다. */
  async write(
    config: ResourceConfig,
    request: { path: string; content: string },
  ): Promise<AdapterResult<{ path: string; byteCount: number }>> {
    const root = requireRoot(config);
    const target = resolveInsideRoot(root, request.path);
    const maxBytes = config.maxBytes ?? DEFAULT_MAX_BYTES;

    const bytes = Buffer.byteLength(request.content, 'utf8');
    if (bytes > maxBytes) {
      throw new ResourceUnavailableError(`내용이 ${maxBytes} 바이트 제한을 넘습니다`);
    }

    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, request.content, 'utf8');

    return {
      data: { path: request.path, byteCount: bytes },
      trace: { objects: [request.path], byteCount: bytes },
    };
  },
};

/* ---------------- DATABASE ---------------- */

/**
 * 요청마다 연결을 열고 닫는다.
 * ponytail: per-request connection — 호출량이 늘면 resource별 풀을 둔다.
 */
async function withDatabase<T>(
  credentialRef: string | null,
  handler: (sql: postgres.Sql) => Promise<T>,
): Promise<T> {
  if (!credentialRef) {
    throw new ResourceUnavailableError('Resource에 credentialRef가 설정되지 않았습니다');
  }
  const url = resolveCredential(credentialRef);
  const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 10 });
  try {
    return await handler(sql);
  } catch (error) {
    if (error instanceof ResourceCredentialError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    // 드라이버 오류에 접속 문자열이 그대로 섞여 나온다(§60).
    throw new ResourceUnavailableError(redactSecrets(message, [url]));
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }
}

export const databaseAdapter = {
  type: 'DATABASE' as const,

  async schema(
    credentialRef: string | null,
    request: { object?: string },
  ): Promise<AdapterResult<{ objects: Array<{ table: string; columns: string[] }> }>> {
    return withDatabase(credentialRef, async (sql) => {
      const rows = request.object
        ? await sql`
            select table_name, column_name from information_schema.columns
            where table_schema = 'public' and table_name = ${request.object}
            order by table_name, ordinal_position
          `
        : await sql`
            select table_name, column_name from information_schema.columns
            where table_schema = 'public'
            order by table_name, ordinal_position
          `;

      const grouped = new Map<string, string[]>();
      for (const row of rows) {
        const table = String(row.table_name);
        const list = grouped.get(table) ?? [];
        list.push(String(row.column_name));
        grouped.set(table, list);
      }
      const objects = [...grouped.entries()].map(([table, columns]) => ({ table, columns }));
      return {
        data: { objects },
        trace: { objects: objects.map((item) => item.table), rowCount: objects.length },
      };
    });
  },

  async query(
    credentialRef: string | null,
    config: ResourceConfig,
    request: { query: string },
  ): Promise<AdapterResult<{ rows: unknown[]; rowCount: number; truncated: boolean }>> {
    // 1차 방어 — 문자열 검사.
    const statement = assertReadOnlyQuery(request.query);
    const maxRows = config.maxRows ?? 100;

    return withDatabase(credentialRef, async (sql) => {
      // 실제 보장 — DB가 강제하는 read only 트랜잭션. 문자열 검사만 믿지 않는다.
      const rows = await sql.begin(async (tx) => {
        await tx.unsafe('set transaction read only');
        return tx.unsafe(statement);
      });

      const list = Array.isArray(rows) ? (rows as unknown[]) : [];
      const truncated = list.length > maxRows;
      return {
        data: { rows: list.slice(0, maxRows), rowCount: list.length, truncated },
        trace: {
          objects: [],
          rowCount: list.length,
          queryFingerprint: fingerprint(statement),
        },
      };
    });
  },

  /**
   * 쓰기. **승인을 거친 뒤에만 도달한다.**
   * 트랜잭션으로 감싸 실패 시 부분 반영이 남지 않게 한다.
   */
  async update(
    credentialRef: string | null,
    request: { query: string },
  ): Promise<AdapterResult<{ rowCount: number }>> {
    const statement = assertWriteQuery(request.query);

    return withDatabase(credentialRef, async (sql) => {
      const result = await sql.begin(async (tx) => tx.unsafe(statement));
      const rowCount = Array.isArray(result) ? result.length : ((result as { count?: number })?.count ?? 0);
      return {
        data: { rowCount },
        trace: { objects: [], rowCount, queryFingerprint: fingerprint(statement) },
      };
    });
  },
};

/* ---------------- GIT ---------------- */

async function git(root: string, args: string[]): Promise<string> {
  try {
    // 인자를 배열로 넘긴다. 셸을 거치지 않는다.
    const { stdout } = await run('git', args, { cwd: root, maxBuffer: 4_000_000 });
    return stdout;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ResourceUnavailableError(redactSecrets(message));
  }
}

export const gitAdapter = {
  type: 'GIT' as const,

  async status(
    config: ResourceConfig,
  ): Promise<AdapterResult<{ branch: string; changes: Array<{ status: string; path: string }>; head: string }>> {
    const root = requireRoot(config);
    const branch = (await git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    const head = (await git(root, ['log', '-1', '--format=%H %s'])).trim();
    const porcelain = await git(root, ['status', '--porcelain']);

    const changes = porcelain
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => ({ status: line.slice(0, 2).trim(), path: line.slice(3) }));

    return {
      data: { branch, head, changes },
      trace: { objects: changes.map((change) => change.path), rowCount: changes.length },
    };
  },

  async read(
    config: ResourceConfig,
    request: { path: string; ref?: string },
  ): Promise<AdapterResult<{ path: string; ref: string; content: string }>> {
    const root = requireRoot(config);
    // 경로 탈출 검사는 파일시스템과 같은 규칙을 쓴다.
    resolveInsideRoot(root, request.path);
    const ref = request.ref ?? 'HEAD';
    const content = await git(root, ['show', `${ref}:${request.path}`]);

    return {
      data: { path: request.path, ref, content },
      trace: { objects: [request.path], byteCount: Buffer.byteLength(content, 'utf8') },
    };
  },
};
