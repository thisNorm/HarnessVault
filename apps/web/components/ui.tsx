import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

type Tone = 'active' | 'pending' | 'locked' | 'deny' | 'accent';

const TONE: Record<Tone, string> = {
  active: 'text-state-active border-state-active/30 bg-state-active/10',
  pending: 'text-state-pending border-state-pending/30 bg-state-pending/10',
  locked: 'text-state-locked border-state-locked/30 bg-state-locked/10',
  deny: 'text-state-deny border-state-deny/30 bg-state-deny/10',
  accent: 'text-accent-text border-accent/40 bg-accent-soft',
};

export function Badge({ tone = 'locked', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-xs border px-1.5 py-0.5 text-2xs font-medium tracking-wide ${TONE[tone]}`}
    >
      {children}
    </span>
  );
}

const STATUS_TONE: Record<string, Tone> = {
  ACTIVE: 'active',
  PENDING: 'pending',
  LOCKED: 'locked',
  DENY: 'deny',
};

/** 도메인 상태값은 번역하지 않고 그대로 노출한다. */
export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? 'locked'}>{status}</Badge>;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
};

const BUTTON: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'bg-accent text-accent-fg hover:bg-accent-hover border-transparent',
  secondary: 'bg-surface text-fg hover:bg-surface-hover border-border',
  ghost: 'bg-transparent text-fg-muted hover:text-fg hover:bg-surface-hover border-transparent',
  danger: 'bg-transparent text-state-deny hover:bg-state-deny/10 border-transparent',
};

export function Button({ variant = 'secondary', className = '', ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-sm border px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${BUTTON[variant]} ${className}`}
    />
  );
}

const FIELD =
  'h-8 w-full rounded-sm border border-border bg-bg-raised px-2.5 text-sm text-fg placeholder:text-fg-subtle disabled:opacity-50';

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${FIELD} ${className}`} />;
}

export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${FIELD} ${className}`} />;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-2xs font-medium tracking-wide text-fg-subtle uppercase">{label}</span>
      {children}
    </label>
  );
}

export function Card({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <section className={`rounded-lg border border-border bg-surface ${className}`}>{children}</section>
  );
}

export function CardHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <header className="flex items-start justify-between gap-4 border-b border-border px-4 py-3">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-fg">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-fg-muted">{description}</p> : null}
      </div>
      {action}
    </header>
  );
}

/* ---- 로딩 / 빈 / 에러 3상태 ---- */

export function LoadingState({ label = '불러오는 중' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 px-4 py-8 text-sm text-fg-muted">
      <span className="size-1.5 animate-pulse rounded-full bg-state-pending" />
      {label}…
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="px-4 py-8">
      <p className="text-sm text-fg-muted">{title}</p>
      {hint ? <p className="mt-1 text-xs text-fg-subtle">{hint}</p> : null}
    </div>
  );
}

export function ErrorState({
  title,
  statusCode,
  message,
  onRetry,
}: {
  title: string;
  statusCode?: number;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="m-4 rounded-md border border-state-deny/30 bg-state-deny/5 px-4 py-3.5">
      <div className="flex items-center gap-2">
        <Badge tone="deny">{statusCode ? `HTTP ${statusCode}` : 'NETWORK'}</Badge>
        <span className="text-sm font-medium text-fg">{title}</span>
      </div>
      <p className="mt-2 font-mono text-xs break-all text-fg-muted">{message}</p>
      {onRetry ? (
        <Button variant="secondary" className="mt-3" onClick={onRetry}>
          다시 시도
        </Button>
      ) : null}
    </div>
  );
}

export function PageHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-5">
      <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
      <p className="mt-1 text-xs text-fg-muted">{description}</p>
    </div>
  );
}

export interface MemberRow {
  userId: string;
  email: string;
  displayName: string;
  role?: string;
}

export function MemberTable({
  members,
  onRemove,
  busyUserId,
}: {
  members: MemberRow[];
  onRemove: (userId: string) => void;
  busyUserId?: string | null;
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-2xs tracking-wider text-fg-subtle uppercase">
          <th className="px-4 py-2 font-medium">사용자</th>
          <th className="px-4 py-2 font-medium">Role</th>
          <th className="w-16 px-4 py-2" />
        </tr>
      </thead>
      <tbody>
        {members.map((m) => (
          <tr key={m.userId} className="border-t border-border">
            <td className="px-4 py-2.5">
              <div className="font-medium text-fg">{m.displayName}</div>
              <div className="font-mono text-xs text-fg-subtle">{m.email}</div>
            </td>
            <td className="px-4 py-2.5">{m.role ? <Badge tone="accent">{m.role}</Badge> : null}</td>
            <td className="px-4 py-2.5 text-right">
              <Button
                variant="danger"
                disabled={busyUserId === m.userId}
                onClick={() => onRemove(m.userId)}
              >
                제거
              </Button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
