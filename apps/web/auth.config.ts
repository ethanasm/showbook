import type { NextAuthConfig } from 'next-auth';
import Google from 'next-auth/providers/google';
import { isEmailAllowed, parseAllowlist } from './lib/auth-allowlist';

export const authConfig = {
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  pages: {
    signIn: '/signin',
  },
  session: { strategy: 'jwt' },
  callbacks: {
    signIn({ user }) {
      // Edge-safe: reads env + pure string ops only. Both lists empty = open mode.
      // Denial surface: NextAuth redirects to /signin?error=AccessDenied.
      return isEmailAllowed(user.email, {
        emails: parseAllowlist(process.env.AUTH_ALLOWED_EMAILS),
        domains: parseAllowlist(process.env.AUTH_ALLOWED_DOMAINS),
      });
    },
    jwt({ token, user }) {
      if (user) token.id = user.id;
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
  trustHost: true,
} satisfies NextAuthConfig;
