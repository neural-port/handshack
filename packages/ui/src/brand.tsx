import iconUrl from './assets/handshack-icon.png';

/**
 * HandShack brand mark — the packaged app icon ("N" tile), shared so the
 * in-app surfaces match the installed/taskbar branding.
 */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <img
      src={iconUrl}
      width={size}
      height={size}
      alt="HandShack logo"
      style={{ display: 'block', borderRadius: Math.round(size * 0.22) }}
    />
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
