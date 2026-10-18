import { useCallback, useEffect, useState, type ReactNode } from 'react';

export type RouteId =
  | 'landing'
  | 'home'
  | 'encrypt'
  | 'decrypt'
  | 'how-it-works'
  | 'security'
  | 'about';

const PATH_TO_ROUTE: Record<string, RouteId> = {
  '/': 'landing',
  '/app': 'encrypt',
  '/app/home': 'home',
  '/app/encrypt': 'encrypt',
  '/app/decrypt': 'decrypt',
  '/app/how-it-works': 'how-it-works',
  '/app/security': 'security',
  '/app/about': 'about',
};

const ROUTE_TO_PATH: Record<RouteId, string> = {
  landing: '/',
  home: '/app/home',
  encrypt: '/app/encrypt',
  decrypt: '/app/decrypt',
  'how-it-works': '/app/how-it-works',
  security: '/app/security',
  about: '/app/about',
};

function currentPath(): string {
  const h = window.location.hash.replace(/^#/, '');
  return h === '' ? '/' : h;
}

export function useRoute(): { route: RouteId; navigate: (r: RouteId) => void } {
  const [path, setPath] = useState(currentPath);
  useEffect(() => {
    const onHash = () => {
      setPath(currentPath());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const navigate = useCallback((r: RouteId) => {
    window.location.hash = `#${ROUTE_TO_PATH[r]}`;
  }, []);
  const route = PATH_TO_ROUTE[path] ?? 'landing';
  return { route, navigate };
}

export function routePath(r: RouteId): string {
  return `#${ROUTE_TO_PATH[r]}`;
}

export function Link(props: {
  to: RouteId;
  className?: string;
  children: ReactNode;
  onClick?: () => void;
  'aria-label'?: string;
}) {
  return (
    <a href={routePath(props.to)} className={props.className} onClick={props.onClick} aria-label={props['aria-label']}>
      {props.children}
    </a>
  );
}
