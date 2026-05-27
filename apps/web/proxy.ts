import NextAuth from 'next-auth';
import { authConfig } from './auth.config';

// Next 16 renamed the `middleware.ts` convention to `proxy.ts` and
// statically inspects the export — the destructured rename
// `export const { auth: proxy } = NextAuth(...)` isn't picked up, so
// we hoist the handler and re-export it explicitly.
const { auth } = NextAuth(authConfig);
export default auth;

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|icon.svg|favicon.ico|signin).*)'],
};
