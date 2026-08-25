import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  ResourceCredentialError,
  ResourcePathError,
  ResourceQueryError,
  assertReadOnlyQuery,
  assertWriteQuery,
  isAllowedCredentialRef,
  redactSecrets,
  resolveCredential,
  resolveInsideRoot,
  stripSqlComments,
} from './guards';

describe('credential 참조 접두사', () => {
  it('HARNESS_RESOURCE_ 로 시작하는 이름만 허용한다', () => {
    expect(isAllowedCredentialRef('HARNESS_RESOURCE_MAIN_DB')).toBe(true);
    expect(isAllowedCredentialRef('HARNESS_RESOURCE_A1')).toBe(true);
  });

  it('앱 자신의 환경변수를 가리키지 못하게 막는다', () => {
    // 이 제약이 없으면 ORG_ADMIN이 이 앱의 DB를 Resource로 등록할 수 있다.
    for (const bad of ['DATABASE_URL', 'PATH', 'HOME', 'WEB_ORIGINS', 'SESSION_TTL_HOURS']) {
      expect(isAllowedCredentialRef(bad), bad).toBe(false);
    }
  });

  it('접두사만 맞고 형식이 틀린 이름을 거부한다', () => {
    for (const bad of [
      'HARNESS_RESOURCE_',
      'HARNESS_RESOURCE_a',
      'HARNESS_RESOURCE_A-B',
      'harness_resource_x',
      'XHARNESS_RESOURCE_A',
      'HARNESS_RESOURCE_A B',
    ]) {
      expect(isAllowedCredentialRef(bad), bad).toBe(false);
    }
  });
});

describe('resolveCredential', () => {
  it('환경변수 값을 돌려준다', () => {
    expect(
      resolveCredential('HARNESS_RESOURCE_X', { HARNESS_RESOURCE_X: 'postgresql://a/b' }),
    ).toBe('postgresql://a/b');
  });

  it('실행 시점에도 접두사를 다시 검사한다', () => {
    // DB를 직접 고쳐 넣은 행이 통과하면 안 된다.
    expect(() => resolveCredential('DATABASE_URL', { DATABASE_URL: 'postgresql://x' })).toThrow(
      ResourceCredentialError,
    );
  });

  it('값이 없으면 빈 문자열로 넘기지 않고 실패한다', () => {
    try {
      resolveCredential('HARNESS_RESOURCE_MISSING', {});
      expect.unreachable('없는 환경변수인데 통과했다');
    } catch (error) {
      expect((error as ResourceCredentialError).code).toBe('RESOURCE_UNAVAILABLE');
    }
  });

  it('빈 문자열도 없는 것으로 본다', () => {
    expect(() => resolveCredential('HARNESS_RESOURCE_X', { HARNESS_RESOURCE_X: '' })).toThrow();
  });
});

describe('경로 탈출', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-root-'));
  const outside = mkdtempSync(join(tmpdir(), 'harness-outside-'));
  mkdirSync(join(root, 'sub'), { recursive: true });
  writeFileSync(join(root, 'sub', 'report.md'), 'ok');
  writeFileSync(join(outside, 'secret.txt'), 'secret');

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it('root 안의 경로를 허용한다', () => {
    expect(resolveInsideRoot(root, 'sub/report.md')).toContain('report.md');
  });

  it('아직 없는 경로도 root 안이면 허용한다', () => {
    expect(() => resolveInsideRoot(root, 'sub/not-yet.md')).not.toThrow();
  });

  it('.. 로 나가는 경로를 막는다', () => {
    for (const bad of ['../secret.txt', 'sub/../../secret.txt', '../../etc/passwd']) {
      expect(() => resolveInsideRoot(root, bad), bad).toThrow(ResourcePathError);
    }
  });

  it('절대 경로를 막는다', () => {
    expect(() => resolveInsideRoot(root, join(outside, 'secret.txt'))).toThrow(ResourcePathError);
  });

  it('널 바이트를 막는다', () => {
    expect(() => resolveInsideRoot(root, 'sub/report.md\0.png')).toThrow(ResourcePathError);
  });

  it('root 밖을 가리키는 심볼릭 링크를 막는다', () => {
    const link = join(root, 'escape');
    try {
      symlinkSync(outside, link, 'dir');
    } catch {
      // Windows에서 권한이 없으면 심볼릭 링크를 만들 수 없다. 그 경우 건너뛴다.
      return;
    }
    expect(() => resolveInsideRoot(root, 'escape/secret.txt')).toThrow(ResourcePathError);
  });
});

describe('stripSqlComments', () => {
  it('줄 주석을 지운다', () => {
    expect(stripSqlComments('select 1 -- delete from users')).not.toContain('delete');
  });

  it('블록 주석을 지운다', () => {
    expect(stripSqlComments('select /* drop table x */ 1')).not.toContain('drop');
  });
});

describe('assertReadOnlyQuery', () => {
  it('SELECT를 허용한다', () => {
    expect(assertReadOnlyQuery('select * from users')).toBe('select * from users');
    expect(() => assertReadOnlyQuery('SELECT count(*) FROM orders')).not.toThrow();
  });

  it('읽기 전용 CTE를 허용한다', () => {
    expect(() =>
      assertReadOnlyQuery('with recent as (select * from orders) select * from recent'),
    ).not.toThrow();
  });

  it('끝의 세미콜론 하나는 허용한다', () => {
    expect(assertReadOnlyQuery('select 1;')).toBe('select 1');
  });

  it('쓰기 문장을 거부한다', () => {
    for (const bad of [
      'insert into users values (1)',
      'update users set name = 1',
      'delete from users',
      'drop table users',
      'truncate users',
      'alter table users add column x int',
      'grant all on users to public',
    ]) {
      expect(() => assertReadOnlyQuery(bad), bad).toThrow(ResourceQueryError);
    }
  });

  it('세미콜론 뒤에 숨긴 두 번째 문장을 거부한다', () => {
    expect(() => assertReadOnlyQuery('select 1; delete from users')).toThrow(ResourceQueryError);
  });

  it('CTE 안의 쓰기를 거부한다', () => {
    expect(() =>
      assertReadOnlyQuery('with x as (insert into users values (1) returning *) select * from x'),
    ).toThrow(ResourceQueryError);
  });

  it('주석으로 감춘 쓰기를 거부한다', () => {
    expect(() => assertReadOnlyQuery('select 1 /* x */ ; drop table users')).toThrow(
      ResourceQueryError,
    );
  });

  it('빈 질의를 거부한다', () => {
    expect(() => assertReadOnlyQuery('   ')).toThrow(ResourceQueryError);
    expect(() => assertReadOnlyQuery('-- only a comment')).toThrow(ResourceQueryError);
  });

  it('SET · CALL 같은 부수효과 문장을 거부한다', () => {
    for (const bad of ['set search_path to public', 'call do_something()', 'vacuum users']) {
      expect(() => assertReadOnlyQuery(bad), bad).toThrow(ResourceQueryError);
    }
  });

  it('컬럼 이름에 쓰기 키워드가 들어가도 통과한다', () => {
    // `deleted_at`처럼 키워드를 포함한 식별자를 막으면 쓸모없는 게이트가 된다.
    expect(() => assertReadOnlyQuery('select deleted_at, updated_at from users')).not.toThrow();
  });
});

describe('redactSecrets', () => {
  it('접속 문자열을 지운다', () => {
    const message = 'connect ECONNREFUSED postgresql://user:pw@10.0.0.1:5432/db';
    const safe = redactSecrets(message);
    expect(safe).not.toContain('pw@');
    expect(safe).not.toContain('10.0.0.1');
    expect(safe).toContain('ECONNREFUSED');
  });

  it('전달받은 비밀 문자열도 지운다', () => {
    const safe = redactSecrets('failed with token abc123secret', ['abc123secret']);
    expect(safe).not.toContain('abc123secret');
    expect(safe).toContain('failed with token');
  });

  it('오류 내용 자체는 남긴다 — 실패를 삼키지 않는다', () => {
    expect(redactSecrets('permission denied for table users')).toBe(
      'permission denied for table users',
    );
  });

  it('너무 짧은 값은 지우지 않는다 — 문장이 걸레가 된다', () => {
    expect(redactSecrets('a query failed', ['a'])).toBe('a query failed');
  });
});

describe('assertWriteQuery', () => {
  it('INSERT · UPDATE · DELETE를 허용한다', () => {
    expect(() => assertWriteQuery("insert into t (a) values (1)")).not.toThrow();
    expect(() => assertWriteQuery('update t set a = 1')).not.toThrow();
    expect(() => assertWriteQuery('delete from t where a = 1')).not.toThrow();
  });

  it('읽기 질의는 db.query로 보낸다', () => {
    expect(() => assertWriteQuery('select 1')).toThrow(/db.query/);
  });

  it('DDL·권한 변경은 승인 게이트로도 열지 않는다', () => {
    // 되돌리기가 사실상 불가능하다.
    for (const bad of ['drop table t', 'alter table t add column x int', 'grant all on t to public', 'truncate t']) {
      expect(() => assertWriteQuery(bad), bad).toThrow(ResourceQueryError);
    }
  });

  it('여러 문장을 거부한다', () => {
    // 승인자가 본 것과 실행되는 것이 같아야 한다.
    expect(() => assertWriteQuery('update t set a = 1; drop table t')).toThrow(ResourceQueryError);
  });

  it('끝의 세미콜론 하나는 허용한다', () => {
    expect(assertWriteQuery('delete from t;')).toBe('delete from t');
  });

  it('빈 질의를 거부한다', () => {
    expect(() => assertWriteQuery('  ')).toThrow(ResourceQueryError);
  });
});
