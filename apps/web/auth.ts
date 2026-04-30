import NextAuth from 'next-auth';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { db, users, accounts, sessions, verificationTokens } from '@showbook/db';
import { child } from '@showbook/observability';
import { authConfig } from './auth.config';

const log = child({ component: 'web.auth' });

export const { handlers, signIn, signOut, auth } = NextAuth({
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
