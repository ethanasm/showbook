import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { SessionProvider } from "next-auth/react";
import { TRPCProvider } from "@/lib/trpc";
import { NavigationProgress } from "@/components/NavigationProgress";
import "./globals.css";

export const metadata: Metadata = {
  title: "Showbook",
  description: "Personal entertainment tracker for live shows",
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
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body style={{ fontFamily: "var(--font-geist-sans), sans-serif" }}>
        <Suspense fallback={null}>
          <NavigationProgress />
        </Suspense>
        <SessionProvider>
          <TRPCProvider>
            {children}
          </TRPCProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
