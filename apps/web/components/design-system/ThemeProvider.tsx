"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

type Theme = "dark" | "light" | "system";

interface ThemeContextValue {
  theme: Theme;
  resolved: "dark" | "light";
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const DARK_VARS: Record<string, string> = {
  "--bg": "#0C0C0C",
  "--surface": "#1A1A1A",
  "--surface-raised": "#242424",
  "--border": "#2E2E2E",
  "--text-primary": "#FAFAF8",
  "--text-secondary": "#A0A0A0",
  "--marquee-gold": "#FFD166",
  "--kind-concert": "#3A86FF",
  "--kind-theatre": "#E63946",
  "--kind-comedy": "#9D4EDD",
  "--kind-festival": "#2A9D8F",
};

const LIGHT_VARS: Record<string, string> = {
  "--bg": "#FAFAF8",
  "--surface": "#FFFFFF",
  "--surface-raised": "#F5F5F3",
  "--border": "#E5E5E3",
  "--text-primary": "#0C0C0C",
  "--text-secondary": "#6B6B6B",
  "--marquee-gold": "#E5A800",
  "--kind-concert": "#2E6FD9",
  "--kind-theatre": "#D42F3A",
  "--kind-comedy": "#8340C4",
  "--kind-festival": "#238577",
};

const STORAGE_KEY = "showbook-theme";

function applyVars(resolved: "dark" | "light") {
  const vars = resolved === "dark" ? DARK_VARS : LIGHT_VARS;
  const root = document.documentElement;
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
  }
}

function getSystemPreference(): "dark" | "light" {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function resolve(theme: Theme): "dark" | "light" {
  if (theme === "system") return getSystemPreference();
  return theme;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark");
  const [resolved, setResolved] = useState<"dark" | "light">("dark");

  // Initialize from localStorage
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
    const initial = stored ?? "dark";
    setThemeState(initial);
    const r = resolve(initial);
    setResolved(r);
    applyVars(r);
  }, []);

  // Listen for system preference changes when theme is "system"
  useEffect(() => {
    if (theme !== "system") return;

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const r = resolve("system");
      setResolved(r);
      applyVars(r);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    localStorage.setItem(STORAGE_KEY, t);
    const r = resolve(t);
    setResolved(r);
    applyVars(r);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, resolved, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return ctx;
}
