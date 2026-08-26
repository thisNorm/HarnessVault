import { Suspense } from 'react';
import { AuthForm } from '@/components/auth-form';
import { LoadingState } from '@/components/ui';

// useSearchParams(초대 링크의 next 처리)가 정적 프리렌더를 막으므로 경계를 둔다.
export default function RegisterPage() {
  return (
    <Suspense fallback={<LoadingState label="불러오는 중" />}>
      <AuthForm mode="register" />
    </Suspense>
  );
}
