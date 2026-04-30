import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { db, users, accounts, sessions, verificationTokens } from '@showbook/db';
import { child } from '@showbook/observability';

const log = child({ component: 'web.auth' });

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
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
  trustHost: true,
});
