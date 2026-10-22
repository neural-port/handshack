import headerLogo from './assets/handshack-logo.png';
import { ErrorBoundary } from './components/error-boundary.js';
import { PlatformProvider, usePlatform, type PlatformServices } from './platform.js';
import { Link, routePath, useRoute, type RouteId } from './router.js';
import { LandingPage } from './pages/landing.js';
import { EncryptPage } from './pages/encrypt.js';
import { DecryptPage } from './pages/decrypt.js';
import { HowItWorksPage } from './pages/how-it-works.js';
import { SecurityPage } from './pages/security.js';
import { AboutPage } from './pages/about.js';

export function App({ services }: { services: PlatformServices }) {
  return (
    <ErrorBoundary>
      <PlatformProvider value={services}>
        <RoutedApp />
      </PlatformProvider>
    </ErrorBoundary>
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
  const isWeb = platform.platform === 'web';

  return (
    <div className="shell">
      <header className="topnav">
        <a href={routePath('encrypt')} className="topnav-brand">
          <img src={headerLogo} alt="HandShack — Encrypt. Split. Share. Rebuild." className="topnav-logo" />
        </a>

        <nav className="topnav-tabs" aria-label="Primary">
          <Link
            to="encrypt"
            className={`topnav-tab${route === 'encrypt' ? ' active' : ''}`}
            aria-label="Encrypt and split"
          >
            Encrypt &amp; split
          </Link>
          <Link
            to="decrypt"
            className={`topnav-tab${route === 'decrypt' ? ' active' : ''}`}
            aria-label="Restore a file"
          >
            Restore a file
          </Link>
        </nav>

        <div className="topnav-side">
          <Link to="security" className="topnav-link">Security</Link>
          <span className="topnav-badge">{isWeb ? 'Web' : 'Desktop'} · v{platform.version}</span>
        </div>
      </header>

      <main className="main">
        {route === 'encrypt' && <EncryptPage />}
        {route === 'decrypt' && <DecryptPage />}
        {route === 'how-it-works' && <HowItWorksPage />}
        {route === 'security' && <SecurityPage />}
        {route === 'about' && <AboutPage />}
      </main>
      <footer className="app-footer">
        <span>Files stay on this device. Passwords are never saved.</span>
        <nav aria-label="More information">
          <Link to="how-it-works">How it works</Link>
          <Link to="security">Security</Link>
          <Link to="about">About</Link>
        </nav>
      </footer>
    </div>
  );
}
