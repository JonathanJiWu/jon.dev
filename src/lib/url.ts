/**
 * Prefix a site-relative path with the deploy base (e.g. "/jon.dev" on GitHub Pages
 * project sites, "" on a custom domain). Always use this for internal links.
 */
export function url(path = '/'): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}
