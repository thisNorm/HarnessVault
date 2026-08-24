'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api, type Me } from '@/lib/api';
import { LoadingState } from '@/components/ui';

export default function IndexPage() {
  const router = useRouter();

  useEffect(() => {
    api<Me>('/auth/me').then(
      () => router.replace('/admin/organization'),
      () => router.replace('/login'),
    );
  }, [router]);

  return (
    <div className="grid min-h-screen place-items-center">
      <LoadingState label="세션 확인 중" />
    </div>
  );
}
