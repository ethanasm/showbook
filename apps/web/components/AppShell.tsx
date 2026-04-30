"use client";

import { usePathname, useRouter } from "next/navigation";
import { Sidebar, NAV_ITEMS, BOTTOM_NAV_ITEMS } from "@/components/design-system/Sidebar";
import { ThemeProvider } from "@/components/design-system/ThemeProvider";
import { PrefsServerSync } from "@/components/PrefsServerSync";
import { GlobalSearch, openGlobalSearch } from "@/components/GlobalSearch";
import { trpc } from "@/lib/trpc";
import { useSession } from "next-auth/react";
import { type ReactNode, useState, useRef, useEffect } from "react";
import { Plus, Search, Map, MapPin, Music, Eye } from "lucide-react";

const ADD_MENU_ITEMS = [
  { id: "add", label: "Add a show", Icon: Plus },
  { id: "discover", label: "Discover", Icon: Eye },
  { id: "venues", label: "Venues", Icon: MapPin },
  { id: "artists", label: "Artists", Icon: Music },
  { id: "map", label: "Map", Icon: Map },
] as const;

function pathnameToNavId(pathname: string): string {
  const segment = pathname.split("/")[1] ?? "home";
  const match = NAV_ITEMS.find((item) => item.id === segment);
  return match ? match.id : "";
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
  const showsCountQuery = trpc.shows.count.useQuery(undefined, { staleTime: 60_000 });
  const performersCountQuery = trpc.performers.count.useQuery(undefined, { staleTime: 60_000 });
  const venuesCountQuery = trpc.venues.count.useQuery(undefined, { staleTime: 60_000 });

  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!addMenuOpen) return;
    function handleClick(e: MouseEvent) {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setAddMenuOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setAddMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [addMenuOpen]);

  const counts: Partial<Record<string, number>> = {};
  if (showsCountQuery.data !== undefined) counts.shows = showsCountQuery.data;
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
          />
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
                <div key={item.id} className="bottom-bar__add-wrapper" ref={addMenuRef}>
                  {addMenuOpen && (
                    <div className="bottom-bar__add-popover" role="menu">
                      {ADD_MENU_ITEMS.map(({ label, id, Icon }) => (
                        <button
                          key={id}
                          className="bottom-bar__add-popover-item"
                          type="button"
                          role="menuitem"
                          onClick={() => { setAddMenuOpen(false); handleNavigate(id); }}
                        >
                          <Icon size={14} />
                          <span>{label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <button
                    className="bottom-bar__item bottom-bar__item--add"
                    onClick={() => setAddMenuOpen((o) => !o)}
                    type="button"
                    aria-label="Add"
                    aria-expanded={addMenuOpen}
                    aria-haspopup="menu"
                  >
                    <span className="bottom-bar__add-circle">
                      <item.icon size={20} strokeWidth={2.5} />
                    </span>
                    <span className="bottom-bar__label">{item.label}</span>
                  </button>
                </div>
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
