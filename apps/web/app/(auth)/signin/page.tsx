import Image from 'next/image';
import { signIn } from '@/auth';
import './signin.css';

export default function SignInPage() {
  const year = new Date().getFullYear();

  return (
    <main className="signin">
      <aside className="signin__stage" aria-hidden="true">
        <div className="signin__grid" />

        <div className="signin__marquee">
          <span className="signin__marquee-dot" />
          <span>Now playing · Your shows</span>
        </div>

        <div className="signin__stack">
          <div className="signin__card">
            <span className="signin__card-bar signin__card-bar--concert" />
            <div className="signin__card-date">
              <strong>14</strong>
              MAY
            </div>
            <div>
              <div className="signin__card-title">Phoebe Bridgers</div>
              <div className="signin__card-venue">Forest Hills Stadium · Queens</div>
            </div>
            <span className="signin__card-chip signin__card-chip--ticketed">Ticketed</span>
          </div>

          <div className="signin__card">
            <span className="signin__card-bar signin__card-bar--theatre" />
            <div className="signin__card-date">
              <strong>02</strong>
              JUN
            </div>
            <div>
              <div className="signin__card-title">Hamlet</div>
              <div className="signin__card-venue">Royal Shakespeare · Stratford</div>
            </div>
            <span className="signin__card-chip signin__card-chip--watching">Watching</span>
          </div>

          <div className="signin__card">
            <span className="signin__card-bar signin__card-bar--comedy" />
            <div className="signin__card-date">
              <strong>21</strong>
              MAR
            </div>
            <div>
              <div className="signin__card-title">John Mulaney · From Scratch</div>
              <div className="signin__card-venue">Beacon Theatre · NYC</div>
            </div>
            <span className="signin__card-chip signin__card-chip--seen">Seen</span>
          </div>

          <div className="signin__card">
            <span className="signin__card-bar signin__card-bar--festival" />
            <div className="signin__card-date">
              <strong>11</strong>
              JUL
            </div>
            <div>
              <div className="signin__card-title">Pitchfork Music Festival</div>
              <div className="signin__card-venue">Union Park · Chicago</div>
            </div>
            <span className="signin__card-chip signin__card-chip--watching">Watching</span>
          </div>
        </div>

        <div className="signin__stage-caption">
          <span>Track · Discover · Remember</span>
          <span>Est. {year}</span>
        </div>
      </aside>

      <section className="signin__panel">
        <div className="signin__brand">
          <span className="signin__brand-mark">S</span>
          <span>Showbook</span>
        </div>

        <div className="signin__hero">
          <span className="signin__eyebrow">Personal Live-Show Tracker</span>
          <h1 className="signin__title">
            Every show, <em>worth&nbsp;remembering.</em>
          </h1>
          <p className="signin__subtitle">
            A private logbook for the concerts, plays, sets, and festivals you&apos;ve seen — and the ones still ahead.
          </p>

          <ul className="signin__kinds">
            <li className="signin__kind">
              <span className="signin__kind-dot" style={{ background: 'var(--kind-concert)' }} />
              Concerts
            </li>
            <li className="signin__kind">
              <span className="signin__kind-dot" style={{ background: 'var(--kind-theatre)' }} />
              Theatre
            </li>
            <li className="signin__kind">
              <span className="signin__kind-dot" style={{ background: 'var(--kind-comedy)' }} />
              Comedy
            </li>
            <li className="signin__kind">
              <span className="signin__kind-dot" style={{ background: 'var(--kind-festival)' }} />
              Festivals
            </li>
          </ul>

          <div className="signin__cta">
            <form action={async () => {
              'use server';
              await signIn('google', { redirectTo: '/home' });
            }}>
              <button type="submit" className="gsi-button" aria-label="Sign in with Google">
                <span className="gsi-button__icon">
                  <Image src="/google-g.svg" alt="" width={18} height={18} priority />
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
