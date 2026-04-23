"use client";

import { usePathname, useRouter } from "next/navigation";
import { Sidebar, NAV_ITEMS } from "@/components/design-system/Sidebar";
import { ThemeProvider } from "@/components/design-system/ThemeProvider";
import type { ReactNode } from "react";

function pathnameToNavId(pathname: string): string {
  // pathname is e.g. "/home", "/discover", "/shows/123"
  const segment = pathname.split("/")[1] ?? "home";
  // Check if the segment matches any nav item id
  const match = NAV_ITEMS.find((item) => item.id === segment);
  return match ? match.id : "home";
}

function navIdToPath(id: string): string {
  return `/${id}`;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const activeId = pathnameToNavId(pathname);

  const handleNavigate = (id: string) => {
    router.push(navIdToPath(id));
  };

  return (
    <ThemeProvider>
      <div className="app-shell">
        <div className="app-shell__sidebar">
          <Sidebar active={activeId} onNavigate={handleNavigate} />
        </div>
        <main className="app-shell__content">{children}</main>
        <nav className="app-shell__bottom-bar">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`bottom-bar__item ${
                activeId === item.id ? "bottom-bar__item--active" : ""
              }`}
              onClick={() => handleNavigate(item.id)}
              type="button"
            >
              <span className="bottom-bar__icon">
                <item.icon />
              </span>
              <span className="bottom-bar__label">{item.label}</span>
            </button>
          ))}
        </nav>
      </div>
    </ThemeProvider>
  );
}
