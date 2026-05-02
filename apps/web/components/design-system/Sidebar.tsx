"use client";

import "./design-system.css";
import {
  Home,
  Eye,
  Archive,
  Map,
  MapPin,
  Music,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  MoreHorizontal,
  LogOut,
} from "lucide-react";
import { type ComponentType, useEffect, useRef, useState } from "react";
import { signOut } from "next-auth/react";

export interface NavItem {
  id: string;
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  count?: number;
  section: "navigate" | "settings";
  /** smaller font for settings items */
  small?: boolean;
  /** Only render when the caller passes `isAdmin` to <Sidebar>. */
  adminOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { id: "home", label: "Home", icon: Home, section: "navigate" },
  { id: "discover", label: "Discover", icon: Eye, section: "navigate" },
  { id: "map", label: "Map", icon: Map, section: "navigate" },
  { id: "shows", label: "Shows", icon: Archive, section: "navigate" },
  { id: "venues", label: "Venues", icon: MapPin, section: "navigate" },
  { id: "artists", label: "Artists", icon: Music, section: "navigate" },
  { id: "preferences", label: "Preferences", icon: Settings, section: "settings", small: true },
  { id: "admin", label: "Admin", icon: ShieldCheck, section: "settings", small: true, adminOnly: true },
];

/** Items shown in mobile bottom tab bar */
export const BOTTOM_NAV_ITEMS = [
  { id: "home", label: "Home", icon: Home },
  { id: "shows", label: "Shows", icon: Archive },
  { id: "add", label: "Add", icon: Plus, isAddButton: true },
  { id: "map", label: "Map", icon: Map },
  { id: "preferences", label: "Me", icon: Settings },
] as const;

interface SidebarProps {
  active?: string;
  onNavigate?: (id: string) => void;
  onSearchClick?: () => void;
  counts?: Partial<Record<string, number>>;
  userName?: string;
  userInitials?: string;
  syncStatus?: string;
  /** When false (or undefined), items flagged `adminOnly` are hidden. */
  isAdmin?: boolean;
}

export function Sidebar({
  active = "home",
  onNavigate,
  onSearchClick,
  counts,
  userName,
  userInitials,
  syncStatus = "signed in",
  isAdmin = false,
}: SidebarProps) {
  const displayName = userName ?? "…";
  const displayInitials = userInitials ?? "·";
  const visibleItems = NAV_ITEMS.filter((i) => !i.adminOnly || isAdmin);
  const navItems = visibleItems.filter((i) => i.section === "navigate");
  const settingsItems = visibleItems.filter((i) => i.section === "settings");

  function getCount(item: NavItem): number | undefined {
    if (counts && item.id in counts) return counts[item.id];
    return item.count;
  }

  return (
    <aside className="sidebar">
      {/* Logo */}
      <div className="sidebar__header">
        <button
          className="sidebar__logo"
          type="button"
          onClick={() => onNavigate?.("home")}
        >
          showbook
        </button>
        <span className="sidebar__version">v2 &middot; 2026.04</span>
      </div>

      {/* Add a show button */}
      <div className="sidebar__add-section">
        <button
          className="sidebar__add-btn"
          onClick={() => onNavigate?.("add")}
          type="button"
        >
          <Plus size={14} strokeWidth={2.5} />
          <span>Add a show</span>
        </button>
      </div>

      {/* Search box */}
      <div className="sidebar__search-section">
        <button className="sidebar__search" type="button" onClick={onSearchClick}>
          <Search size={13} className="sidebar__search-icon" />
          <span className="sidebar__search-text">search...</span>
          <kbd className="sidebar__search-kbd">&thinsp;&#8984;K&thinsp;</kbd>
        </button>
      </div>

      {/* Navigate section */}
      <div className="sidebar__section-label">Navigate</div>
      <nav className="sidebar__nav">
        {navItems.map((item) => {
          const isActive = active === item.id;
          const count = getCount(item);
          return (
            <button
              key={item.id}
              className={`sidebar__item ${isActive ? "sidebar__item--active" : ""}`}
              onClick={() => onNavigate?.(item.id)}
              type="button"
            >
              <span className="sidebar__icon">
                <item.icon size={15} />
              </span>
              <span className="sidebar__label">{item.label}</span>
              {count !== undefined && (
                <span className="sidebar__count">{count}</span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Settings section */}
      <div className="sidebar__section-label">Settings</div>
      <nav className="sidebar__nav">
        {settingsItems.map((item) => {
          const isActive = active === item.id;
          return (
            <button
              key={item.id}
              className={`sidebar__item ${isActive ? "sidebar__item--active" : ""} ${item.small ? "sidebar__item--small" : ""}`}
              onClick={() => onNavigate?.(item.id)}
              type="button"
            >
              <span className="sidebar__icon">
                <item.icon size={15} />
              </span>
              <span className="sidebar__label">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Spacer pushes user profile to bottom */}
      <div className="sidebar__spacer" />

      {/* User profile */}
      <UserMenu
        userInitials={displayInitials}
        userName={displayName}
        syncStatus={syncStatus}
        onNavigate={onNavigate}
      />
    </aside>
  );
}

function UserMenu({
  userInitials,
  userName,
  syncStatus,
  onNavigate,
}: {
  userInitials: string;
  userName: string;
  syncStatus: string;
  onNavigate?: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className="sidebar__user" ref={menuRef}>
      <div className="sidebar__user-avatar">{userInitials}</div>
      <div className="sidebar__user-info">
        <button
          className="sidebar__user-name"
          type="button"
          onClick={() => onNavigate?.("preferences")}
        >
          {userName}
        </button>
        <div className="sidebar__user-sync">{syncStatus}</div>
      </div>
      <button
        className="sidebar__user-more"
        type="button"
        aria-label="More options"
        onClick={() => setOpen(!open)}
      >
        <MoreHorizontal size={14} />
      </button>
      {open && (
        <div className="sidebar__user-menu">
          <button
            className="sidebar__user-menu-item"
            type="button"
            onClick={() => signOut({ callbackUrl: "/signin" })}
          >
            <LogOut size={13} />
            <span>Sign out</span>
          </button>
        </div>
      )}
    </div>
  );
}
