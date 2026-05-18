import Link from "next/link";
import type { ReactNode } from "react";
import { SiteFooter } from "@/components/SiteFooter";

/**
 * Public-pages shell. Used by `/privacy` and `/terms`, both of which
 * must be reachable signed-out (footer link from `/signin`, list-
 * unsubscribe destinations from the daily digest, etc.). Mounts no
 * SessionProvider — these pages don't need auth context.
 *
 * Visual treatment intentionally mirrors `/signin`'s brand mark so a
 * user arriving from the email or footer feels they're on the same
 * surface.
 */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="public-shell">
      <header className="public-shell__header">
        <Link href="/" className="public-shell__brand" aria-label="Showbook home">
          <span className="brand-mark">S</span>
          <span>Showbook</span>
        </Link>
      </header>
      <main className="public-shell__main">{children}</main>
      <SiteFooter />
    </div>
  );
}
