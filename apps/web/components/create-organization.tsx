'use client';

import { useState, type FormEvent } from 'react';
import { ApiError, post } from '@/lib/api';
import { useSession } from './session';
import { Button, Card, CardHeader, ErrorState, Field, Input } from '@/components/ui';

/** 이름에서 slug 초안을 만든다. 한글은 slug로 쓸 수 없으므로 비면 사용자가 직접 채운다. */
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * 조직에 속하지 않은 계정이 막다른 길에 갇히지 않도록,
 * 첫 조직을 여기서 바로 만들 수 있게 한다. 생성자는 ORG_ADMIN이 된다.
 */
export function CreateOrganization() {
  const { session } = useSession();
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await post('/organizations', { name: name.trim(), slug: slug.trim() });
      session.reload();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err : new ApiError(0, String(err)));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="mx-auto max-w-lg">
      <CardHeader
        title="조직 만들기"
        description="이 계정은 아직 어느 조직에도 속해 있지 않습니다. 조직을 만들면 관리자가 됩니다."
      />
      <form onSubmit={submit} className="flex flex-col gap-3 px-4 py-4">
        <Field label="이름">
          <Input
            required
            value={name}
            placeholder="Acme Corporation"
            onChange={(e) => {
              setName(e.target.value);
              if (!slugTouched) setSlug(toSlug(e.target.value));
            }}
          />
        </Field>
        <Field label="Slug">
          <Input
            required
            value={slug}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            minLength={2}
            maxLength={64}
            placeholder="acme"
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value);
            }}
          />
        </Field>
        <p className="text-2xs text-fg-subtle">
          Slug는 소문자·숫자·하이픈만 쓸 수 있고 URL과 Harness Asset key에 그대로 쓰입니다.
        </p>
        <Button type="submit" variant="primary" disabled={pending} className="mt-1 self-start">
          {pending ? '만드는 중…' : '조직 만들기'}
        </Button>
      </form>
      {error ? <ErrorState title="조직을 만들지 못했습니다" statusCode={error.statusCode || undefined} message={error.message} /> : null}
    </Card>
  );
}
