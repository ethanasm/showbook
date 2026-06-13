import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy · Showbook",
  description:
    "What Showbook collects, why, and how to access or delete your data.",
};

// DRAFT: review with counsel before public launch. Copy below is a
// reasonable consumer-app default in plain English; it covers the
// disclosures legally required for the third-party processors the app
// already integrates with (Google OAuth, Spotify, Ticketmaster,
// setlist.fm, Groq AI, Resend, Cloudflare, Axiom). Specifics that vary
// by deployment — operator contact, jurisdiction — are env-driven so
// the operator fills them in once at deploy time without editing TSX.
const CONTACT_EMAIL =
  process.env.LEGAL_CONTACT_EMAIL ?? "privacy@showbook.app";

export default function PrivacyPage() {
  return (
    <article className="legal-doc">
      <p className="legal-doc__updated">Last updated: 2026-05-18</p>
      <h1>Privacy policy</h1>
      <p>
        Showbook is a personal tracker for live shows. It only collects
        what it needs to keep your logbook working, never sells your
        data, and gives you tools to export or delete everything we
        store.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Account basics</strong> — your Google profile (name,
          email, avatar) from the OAuth sign-in. We don&apos;t store
          your Google password.
        </li>
        <li>
          <strong>Show data you create</strong> — the concerts, plays,
          comedy sets, and festivals you add (manually, via Gmail
          import, or via Spotify import), plus any notes, photos, and
          setlists you attach.
        </li>
        <li>
          <strong>Follows and preferences</strong> — venues and artists
          you follow, your region(s) for nearby-show discovery, theme
          settings, notification toggles.
        </li>
        <li>
          <strong>Integration tokens</strong> — when you connect
          Spotify, we store the OAuth tokens encrypted at rest
          (AES-256-GCM). When you sign in via Gmail import, we use the
          one-time access token and don&apos;t persist it.
        </li>
        <li>
          <strong>Operational logs</strong> — error and event logs (no
          email bodies, no auth tokens), kept for 30 days for
          troubleshooting.
        </li>
      </ul>

      <h2>Third-party processors</h2>
      <p>
        Showbook sends data to a handful of trusted services strictly to
        deliver features you&apos;ve enabled. Each is bound by its own
        privacy policy.
      </p>
      <ul>
        <li>
          <strong>Google (sign-in + Gmail import + Maps)</strong> —
          OAuth handshake for sign-in, scoped Gmail read access only
          when you trigger an import, and map tiles when you visit the
          Map tab.
        </li>
        <li>
          <strong>Groq (AI extraction)</strong> — when you run the
          Gmail importer, the matched email subject + body (first 8 KB)
          is sent to Groq&apos;s API to extract ticket details. The raw
          email content is not stored; only the structured result is.
          You consent to this each time you connect a new Gmail
          account.
        </li>
        <li>
          <strong>Spotify</strong> — playlist generation and listening
          history (when you import). Tokens are stored encrypted; you
          can revoke at any time from Preferences or Spotify settings.
        </li>
        <li>
          <strong>Ticketmaster Discovery API</strong> — discover
          upcoming shows for venues/artists you follow. We cache
          results to stay within their rate limits. Event data is
          attributed to Ticketmaster where displayed.
        </li>
        <li>
          <strong>setlist.fm</strong> — past setlists used to power
          predicted-setlist features. We display setlist.fm attribution
          where their data is shown.
        </li>
        <li>
          <strong>Resend (email)</strong> — sends the optional daily
          digest. Every digest includes a one-click unsubscribe.
        </li>
        <li>
          <strong>Cloudflare</strong> — fronts the app via Cloudflare
          Tunnel for HTTPS termination and DDoS protection.
        </li>
        <li>
          <strong>Axiom</strong> — operational log ingest. No PII or
          email content is shipped to Axiom; we log event names,
          identifiers, and counters.
        </li>
      </ul>

      <h2>Data retention</h2>
      <ul>
        <li>
          <strong>Your show data</strong> — kept until you delete it
          (per-show or whole-account).
        </li>
        <li>
          <strong>Backups</strong> — encrypted daily snapshots, retained
          for 30 days.
        </li>
        <li>
          <strong>Operational logs</strong> — 30 days.
        </li>
        <li>
          <strong>Completed background jobs</strong> — archived for 24
          h, deleted after 7 days.
        </li>
      </ul>

      <h2>Your rights</h2>
      <p>
        You can exercise the following from your{" "}
        <a href="/preferences">Preferences page</a>:
      </p>
      <ul>
        <li>
          <strong>Access / portability</strong> — download a complete
          JSON export of everything tied to your account
          (&quot;Download your data&quot;).
        </li>
        <li>
          <strong>Deletion</strong> — &quot;Danger zone → Delete
          account&quot; permanently erases every show, follow, media
          tag, and integration we hold.
        </li>
        <li>
          <strong>Email opt-out</strong> — the daily digest toggle
          plus a one-click unsubscribe link in every email.
        </li>
        <li>
          <strong>Integration revoke</strong> — disconnect Spotify /
          Gmail any time from Preferences.
        </li>
      </ul>
      <p>
        EU/UK users may additionally object to processing or request
        correction by emailing the contact below. We respond within 30
        days.
      </p>

      <h2>Contact</h2>
      <p>
        Questions or privacy requests:{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </article>
  );
}
