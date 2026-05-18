import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { Space_Grotesk, IBM_Plex_Mono } from "next/font/google";
import { SessionProvider } from "next-auth/react";
import { Toaster } from "sonner";
import { TRPCProvider } from "@/lib/trpc";
import { NavigationProgress } from "@/components/NavigationProgress";
import "./globals.css";

// Font swap (2026-05-16 redesign). The CSS variables keep their original
// names (`--font-geist-sans` / `--font-geist-mono`) so every inline-style
// reference across the app keeps working with value-only changes — see
// `specs/setlist-intelligence/show-page-redesign-2026-05-16.md`.
const sansFont = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-geist-sans",
  display: "swap",
});
const monoFont = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-geist-mono",
  display: "swap",
});

const SITE_DESCRIPTION =
  "Personal tracker for concerts, theatre, comedy & festivals — with setlist predictions, Gmail ticket import, and Spotify playlist generation.";

export const metadata: Metadata = {
  title: "Showbook",
  description: SITE_DESCRIPTION,
  // Discord / Slack / Twitter link unfurls. The /og.svg file is a
  // static 1200×630 vector served from /public so the asset stays
  // sharp at every preview scale and doesn't require a build-time
  // render hop. SVG is widely accepted by social unfurlers in 2026;
  // if a specific platform rejects it, replace with a PNG export.
  openGraph: {
    title: "Showbook",
    description: SITE_DESCRIPTION,
    type: "website",
    siteName: "Showbook",
    images: [
      {
        url: "/og.svg",
        width: 1200,
        height: 630,
        alt: "Showbook — track every show you've seen and every show you're going to.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Showbook",
    description: SITE_DESCRIPTION,
    images: ["/og.svg"],
  },
};

// Lock the viewport explicitly. iOS Safari renders pages at ~980 CSS-px
// when the viewport meta is missing or ambiguous, which trips every
// `max-width: 899px` breakpoint into desktop mode on a phone. Next.js
// supplies a default, but we declare ours so behavior never depends on
// the framework's defaults.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${sansFont.variable} ${monoFont.variable}`}>
      <body style={{ fontFamily: "var(--font-geist-sans), sans-serif" }}>
        <Suspense fallback={null}>
          <NavigationProgress />
        </Suspense>
        <SessionProvider>
          <TRPCProvider>
            {children}
          </TRPCProvider>
        </SessionProvider>
        <Toaster
          position="bottom-right"
          theme="dark"
          richColors={false}
          closeButton
          toastOptions={{
            style: {
              background: "var(--surface)",
              color: "var(--ink)",
              border: "1px solid var(--rule-strong)",
              borderRadius: 0,
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: 13,
              letterSpacing: -0.1,
            },
          }}
        />
      </body>
    </html>
  );
}
