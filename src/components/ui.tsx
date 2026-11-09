import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import logoUrl from '../assets/logo.svg';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
export { cx };

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const variants: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg hover:opacity-90',
  secondary: 'bg-raised text-fg border border-line hover:border-faint',
  ghost: 'text-muted hover:text-fg hover:bg-raised',
  danger: 'bg-danger-soft text-danger hover:opacity-90',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  busy,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: 'sm' | 'md';
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || busy}
      aria-busy={busy || undefined}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors whitespace-nowrap',
        'disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-9 px-3.5 text-sm',
        variants[variant],
        className,
      )}
    >
      {busy ? <Spinner /> : null}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={cx(
        'inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-fg disabled:opacity-40 disabled:cursor-not-allowed',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cx(
        'inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent',
        className,
      )}
    />
  );
}

type Tone = 'neutral' | 'accent' | 'warn' | 'danger' | 'info';
const tones: Record<Tone, string> = {
  neutral: 'bg-raised text-muted',
  accent: 'bg-accent-soft text-accent',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
};
export function Badge({
  tone = 'neutral',
  children,
  title,
}: {
  tone?: Tone;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cx(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap',
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium text-fg">
          {label}
        </label>
        {description ? <p className="mt-0.5 text-xs text-faint">{description}</p> : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50',
          checked ? 'bg-accent' : 'bg-line',
        )}
      >
        <span
          className={cx(
            'absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
            checked && 'translate-x-4',
          )}
        />
      </button>
    </div>
  );
}

export function Card({
  title,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx('rounded-xl border border-line bg-surface', className)}>
      {title || actions ? (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-fg">{title}</h2>
          {actions}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'accent' | 'warn';
}) {
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2.5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-faint">{label}</div>
      <div
        className={cx(
          'mt-0.5 text-xl font-semibold tabular-nums',
          tone === 'accent' ? 'text-accent' : tone === 'warn' ? 'text-warn' : 'text-fg',
        )}
      >
        {value}
      </div>
      {hint ? <div className="mt-0.5 text-[11px] text-faint">{hint}</div> : null}
    </div>
  );
}

export function Empty({
  icon,
  title,
  children,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      {icon ? <div className="text-faint">{icon}</div> : null}
      <p className="text-sm font-medium text-fg">{title}</p>
      {children ? <div className="max-w-sm text-xs text-faint">{children}</div> : null}
    </div>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger"
    >
      <span>{message}</span>
      {onRetry ? (
        <Button size="sm" variant="ghost" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

export function Logo({ size = 22, withName = true }: { size?: number; withName?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <img src={logoUrl} width={size} height={size} alt="" />
      {withName ? (
        <span className="text-[15px] font-semibold tracking-tight text-fg">Tablar</span>
      ) : null}
    </span>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string; count?: number }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          type="button"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'h-7 shrink-0 rounded-md px-2.5 text-xs font-medium transition-colors',
            value === o.value
              ? 'bg-accent-soft text-accent'
              : 'text-muted hover:bg-raised hover:text-fg',
          )}
        >
          {o.label}
          {o.count !== undefined ? (
            <span className="ml-1 tabular-nums opacity-70">{o.count}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

export function Dialog({
  open,
  title,
  children,
  actions,
  onClose,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  actions: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-auto w-[min(92vw,420px)] rounded-xl border border-line bg-surface p-0 text-fg shadow-xl backdrop:bg-black/40"
    >
      <div className="p-4">
        <h2 className="text-sm font-semibold">{title}</h2>
        <div className="mt-2 text-sm text-muted">{children}</div>
      </div>
      <div className="flex justify-end gap-2 border-t border-line px-4 py-3">{actions}</div>
    </dialog>
  );
}
