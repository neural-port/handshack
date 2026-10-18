import {
  ArrowRight,
  Download,
  Eye,
  FileUp,
  Github,
  Globe,
  Lock,
  MonitorDown,
  MoveRight,
  PackageOpen,
  ScrollText,
  ShieldCheck,
  ShieldOff,
  Split,
} from 'lucide-react';
import { BrandMark, BrandWordmark } from '../brand.js';
import { usePlatform } from '../platform.js';
import { routePath } from '../router.js';
import { Alert } from '../components/ui.js';

/* Visual: file -> encrypted package -> parts. Pure CSS/markup, no image. */
function PipelineVisual() {
  return (
    <div className="pv" aria-hidden>
      <div className="pv-lane">
        <div className="pv-node pv-file">
          <FileUp size={16} />
          <span className="pv-name">family-photos.zip</span>
          <span className="pv-meta">original · 412 MB</span>
        </div>
        <div className="pv-arrow">
          <MoveRight size={15} />
          <span>AES-256-GCM</span>
        </div>
        <div className="pv-node pv-lock">
          <Lock size={16} />
          <span className="pv-name">encrypted stream</span>
          <span className="pv-meta">+16 B auth tag / record</span>
        </div>
        <div className="pv-arrow">
          <MoveRight size={15} />
          <span>split</span>
        </div>
        <div className="pv-parts">
          <div className="pv-node pv-part">.part001.hsp</div>
          <div className="pv-node pv-part">.part002.hsp</div>
          <div className="pv-node pv-part">.part003.hsp</div>
          <div className="pv-node pv-part pv-manifest">.hsmanifest.json</div>
        </div>
      </div>
      <div className="pv-caption">Everything above happens on your device.</div>
    </div>
  );
}

export function LandingPage() {
  const { release, version } = usePlatform();
  const hasRelease = !!release?.latestVersion;

  return (
    <div className="landing">
      <nav className="landing-nav">
        <a href="#/" style={{ textDecoration: 'none', color: 'inherit' }} aria-label="HandShack home">
          <BrandWordmark size={28} />
        </a>
        <div className="links">
          <a href="#how-it-works">How it works</a>
          <a href="#privacy">Privacy</a>
          <a href="#download">Download</a>
          {release?.repoUrl && (
            <a href={release.repoUrl} target="_blank" rel="noreferrer">
              Source
            </a>
          )}
          <a href={routePath('home')} className="btn btn-primary btn-sm" style={{ marginLeft: 8 }}>
            Open the app
          </a>
        </div>
      </nav>

      {/* ---------- Band 1: hero ---------- */}
      <section className="band band-hero">
        <div className="band-inner hero-grid">
          <div className="hero-copy">
            <div className="hero-badge">
              <ShieldCheck size={14} /> Local-first · open source · no accounts
            </div>
            <h1>
              Private files.
              <br />
              <span className="accent-word">Protected before sharing.</span>
            </h1>
            <p className="lead">
              Encrypt your files, split them into smaller parts, and restore them when needed. Try
              HandShack directly in your browser — nothing is uploaded.
            </p>
            <div className="cta-row">
              <a href={routePath('home')} className="btn btn-primary btn-lg">
                Try HandShack <ArrowRight size={17} />
              </a>
              <a href="#download" className="btn btn-secondary btn-lg">
                <MonitorDown size={17} /> Download for Windows
              </a>
            </div>
          </div>
          <PipelineVisual />
        </div>
      </section>

      {/* ---------- Band 2: how it works ---------- */}
      <section className="band band-white" id="how-it-works">
        <div className="band-inner">
          <div className="sec-head">
            <div className="eyebrow">How it works</div>
            <h2>Four steps, all on your device</h2>
            <p>Encrypt. Split. Share. Rebuild.</p>
          </div>
          <div className="steps-grid">
            {[
              {
                icon: FileUp,
                n: '01',
                t: 'Choose a file',
                d: 'Pick any file — a photo, document, video, or archive. It never leaves your device.',
              },
              {
                icon: Lock,
                n: '02',
                t: 'Encrypt it',
                d: 'A password-derived key encrypts the file with AES-256-GCM authenticated encryption.',
              },
              {
                icon: Split,
                n: '03',
                t: 'Split the package',
                d: 'The encrypted stream is cut into small parts with a manifest describing the set.',
              },
              {
                icon: PackageOpen,
                n: '04',
                t: 'Rebuild it later',
                d: 'Combine the parts, enter the password, and restore the file byte-for-byte.',
              },
            ].map((s) => (
              <div className="step-card" key={s.n}>
                <div className="s-icon">
                  <s.icon size={19} />
                </div>
                <div className="s-num">STEP {s.n}</div>
                <h3>{s.t}</h3>
                <p>{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Band 3: privacy (ink) ---------- */}
      <section className="band band-ink" id="privacy">
        <div className="band-inner">
          <div className="sec-head">
            <div className="eyebrow">Privacy</div>
            <h2>Processing happens where the file lives</h2>
            <p>
              HandShack is designed so selected file contents are processed locally — in your
              browser or in the installed desktop app.
            </p>
          </div>
          <div className="three-col">
            <div className="feature-card dark">
              <h3>
                <Eye size={16} /> Nothing to intercept
              </h3>
              <p>
                No uploads, no accounts, no tracking. The web demo does not intentionally send file
                contents or passwords anywhere — there's no server-side file handling to trust.
              </p>
            </div>
            <div className="feature-card dark">
              <h3>
                <Lock size={16} /> Share keys separately
              </h3>
              <p>
                The password is never stored in the package. Send it through a different channel
                than the files — anyone holding both the full package and the password can recover
                the file.
              </p>
            </div>
            <div className="feature-card dark">
              <h3>
                <ShieldOff size={16} /> Know the limits
              </h3>
              <p>
                A compromised device, browser, or extension can undermine privacy. For
                high-sensitivity work, use the installed desktop app — and read the honest security
                notes.
              </p>
            </div>
          </div>
          <div className="band-alert">
            <Alert kind="info">
              <span>
                HandShack processes selected files locally in your browser. The application is
                designed not to upload file contents or encryption passwords to a HandShack server.
                Your browser, extensions, operating system, hosting provider, or device may still
                expose certain metadata or affect your privacy. Use the desktop application if you
                prefer locally installed processing.
              </span>
            </Alert>
          </div>
        </div>
      </section>

      {/* ---------- Band 4: download ---------- */}
      <section className="band band-paper" id="download">
        <div className="band-inner">
          <div className="sec-head">
            <div className="eyebrow">Desktop</div>
            <h2>HandShack for Windows</h2>
            <p>
              The desktop app runs fully offline, keeps cryptography in an isolated process, and
              produces packages compatible with this web demo.
            </p>
          </div>
          <div className="two-col" style={{ maxWidth: 860, margin: '0 auto' }}>
            <div className="release-card">
              <div className="row-between">
                <h3 style={{ fontSize: 15 }}>
                  <Download size={15} style={{ color: 'var(--accent)', verticalAlign: -3 }} />{' '}
                  Windows installer
                </h3>
                {hasRelease ? (
                  <span className="badge badge-accent">v{release!.latestVersion}</span>
                ) : (
                  <span className="badge badge-muted">Pending</span>
                )}
              </div>
              {hasRelease ? (
                <>
                  <div className="release-row">
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>
                        HandShack-Setup-{release!.latestVersion}.exe
                      </div>
                      <div className="muted small">NSIS installer · Windows 10/11 x64</div>
                    </div>
                    <a className="btn btn-primary btn-sm" href={release!.installerUrl}>
                      <Download size={14} /> Download
                    </a>
                  </div>
                  {release!.portableUrl && (
                    <div className="release-row">
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>
                          HandShack-Portable-{release!.latestVersion}.exe
                        </div>
                        <div className="muted small">Portable build · no installation</div>
                      </div>
                      <a className="btn btn-secondary btn-sm" href={release!.portableUrl}>
                        <Download size={14} /> Download
                      </a>
                    </div>
                  )}
                  {release!.installerSha256 && (
                    <p className="muted small mono" style={{ wordBreak: 'break-all' }}>
                      SHA-256: {release!.installerSha256}
                    </p>
                  )}
                  {release!.notesUrl && (
                    <a href={release!.notesUrl} className="small">
                      <ScrollText size={13} style={{ verticalAlign: -2 }} /> Release notes
                    </a>
                  )}
                </>
              ) : (
                <div className="release-row">
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>First release in preparation</div>
                    <div className="muted small">
                      Windows installer &amp; portable builds will be published through GitHub
                      Releases. The web demo is fully functional today.
                    </div>
                  </div>
                  <span className="badge badge-muted">v{version}</span>
                </div>
              )}
            </div>
            <div className="release-card">
              <h3 style={{ fontSize: 15 }}>
                <Globe size={15} style={{ color: 'var(--accent)', verticalAlign: -3 }} /> Web demo
              </h3>
              <p className="muted small">
                Runs entirely in your browser — real encryption, splitting, reconstruction, and
                decryption. Packages are compatible with the desktop app.
              </p>
              <a
                href={routePath('home')}
                className="btn btn-primary"
                style={{ alignSelf: 'flex-start' }}
              >
                Open the web app <ArrowRight size={15} />
              </a>
              <hr className="divider" />
              <h3 style={{ fontSize: 15 }}>
                <Github size={15} style={{ color: 'var(--accent)', verticalAlign: -3 }} /> Source
                code
              </h3>
              {release?.repoUrl ? (
                <a href={release.repoUrl} target="_blank" rel="noreferrer" className="small">
                  {release.repoUrl.replace(/^https?:\/\//, '')}
                </a>
              ) : (
                <p className="muted small">
                  The public repository link will appear here once published.
                </p>
              )}
            </div>
          </div>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="row">
          <BrandMark size={22} />
          <span>
            HandShack · Encrypt. Split. Share. Rebuild. · v{version} · MIT
          </span>
        </div>
        <div className="flinks">
          <a href={routePath('about')}>About</a>
          <a href="#how-it-works">How It Works</a>
          <a href={routePath('security')}>Security &amp; Privacy</a>
          {release?.repoUrl && (
            <a href={release.repoUrl} target="_blank" rel="noreferrer">
              Source Code
            </a>
          )}
          <a href="#download">Releases</a>
          {release?.notesUrl && <a href={release.notesUrl}>Release Notes</a>}
        </div>
      </footer>
    </div>
  );
}
