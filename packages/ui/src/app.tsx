import { useState } from 'react';
import {
  Download,
  Github,
  HelpCircle,
  Home,
  Info,
  Lock,
  Menu,
  PackageOpen,
  ScrollText,
  ShieldCheck,
} from 'lucide-react';
import { BrandWordmark } from './brand.js';
import { PlatformProvider, usePlatform, type PlatformServices } from './platform.js';
import { Link, routePath, useRoute, type RouteId } from './router.js';
import { LandingPage } from './pages/landing.js';
import { HomePage } from './pages/home.js';
import { EncryptPage } from './pages/encrypt.js';
import { DecryptPage } from './pages/decrypt.js';
import { HowItWorksPage } from './pages/how-it-works.js';
import { SecurityPage } from './pages/security.js';
import { AboutPage } from './pages/about.js';

interface NavEntry {
  route: RouteId;
  label: string;
  icon: typeof Home;
}

const APP_NAV: NavEntry[] = [
  { route: 'encrypt', label: 'Encrypt & Split', icon: Lock },
  { route: 'decrypt', label: 'Reassemble & Decrypt', icon: PackageOpen },
];

const INFO_NAV: NavEntry[] = [
  { route: 'how-it-works', label: 'How It Works', icon: HelpCircle },
  { route: 'security', label: 'Security & Privacy', icon: ShieldCheck },
  { route: 'about', label: 'About HandShack', icon: Info },
];

export function App({ services }: { services: PlatformServices }) {
  return (
    <PlatformProvider value={services}>
      <RoutedApp />
    </PlatformProvider>
  );
}

function RoutedApp() {
  const { route } = useRoute();
  const platform = usePlatform();

  if (route === 'landing') {
    // The desktop app has no marketing landing page — go straight to the app.
    return platform.platform === 'web' ? <LandingPage /> : <AppShell route="encrypt" />;
  }
  return <AppShell route={route} />;
}

function AppShell({ route }: { route: RouteId }) {
  const platform = usePlatform();
  const [navOpen, setNavOpen] = useState(false);
  const isWeb = platform.platform === 'web';

  const tab = (r: RouteId, label: string, onNavigate?: () => void) => (
    <Link
      key={r}
      to={r}
      className={`topnav-tab${route === r ? ' active' : ''}`}
      onClick={onNavigate}
      aria-label={label}
    >
      {label}
    </Link>
  );

  const quietLink = (r: RouteId, label: string, onNavigate?: () => void) => (
    <Link
      key={r}
      to={r}
      className={`topnav-link${route === r ? ' active' : ''}`}
      onClick={onNavigate}
      aria-label={label}
    >
      {label}
    </Link>
  );

  return (
    <div className="shell">
      <header className="topnav">
        <a
          href={isWeb ? routePath('landing') : routePath('home')}
          className="topnav-brand"
          style={{ textDecoration: 'none' }}
        >
          <BrandWordmark size={26} />
        </a>

        <nav className="topnav-tabs" aria-label="Primary">
          {tab('encrypt', 'Encrypt')}
          {tab('decrypt', 'Decrypt')}
        </nav>

        <div className="topnav-side">
          <nav className="topnav-quiet" aria-label="Learn">
            {quietLink('how-it-works', 'How it works')}
            {quietLink('security', 'Security')}
            {quietLink('about', 'About')}
          </nav>
          <span className="topnav-badge" title={isWeb ? 'Web demo' : 'Desktop app'}>
            {isWeb ? 'Web' : 'Desktop'} · v{platform.version}
          </span>
          <button
            type="button"
            className="topnav-menu-btn"
            onClick={() => setNavOpen((o) => !o)}
            aria-label="Toggle navigation"
            aria-expanded={navOpen}
          >
            <Menu size={19} />
          </button>
        </div>
      </header>

      {navOpen && (
        <nav className="nav-panel" aria-label="Navigation">
          <div className="nav-panel-group">
            <div className="nav-panel-label">Application</div>
            {APP_NAV.map(({ route: r, label, icon: Icon }) => (
              <Link
                key={r}
                to={r}
                className={`nav-panel-item${route === r ? ' active' : ''}`}
                onClick={() => setNavOpen(false)}
              >
                <Icon size={16} aria-hidden /> {label}
              </Link>
            ))}
          </div>
          <div className="nav-panel-group">
            <div className="nav-panel-label">Learn</div>
            {INFO_NAV.map(({ route: r, label, icon: Icon }) => (
              <Link
                key={r}
                to={r}
                className={`nav-panel-item${route === r ? ' active' : ''}`}
                onClick={() => setNavOpen(false)}
              >
                <Icon size={16} aria-hidden /> {label}
              </Link>
            ))}
          </div>
          {isWeb && platform.release?.repoUrl && (
            <div className="nav-panel-group">
              <div className="nav-panel-label">Project</div>
              {platform.release.installerUrl && (
                <a className="nav-panel-item" href={platform.release.installerUrl} target="_blank" rel="noopener noreferrer">
                  <Download size={16} aria-hidden /> Download Desktop App
                </a>
              )}
              <a className="nav-panel-item" href={platform.release.repoUrl} target="_blank" rel="noopener noreferrer">
                <Github size={16} aria-hidden /> Source Code
              </a>
              {platform.release.notesUrl && (
                <a className="nav-panel-item" href={platform.release.notesUrl} target="_blank" rel="noopener noreferrer">
                  <ScrollText size={16} aria-hidden /> Release Notes
                </a>
              )}
            </div>
          )}
        </nav>
      )}

      <main className="main">
        {route === 'home' && <HomePage />}
        {route === 'encrypt' && <EncryptPage />}
        {route === 'decrypt' && <DecryptPage />}
        {route === 'how-it-works' && <HowItWorksPage />}
        {route === 'security' && <SecurityPage />}
        {route === 'about' && <AboutPage />}
      </main>
    </div>
  );
}
