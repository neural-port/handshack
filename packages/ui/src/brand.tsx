/**
 * HandShack brand mark — two interlocking geometric links suggesting a
 * handshake / shackle. Pure SVG, recognizable at small sizes.
 */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      role="img"
      aria-label="HandShack logo"
      style={{ display: 'block' }}
    >
      <rect x="1.5" y="1.5" width="45" height="45" rx="4" fill="url(#hs-tile)" stroke="var(--border-strong)" />
      <path
        d="M18.5 31.5l-2.7-2.7a5.6 5.6 0 0 1 0-7.9l5.2-5.2a5.6 5.6 0 0 1 7.9 0l2 2"
        stroke="var(--accent)"
        strokeWidth="3.4"
        strokeLinecap="round"
      />
      <path
        d="M29.5 16.5l2.7 2.7a5.6 5.6 0 0 1 0 7.9l-5.2 5.2a5.6 5.6 0 0 1-7.9 0l-2-2"
        stroke="var(--text-primary)"
        strokeWidth="3.4"
        strokeLinecap="round"
      />
      <defs>
        <linearGradient id="hs-tile" x1="0" y1="0" x2="48" y2="48">
          <stop offset="0" stopColor="#1B2027" />
          <stop offset="1" stopColor="#10131A" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function BrandWordmark({ size = 28 }: { size?: number }) {
  return (
    <span className="brand-wordmark" style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <BrandMark size={size} />
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: size * 0.6,
          letterSpacing: '0.01em',
          textTransform: 'uppercase',
        }}
      >
        Hand<span style={{ color: 'var(--accent-text)' }}>Shack</span>
      </span>
    </span>
  );
}
