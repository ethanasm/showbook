import Image from 'next/image';
import { signIn } from '@/auth';
import { StackedCards } from '@/components/design-system';
import { child } from '@showbook/observability';
import './signin.css';

const log = child({ component: 'web.signin' });

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const accessDenied = error === 'AccessDenied';
  const year = new Date().getFullYear();

  if (accessDenied) {
    // NextAuth redirects allowlist-rejected users here. The URL is user-craftable
    // so a fake denial is possible — acceptable noise for a side project.
    log.warn({ event: 'auth.denied' }, 'Sign-in denied by allowlist');
  }

  return (
    <main className="signin">
      <aside className="signin__stage" aria-hidden="true">
        <div className="glow-backdrop" />

        <div className="signin__marquee">
          <span className="pulse-dot" />
          <span>Now playing · Your shows</span>
        </div>

        <div className="signin__stack">
          <StackedCards />
        </div>

        <div className="signin__stage-caption">
          <span>Track · Discover · Remember</span>
          <span>Est. {year}</span>
        </div>
      </aside>

      <section className="signin__panel">
        <div className="signin__brand">
          <span className="brand-mark">S</span>
          <span>Showbook</span>
        </div>

        <div className="signin__hero">
          <span className="eyebrow">Personal Live-Show Tracker</span>
          <h1 className="signin__title">
            Every show, <em className="gradient-emphasis">worth&nbsp;remembering.</em>
          </h1>
          <p className="signin__subtitle">
            A private logbook for the concerts, plays, sets, and festivals you&apos;ve seen — and the ones still ahead.
          </p>

          <ul className="signin__kinds">
            <li className="kind-chip kind-chip--concert">
              <span className="kind-chip__dot" />
              Concerts
            </li>
            <li className="kind-chip kind-chip--theatre">
              <span className="kind-chip__dot" />
              Theatre
            </li>
            <li className="kind-chip kind-chip--comedy">
              <span className="kind-chip__dot" />
              Comedy
            </li>
            <li className="kind-chip kind-chip--festival">
              <span className="kind-chip__dot" />
              Festivals
            </li>
          </ul>

          <div className="signin__cta">
            {accessDenied ? (
              <div className="signin__error" role="alert">
                This Google account isn&apos;t on the allowlist. If you think it should be, reach out to the owner.
              </div>
            ) : null}
            <form action={async () => {
              'use server';
              await signIn('google', { redirectTo: '/home' });
            }}>
              <button type="submit" className="gsi-button" aria-label="Sign in with Google">
                <span className="gsi-button__icon">
                  <Image src="/google-g.svg" alt="" width={16} height={16} priority />
                </span>
                Sign in with Google
              </button>
            </form>

            <p className="signin__legal">
              By continuing you agree to keep things tasteful. We only read your basic Google profile.
            </p>
          </div>
        </div>

        <div className="signin__footer">
          <span>Showbook</span>
          <span>v1 · {year}</span>
        </div>
      </section>
    </main>
  );
}
