"use client";

import { usePathname, useRouter } from "next/navigation";
import { Sidebar, NAV_ITEMS, BOTTOM_NAV_ITEMS } from "@/components/design-system/Sidebar";
import { ThemeProvider } from "@/components/design-system/ThemeProvider";
import { GlobalSearch, openGlobalSearch } from "@/components/GlobalSearch";
import { trpc } from "@/lib/trpc";
import type { ReactNode } from "react";

function pathnameToNavId(pathname: string): string {
  const segment = pathname.split("/")[1] ?? "home";
  const match = NAV_ITEMS.find((item) => item.id === segment);
  return match ? match.id : "";
}

function navIdToPath(id: string): string {
  return `/${id}`;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const activeId = pathnameToNavId(pathname);

  const showsQuery = trpc.shows.list.useQuery({}, { select: (d) => d.length });
  const performersQuery = trpc.performers.list.useQuery(undefined, { select: (d) => d.length });
  const venuesQuery = trpc.venues.list.useQuery(undefined, { select: (d) => d.length });

  const counts: Partial<Record<string, number>> = {};
  if (showsQuery.data !== undefined) counts.shows = showsQuery.data;
  if (performersQuery.data !== undefined) counts.artists = performersQuery.data;
  if (venuesQuery.data !== undefined) counts.venues = venuesQuery.data;

  const handleNavigate = (id: string) => {
    router.push(navIdToPath(id));
  };

  return (
    <ThemeProvider>
      <div className="app-shell">
        <div className="app-shell__sidebar">
          <Sidebar active={activeId} onNavigate={handleNavigate} onSearchClick={openGlobalSearch} counts={counts} />
        </div>
        <main className="app-shell__content">
          <GlobalSearch />
          {children}
        </main>
        <nav className="app-shell__bottom-bar">
          {BOTTOM_NAV_ITEMS.map((item) => {
            const isActive = activeId === item.id;
            if ("isAddButton" in item && item.isAddButton) {
              return (
                <button
                  key={item.id}
                  className="bottom-bar__item bottom-bar__item--add"
                  onClick={() => handleNavigate(item.id)}
                  type="button"
                  aria-label="Add a show"
                >
                  <span className="bottom-bar__add-circle">
                    <item.icon size={20} strokeWidth={2.5} />
                  </span>
                  <span className="bottom-bar__label">{item.label}</span>
                </button>
              );
            }
            return (
              <button
                key={item.id}
                className={`bottom-bar__item ${isActive ? "bottom-bar__item--active" : ""}`}
                onClick={() => handleNavigate(item.id)}
                type="button"
              >
                <span className="bottom-bar__icon">
                  <item.icon size={18} />
                </span>
                <span className="bottom-bar__label">{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </ThemeProvider>
  );
}
