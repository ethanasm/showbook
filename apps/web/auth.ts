import { cache } from 'react';
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
