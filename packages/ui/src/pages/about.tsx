import { BrandMark } from '../brand.js';
import { usePlatform } from '../platform.js';

export function AboutPage() {
  const { version, platform } = usePlatform();
  return (
    <div>
      <header className="page-head">
        <div className="eyebrow">About</div>
        <h1>HandShack</h1>
        <p>Private files. Protected before they leave your device.</p>
      </header>

      <div className="prose">
        <div className="card card-pad" style={{ display: 'flex', gap: 18, alignItems: 'center', maxWidth: 480 }}>
          <BrandMark size={52} />
          <div>
            <div style={{ fontWeight: 650, fontSize: 18 }}>
              Hand<span style={{ color: 'var(--accent)' }}>Shack</span>
            </div>
            <div className="muted small">
              Version {version} · {platform === 'web' ? 'Web demo' : 'Windows desktop'} · MIT licensed
            </div>
          </div>
        </div>

        <h2>What it is</h2>
        <p>
          HandShack is a local-first tool for encrypting a sensitive file and splitting the
          encrypted package into smaller parts you can share through ordinary channels — email,
          cloud drives, removable media. The recipient reassembles the parts and decrypts them with
          the password you shared separately.
        </p>
        <p>
          There are no accounts, no servers handling your files, no tracking, and no uploads. The
          web demo and the Windows desktop app produce compatible packages: a file encrypted in one
          can be restored in the other.
        </p>

        <h2>Design goals</h2>
        <ul>
          <li>
            <strong>Local-first:</strong> all encryption and packaging happens on your device.
          </li>
          <li>
            <strong>Honest security:</strong> established primitives only — AES-256-GCM + scrypt —
            with documented limits and no exaggerated claims.
          </li>
          <li>
            <strong>Cross-platform:</strong> one versioned package format shared by the web and
            desktop builds, verified by automated compatibility tests.
          </li>
          <li>
            <strong>Transparent:</strong> the format is specified in{' '}
            <code>docs/ENCRYPTION_FORMAT.md</code>; the source is MIT-licensed.
          </li>
        </ul>

        <h2>A NeuralWeb Technologies product</h2>
        <p>
          HandShack is developed and maintained by NeuralWeb Technologies, Goa.
        </p>
      </div>
    </div>
  );
}
