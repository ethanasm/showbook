import Link from "next/link";

/**
 * Tiny three-link footer used across:
 *  - the public `(public)` route group (privacy, terms)
 *  - the `(auth)/signin` page
 *  - desktop breakpoints inside the authed `AppShell`
 *
 * Mobile inside the authed shell relies on the bottom nav for chrome;
 * the footer is `display: none` under the breakpoint so it doesn't
 * stack on top of the bottom nav.
 */
export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="site-footer">
      <span className="site-footer__brand">Showbook</span>
      <nav className="site-footer__links" aria-label="Site footer">
        <Link href="/privacy" className="site-footer__link">
          Privacy
        </Link>
        <span aria-hidden="true">·</span>
        <Link href="/terms" className="site-footer__link">
          Terms
        </Link>
      </nav>
      <span className="site-footer__year">v1 · {year}</span>
    </footer>
  );
}
