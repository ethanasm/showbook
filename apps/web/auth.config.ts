import type { NextAuthConfig } from 'next-auth';
import Google from 'next-auth/providers/google';
import {
  isEmailAllowed,
  readAllowlistFromEnv,
  shouldAllowSignIn,
} from './lib/auth-allowlist';

export const authConfig = {
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  pages: {
    signIn: '/signin',
    // Without this, NextAuth's catch-all error handler renders its own
    // unstyled `/api/auth/error` page (and its "Sign in" link points back
    // into `/api/auth/*`, looping). Routing to `/signin` keeps the user
    // on our themed page, which renders an error banner from `?error=`.
    error: '/signin',
  },
  session: { strategy: 'jwt' },
  callbacks: {
    signIn({ user, profile }) {
      // Edge-safe: reads env + pure string ops only. Both lists empty = open mode.
      // Denial surface: NextAuth redirects to /signin?error=AccessDenied.
      return shouldAllowSignIn({
        email: user.email,
        emailVerified:
          typeof profile?.email_verified === 'boolean'
            ? profile.email_verified
            : undefined,
        ...readAllowlistFromEnv(),
      });
    },
    jwt({ token, user }) {
      if (user) token.id = user.id;
      // Re-check the allowlist on every JWT decode. JWT sessions live for
      // 30 days (NextAuth default), so without this an email removed from
      // AUTH_ALLOWED_* would keep working until the token expired.
      // Returning null tells NextAuth to drop the session cookie.
      const email = typeof token.email === 'string' ? token.email : null;
      if (!isEmailAllowed(email, readAllowlistFromEnv())) {
        return null;
      }
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
