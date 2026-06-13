import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Delete your account · Showbook",
  description:
    "How to permanently delete your Showbook account and the data tied to it.",
};

// DRAFT: review with counsel before public launch. Copy below mirrors
// the in-app account-erasure flow exposed by `trpc.account.delete`
// (Postgres FK cascade owned by migration 0022) and the retention
// commitments already declared in /privacy.
const CONTACT_EMAIL =
  process.env.LEGAL_CONTACT_EMAIL ?? "privacy@showbook.app";

export default function AccountDeletionPage() {
  return (
    <article className="legal-doc">
      <p className="legal-doc__updated">Last updated: 2026-05-28</p>
      <h1>Delete your Showbook account</h1>
      <p>
        Showbook is a personal tracker for live shows. You can
        permanently delete your account and the data tied to it at any
        time. Two ways:
      </p>

      <h2>From inside the app (recommended)</h2>
      <ol>
        <li>
          Sign in on the Showbook mobile app or at{" "}
          <a href="https://showbook.ethanasm.me">
            showbook.ethanasm.me
          </a>
          .
        </li>
        <li>
          Open <strong>Preferences</strong> — the Me tab on mobile, or
          the Preferences link in the navigation on web.
        </li>
        <li>
          Scroll to the bottom and find the{" "}
          <strong>Danger zone</strong> section.
        </li>
        <li>
          Tap <strong>Delete account…</strong>, type{" "}
          <code>DELETE</code> in the confirmation field, and submit.
          The deletion runs immediately as a single database
          transaction; there is no grace period or undo.
        </li>
      </ol>

      <h2>By email (fallback)</h2>
      <p>
        If you can&apos;t reach the app — locked out, signed out
        without your password manager, etc. — email{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> from
        the Google address tied to your Showbook account. Subject:
        &quot;Delete my Showbook account&quot;. We action requests
        within 30 days; most go through within a few business days.
      </p>

      <h2>What gets deleted</h2>
      <p>
        Once the deletion runs, every row owned by your account is
        dropped from the database in a single cascade. Specifically:
      </p>
      <ul>
        <li>
          <strong>Your account</strong> — the user row plus your
          stored Google profile (name, email, avatar).
        </li>
        <li>
          <strong>Show data</strong> — every concert, theatre, comedy,
          and festival entry you&apos;ve added, including
          dates, lineups, notes, and venue / artist follows.
        </li>
        <li>
          <strong>Media</strong> — every photo and video you&apos;ve
          attached to a show, both the database row and the underlying
          blob in object storage.
        </li>
        <li>
          <strong>Setlists</strong> — any setlists you&apos;ve
          composed or saved, plus your predicted-setlist preferences.
        </li>
        <li>
          <strong>Preferences and follows</strong> — venue follows,
          artist follows, region preferences, theme, notification
          toggles.
        </li>
        <li>
          <strong>Integration tokens</strong> — Spotify and Gmail
          OAuth tokens are dropped; the connections at Spotify and
          Google are not auto-revoked from their side, but the tokens
          stored on our side are gone and we lose the ability to call
          their APIs on your behalf.
        </li>
      </ul>

      <h2>What is retained, and for how long</h2>
      <ul>
        <li>
          <strong>Encrypted database backups</strong> — daily
          snapshots that include the deleted rows, retained for 30
          days, then expired automatically. Backups are encrypted at
          rest and never restored selectively.
        </li>
        <li>
          <strong>Operational logs</strong> — anonymised event names
          and identifiers (no email content, no auth tokens), retained
          for 30 days. After deletion your user ID may still appear in
          older log lines until the window rolls off.
        </li>
        <li>
          <strong>Email send records</strong> — Resend (our email
          provider) keeps its own send / bounce records of the daily
          digests we sent you, per Resend&apos;s retention policy. We
          stop sending the moment your account is deleted.
        </li>
        <li>
          <strong>Third-party copies</strong> — Spotify playlists you
          generated through Showbook stay on your Spotify account
          until you delete them there. Public setlist.fm content we
          referenced isn&apos;t ours to delete.
        </li>
      </ul>
      <p>
        No other data is retained. We don&apos;t sell user data and
        deletion is not contingent on any review.
      </p>

      <h2>Contact</h2>
      <p>
        Questions or trouble with a deletion request:{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </article>
  );
}
