'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError } from './api';

export interface Resource<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  reload: () => void;
}

/**
 * 로딩 / 에러 / 데이터 3상태를 그대로 노출한다.
 * 실패를 빈 데이터로 감추지 않는다.
 */
export function useResource<T>(load: (() => Promise<T>) | null, deps: unknown[]): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(load !== null);
  const [nonce, setNonce] = useState(0);

  // load 는 매 렌더 새 함수라서 의존성에서 제외하고 호출자가 준 deps 로만 재실행한다.
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!load) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    load()
      .then((value) => {
        if (!alive) return;
        setData(value);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setData(null);
        setError(err instanceof ApiError ? err : new ApiError(0, String(err)));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [...deps, nonce]);

  return { data, error, loading, reload };
}
