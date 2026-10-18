import { useId, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
  File as FileIcon,
  FileCheck2,
  FileX2,
  Info,
  X,
  XCircle,
} from 'lucide-react';
import { formatBytes } from '../format.js';

/* ---------- Alert ---------- */

export function Alert({
  kind = 'info',
  children,
}: {
  kind?: 'info' | 'warn' | 'error' | 'success';
  children: ReactNode;
}) {
  const Icon = kind === 'error' ? XCircle : kind === 'warn' ? AlertTriangle : kind === 'success' ? CheckCircle2 : Info;
  return (
    <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <Icon size={17} aria-hidden />
      <div>{children}</div>
    </div>
  );
}

/* ---------- Password field ---------- */

export function PasswordField({
  label,
  value,
  onChange,
  error,
  hint,
  autoComplete = 'new-password',
  placeholder = 'Enter a passphrase',
  id,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  hint?: string;
  autoComplete?: string;
  placeholder?: string;
  id?: string;
}) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const [show, setShow] = useState(false);
  return (
    <div className="field">
      <label className="field-label" htmlFor={fieldId}>
        {label}
      </label>
      <div className="password-wrap">
        <input
          id={fieldId}
          className={`input${error ? ' invalid' : ''}`}
          type={show ? 'text' : 'password'}
          value={value}
          autoComplete={autoComplete}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!!error}
          aria-describedby={error ? `${fieldId}-err` : hint ? `${fieldId}-hint` : undefined}
        />
        <button
          type="button"
          className="password-toggle"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? 'Hide password' : 'Show password'}
          aria-pressed={show}
        >
          {show ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
      </div>
      {error ? (
        <div className="field-error" id={`${fieldId}-err`} role="alert">
          <AlertTriangle size={14} aria-hidden /> {error}
        </div>
      ) : hint ? (
        <div className="field-hint" id={`${fieldId}-hint`}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

/* ---------- Password strength (guidance, not a promise) ---------- */

export function passwordStrength(pw: string): { score: 0 | 1 | 2 | 3; label: string; color: string } {
  if (!pw) return { score: 0, label: '', color: 'transparent' };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 14) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9\s]/.test(pw)) score++;
  if (pw.includes(' ') && pw.trim().split(/\s+/).length >= 4) score++;
  if (pw.length < 8) return { score: 0, label: 'Too short — use at least 8 characters', color: 'var(--danger)' };
  if (score <= 2) return { score: 1, label: 'Weak — a longer passphrase is much stronger', color: 'var(--warning)' };
  if (score <= 4) return { score: 2, label: 'Reasonable — longer is still better', color: 'var(--accent)' };
  return { score: 3, label: 'Strong passphrase', color: 'var(--success)' };
}

export function PasswordStrength({ password }: { password: string }) {
  const s = passwordStrength(password);
  if (!password) return null;
  return (
    <div>
      <div className="strength-track" aria-hidden>
        <div
          className="strength-fill"
          style={{ width: `${Math.max(10, s.score * 33)}%`, background: s.color }}
        />
      </div>
      <div className="field-hint mt-4" role="status">
        {s.label}
      </div>
    </div>
  );
}

/* ---------- Segmented control ---------- */

export function SegmentedControl<T extends number | string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          className={`seg-btn${o.value === value ? ' active' : ''}`}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- Dropzone ---------- */

export function Dropzone({
  lead,
  sub,
  multiple,
  onPick,
  onDrop,
  icon,
}: {
  lead: string;
  sub: string;
  multiple?: boolean;
  onPick: () => void;
  onDrop?: (files: FileList) => void;
  icon?: ReactNode;
}) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <div
      className={`dropzone${dragOver ? ' dragover' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={lead}
      onClick={onPick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onPick();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (onDrop) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (onDrop && e.dataTransfer.files.length > 0) onDrop(e.dataTransfer.files);
      }}
    >
      <div className="dropzone-icon">{icon ?? <FileIcon size={20} />}</div>
      <p className="lead">{lead}</p>
      <p className="sub">
        {sub}
        {multiple || onDrop ? ' · drag & drop supported' : ''}
      </p>
    </div>
  );
}

/* ---------- File chip ---------- */

export function FileChip({
  name,
  meta,
  onRemove,
}: {
  name: string;
  meta: string;
  onRemove?: () => void;
}) {
  return (
    <div className="file-chip">
      <div className="ficon">
        <FileIcon size={18} aria-hidden />
      </div>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="fname">{name}</div>
        <div className="fmeta">{meta}</div>
      </div>
      {onRemove && (
        <button type="button" className="btn btn-ghost btn-sm fremove" onClick={onRemove} aria-label={`Remove ${name}`}>
          <X size={15} />
        </button>
      )}
    </div>
  );
}

/* ---------- Part list (package selection) ---------- */

export function PartList({ names, present }: { names: string[]; present: Set<string> }) {
  return (
    <div className="part-list" role="list" aria-label="Package parts">
      {names.map((n) => {
        const ok = present.has(n);
        return (
          <div className={`part-row ${ok ? 'ok' : 'miss'}`} key={n} role="listitem">
            <span className="pstatus" aria-label={ok ? 'present' : 'missing'}>
              {ok ? <FileCheck2 size={15} /> : <FileX2 size={15} />}
            </span>
            <span className="pname">{n}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Progress ---------- */

export function ProgressBlock({
  phaseLabel,
  done,
  total,
}: {
  phaseLabel: string;
  done: number;
  total: number;
}) {
  const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0;
  const indeterminate = total === 0;
  return (
    <div className="progress-block">
      <div className="progress-meta">
        <span className="progress-phase">{phaseLabel}</span>
        {!indeterminate && <span>{Math.floor(pct)}%</span>}
      </div>
      <div
        className="progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={indeterminate ? undefined : Math.floor(pct)}
        aria-label={phaseLabel}
      >
        <div
          className={`progress-fill${indeterminate ? ' indeterminate' : ''}`}
          style={indeterminate ? undefined : { width: `${pct}%` }}
        />
      </div>
      {!indeterminate && (
        <div className="progress-meta">
          <span className="muted small">
            {formatBytes(done)} of {formatBytes(total)}
          </span>
        </div>
      )}
    </div>
  );
}

/* ---------- Stat ---------- */

export function Stat({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="stat">
      <div className="s-label">{label}</div>
      <div className={`s-value${mono ? ' mono' : ''}`}>{value}</div>
    </div>
  );
}
