"use client";

import { usePathname, useRouter } from "next/navigation";
import { Sidebar, NAV_ITEMS, BOTTOM_NAV_ITEMS } from "@/components/design-system/Sidebar";
import { ThemeProvider } from "@/components/design-system/ThemeProvider";
import { PrefsServerSync } from "@/components/PrefsServerSync";
import { GlobalSearch, openGlobalSearch } from "@/components/GlobalSearch";
import { trpc } from "@/lib/trpc";
import { useSession } from "next-auth/react";
import type { ReactNode } from "react";

function pathnameToNavId(pathname: string): string {
  const segment = pathname.split("/")[1] ?? "home";
  if (NAV_ITEMS.some((item) => item.id === segment)) return segment;
  if (BOTTOM_NAV_ITEMS.some((item) => item.id === segment)) return segment;
  return "";
}

function navIdToPath(id: string): string {
  return `/${id}`;
}

function deriveInitials(name: string | null | undefined, email: string | null | undefined): string {
  const source = (name ?? email ?? "").trim();
  if (!source) return "?";
  const parts = source.split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const activeId = pathnameToNavId(pathname);
  const { data: session } = useSession();

  // Use lightweight count procedures rather than `*.list().length` —
  // otherwise every page render fetches the full show/performer/venue list
  // (potentially thousands of rows with relations) just to read its length.
  const showsCountsQuery = trpc.shows.countsByMode.useQuery(undefined, { staleTime: 60_000 });
  const performersCountQuery = trpc.performers.count.useQuery(undefined, { staleTime: 60_000 });
  const venuesCountQuery = trpc.venues.count.useQuery(undefined, { staleTime: 60_000 });
  // `amIAdmin` is server-derived from the user's email + ADMIN_EMAILS allowlist.
  // Stale-time of 5 min keeps the sidebar quiet; the `/admin` page still does
  // its own server-side check on every navigation, so this is UX, not auth.
  const amIAdminQuery = trpc.admin.amIAdmin.useQuery(undefined, { staleTime: 5 * 60_000 });
  const isAdmin = amIAdminQuery.data?.isAdmin ?? false;

  const counts: Partial<Record<string, number>> = {};
  if (showsCountsQuery.data !== undefined) {
    counts.upcoming = showsCountsQuery.data.upcoming;
    counts.logbook = showsCountsQuery.data.logbook;
  }
  if (performersCountQuery.data !== undefined) counts.artists = performersCountQuery.data;
  if (venuesCountQuery.data !== undefined) counts.venues = venuesCountQuery.data;

  const sessionUser = session?.user;
  const userName = sessionUser?.name ?? sessionUser?.email ?? undefined;
  const userInitials = deriveInitials(sessionUser?.name, sessionUser?.email);

  const handleNavigate = (id: string) => {
    router.push(navIdToPath(id));
  };

  return (
    <ThemeProvider>
      <PrefsServerSync />
      <div className="app-shell">
        <div className="app-shell__sidebar">
          <Sidebar
            active={activeId}
            onNavigate={handleNavigate}
            onSearchClick={openGlobalSearch}
            counts={counts}
            userName={userName}
            userInitials={userInitials}
            isAdmin={isAdmin}
          />
        </div>
        <main className="app-shell__content">
          <GlobalSearch />
          {children}
        </main>
        <nav className="app-shell__bottom-bar">
          {BOTTOM_NAV_ITEMS.map((item) => {
            const isActive = activeId === item.id;
            const isAdd = "isAddButton" in item && item.isAddButton;
            return (
              <button
                key={item.id}
                className={`bottom-bar__item ${isAdd ? "bottom-bar__item--add" : ""} ${isActive && !isAdd ? "bottom-bar__item--active" : ""}`}
                onClick={() => handleNavigate(item.id)}
                type="button"
                aria-label={isAdd ? "Add a show" : undefined}
              >
                {isAdd ? (
                  <span className="bottom-bar__add-circle">
                    <item.icon size={20} strokeWidth={2.5} />
                  </span>
                ) : (
                  <span className="bottom-bar__icon">
                    <item.icon size={18} />
                  </span>
                )}
                <span className="bottom-bar__label">{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </ThemeProvider>
  );
}
