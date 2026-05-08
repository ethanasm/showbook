import { cache } from 'react';
import { eq } from 'drizzle-orm';
import NextAuth from 'next-auth';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { db, users, accounts, sessions, verificationTokens } from '@showbook/db';
import { child } from '@showbook/observability';
import { authConfig } from './auth.config';

const log = child({ component: 'web.auth' });

export const { handlers, signIn, signOut, auth: authUncached } = NextAuth({
  ...authConfig,
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  callbacks: {
    ...authConfig.callbacks,
    async jwt(params) {
      const token = await authConfig.callbacks!.jwt!(params);
      if (!token) return token;
      // Drop the session if the user row has been deleted out from under
      // a still-valid JWT (e.g. wiped during dev). Without this the cookie
      // keeps the user "signed in" but every tRPC call 401s.
      const userId = typeof token.id === 'string' ? token.id : null;
      if (userId) {
        const [row] = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);
        if (!row) return null;
      }
      return token;
    },
  },
  events: {
    signIn({ user, isNewUser }) {
      log.info({ event: 'auth.signin', userId: user.id, isNewUser }, 'User signed in');
    },
    signOut(message) {
      const userId = 'token' in message ? message.token?.id : undefined;
      log.info({ event: 'auth.signout', userId }, 'User signed out');
    },
    createUser({ user }) {
      log.info({ event: 'auth.user_created', userId: user.id }, 'New user created');
    },
  },
});

// Per-request memoized session lookup. Multiple `auth()` calls within a single
// server request (layout + page + tRPC route) reuse the same result instead
// of re-decoding the JWT and re-touching the session table on every nav.
export const auth = cache(authUncached);
