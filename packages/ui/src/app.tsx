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
  { route: 'home', label: 'Home', icon: Home },
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
    return platform.platform === 'web' ? <LandingPage /> : <AppShell route="home" />;
  }
  return <AppShell route={route} />;
}

function AppShell({ route }: { route: RouteId }) {
  const platform = usePlatform();
  const [navOpen, setNavOpen] = useState(false);
  const isWeb = platform.platform === 'web';

  const nav = (items: NavEntry[], onNavigate?: () => void) =>
    items.map(({ route: r, label, icon: Icon }) => (
      <Link
        key={r}
        to={r}
        className={`nav-item${route === r ? ' active' : ''}`}
        onClick={onNavigate}
        aria-label={label}
      >
        <Icon size={17} aria-hidden />
        {label}
      </Link>
    ));

  return (
    <div className="shell">
      <nav className={`sidebar${navOpen ? ' mobile-open' : ''}`} aria-label="Primary">
        <div className="brand">
          <a
            href={isWeb ? routePath('landing') : routePath('home')}
            style={{ textDecoration: 'none', color: 'inherit' }}
          >
            <BrandWordmark size={30} />
          </a>
        </div>
        <div className="nav-section">Application</div>
        {nav(APP_NAV, () => setNavOpen(false))}
        <div className="nav-section">Learn</div>
        {nav(INFO_NAV, () => setNavOpen(false))}
        {isWeb && (
          <>
            <div className="nav-section">Project</div>
            <a className="nav-item" href="#/" onClick={() => setNavOpen(false)}>
              <Download size={17} aria-hidden /> Website & Downloads
            </a>
            <a className="nav-item" href="#/" onClick={() => setNavOpen(false)}>
              <Github size={17} aria-hidden /> Source Code
            </a>
            <a className="nav-item" href="#/" onClick={() => setNavOpen(false)}>
              <ScrollText size={17} aria-hidden /> Release Notes
            </a>
          </>
        )}
        <div className="sidebar-foot">
          v{platform.version} · {isWeb ? 'Web demo' : 'Desktop'} · offline
        </div>
      </nav>

      <div className="topbar">
        <a href={routePath('home')} style={{ textDecoration: 'none', color: 'inherit' }}>
          <BrandWordmark size={24} />
        </a>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setNavOpen((o) => !o)}
          aria-label="Toggle navigation"
          aria-expanded={navOpen}
        >
          <Menu size={18} />
        </button>
      </div>
      <nav className="topbar-nav" aria-label="Primary mobile">
        {nav([...APP_NAV, ...INFO_NAV])}
      </nav>

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
