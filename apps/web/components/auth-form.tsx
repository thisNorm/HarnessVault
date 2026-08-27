'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { safeNext } from '@/lib/next-path';
import { ApiError, post, type User } from '@/lib/api';
import { Button, ErrorState, Field, Input } from './ui';

const COPY = {
  login: {
    title: '로그인',
    submit: '로그인',
    path: '/auth/login',
    altText: '계정이 없으신가요?',
    altHref: '/register',
    altLabel: '가입',
  },
  register: {
    title: '가입',
    submit: '계정 만들기',
    path: '/auth/register',
    altText: '이미 계정이 있다면',
    altHref: '/login',
    altLabel: '로그인',
  },
} satisfies Record<string, Record<string, string>>;

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const copy = COPY[mode];
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body =
      mode === 'register'
        ? {
            email: String(form.get('email')),
            password: String(form.get('password')),
            displayName: String(form.get('displayName')),
          }
        : { email: String(form.get('email')), password: String(form.get('password')) };

    setPending(true);
    setError(null);
    try {
      await post<{ user: User }>(copy.path, body);
      router.replace(safeNext(searchParams.get('next')));
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err : new ApiError(0, String(err)));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-5 py-10">
      <div className="w-full max-w-88">
        <div className="mb-6 flex items-center gap-2">
          <span className="size-4 rounded-sm border border-accent/60 bg-accent-dim" aria-hidden />
          <span className="text-sm font-semibold tracking-tight">HarnessVault</span>
        </div>

        <div className="rounded-lg border border-line bg-surface">
          <div className="border-b border-line px-5 py-4">
            <h1 className="text-base font-semibold">{copy.title}</h1>
            <p className="mt-0.5 text-xs text-fg-muted">Company Harness Runtime 콘솔</p>
          </div>

          <form onSubmit={onSubmit} className="flex flex-col gap-3.5 px-5 py-5">
            {mode === 'register' ? (
              <Field label="표시 이름">
                <Input name="displayName" required autoComplete="name" placeholder="홍길동" />
              </Field>
            ) : null}
            <Field label="이메일">
              <Input
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@company.com"
              />
            </Field>
            <Field label="비밀번호">
              <Input
                name="password"
                type="password"
                required
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                placeholder="********"
              />
            </Field>
            <Button type="submit" variant="primary" disabled={pending} className="mt-1 w-full">
              {pending ? '처리 중…' : copy.submit}
            </Button>
          </form>

          {error ? (
            <ErrorState
              title={`${copy.title} 실패`}
              statusCode={error.statusCode || undefined}
              message={error.message}
            />
          ) : null}
        </div>

        <p className="mt-4 text-xs text-fg-muted">
          {copy.altText}{' '}
          <Link href={copy.altHref} className="text-accent hover:text-fg">
            {copy.altLabel}
          </Link>
        </p>
      </div>
    </main>
  );
}
