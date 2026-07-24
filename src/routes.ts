// Hash-based routing: #/ (editor) · #/admin · #/libreria · #/play/:id
// Hash routing keeps shared links working on any static host without
// server-side rewrites.
import { useEffect, useState } from 'react';

export type Route = { page: 'editor' } | { page: 'admin' } | { page: 'library' } | { page: 'play'; id: string };

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'admin') return { page: 'admin' };
  if (parts[0] === 'libreria' || parts[0] === 'library') return { page: 'library' };
  if (parts[0] === 'play' && parts[1]) return { page: 'play', id: parts[1] };
  return { page: 'editor' };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(location.hash));
  useEffect(() => {
    const onHash = () => setRoute(parseHash(location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return route;
}
