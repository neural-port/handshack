import {
  ArrowRight,
  FileLock2,
  FileUp,
  FolderSync,
  Lock,
  PackageOpen,
  Puzzle,
  Share2,
  ShieldCheck,
} from 'lucide-react';
import { Link, routePath } from '../router.js';
import { usePlatform } from '../platform.js';
import { Alert } from '../components/ui.js';

export function HomePage() {
  const platform = usePlatform();
  const isWeb = platform.platform === 'web';

  return (
    <div>
      <div className="home-hero">
        <h1>Your files. Your control.</h1>
        <p>
          Encrypt sensitive files locally, split them into shareable parts, and restore them when
          needed. Nothing leaves your device.
        </p>
      </div>

      <div className="action-cards">
        <Link to="encrypt" className="action-card">
          <div className="a-icon enc">
            <Lock size={19} />
          </div>
          <h3>Encrypt &amp; Split</h3>
          <p>
            Protect a file with AES-256-GCM encryption, then split it into small parts you can share
            separately.
          </p>
          <span className="a-cta">
            Start <ArrowRight size={14} />
          </span>
        </Link>
        <Link to="decrypt" className="action-card">
          <div className="a-icon dec">
            <PackageOpen size={19} />
          </div>
          <h3>Reassemble &amp; Decrypt</h3>
          <p>
            Combine a manifest and its encrypted parts, enter the password, and restore the exact
            original file.
          </p>
          <span className="a-cta">
            Start <ArrowRight size={14} />
          </span>
        </Link>
      </div>

      <div className="card card-pad">
        <div className="card-title">
          <Puzzle size={16} style={{ color: 'var(--accent)' }} />
          How a package travels
        </div>
        <div className="pipeline" aria-label="Processing steps">
          <span className="p-step">
            <FileUp size={15} /> Select a file
          </span>
          <ArrowRight size={14} className="p-arrow" />
          <span className="p-step">
            <Lock size={15} /> Encrypt locally
          </span>
          <ArrowRight size={14} className="p-arrow" />
          <span className="p-step">
            <FileLock2 size={15} /> Split into parts
          </span>
          <ArrowRight size={14} className="p-arrow" />
          <span className="p-step">
            <Share2 size={15} /> Share the package
          </span>
          <ArrowRight size={14} className="p-arrow" />
          <span className="p-step">
            <FolderSync size={15} /> Reassemble &amp; decrypt
          </span>
        </div>
      </div>

      <div className="card card-pad mt-16">
        <div className="stack">
          <div className="row">
            <ShieldCheck size={18} style={{ color: 'var(--accent)', flexShrink: 0 }} />
            <h3 style={{ fontSize: 15 }}>Local-first by design</h3>
          </div>
          <p className="muted" style={{ fontSize: 14 }}>
            HandShack processes files on your device.{' '}
            {isWeb
              ? 'The web demo does not intentionally upload selected file contents to a HandShack server.'
              : 'The desktop app works fully offline and never sends file contents anywhere.'}
          </p>
          {isWeb && (
            <Alert kind="info">
              Browser-based processing has different limits than the installed desktop app — malicious
              extensions or a compromised browser can affect privacy.{' '}
              <a href="#/" style={{ color: 'inherit', fontWeight: 600 }}>
                Download the desktop app
              </a>{' '}
              for the strongest isolation.
            </Alert>
          )}
          <p className="muted small">
            Splitting alone is not protection — encryption is what keeps the contents private. Anyone
            who obtains all parts, the manifest, and the password can recover the file.{' '}
            <a href={routePath('security')}>Read the security details</a>.
          </p>
        </div>
      </div>
    </div>
  );
}
