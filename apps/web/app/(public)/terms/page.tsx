import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms · Showbook",
  description: "The agreement between you and Showbook.",
};

// DRAFT: review with counsel before public launch. Copy below covers
// the obligations the integrated third-party APIs impose (Ticketmaster,
// setlist.fm, Spotify, Google) plus the standard service / liability /
// governing-law clauses. Specifics that vary by deployment are
// env-driven.
const CONTACT_EMAIL = process.env.LEGAL_CONTACT_EMAIL ?? "hello@showbook.app";
const GOVERNING_LAW =
  process.env.LEGAL_GOVERNING_LAW ?? "the State of New York, USA";

export default function TermsPage() {
  return (
    <article className="legal-doc">
      <p className="legal-doc__updated">Last updated: 2026-05-18</p>
      <h1>Terms of service</h1>
      <div className="legal-doc__draft" role="note">
        DRAFT — please review with counsel before opening sign-ups
        outside the current allowlist.
      </div>
      <p>
        By using Showbook you agree to these terms. They&apos;re short.
      </p>

      <h2>The service</h2>
      <p>
        Showbook is a personal entertainment-tracking app. Use it to log
        shows you&apos;ve seen, plan ones you&apos;re going to, and
        discover new ones from venues and artists you follow. The
        service is provided as-is.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>
          You sign in with Google. Keep that account secure — anyone
          with access to it can access your Showbook data.
        </li>
        <li>
          You&apos;re responsible for the content you add (notes,
          photos, tags) and for not uploading anything you don&apos;t
          have the right to share.
        </li>
        <li>
          You can delete your account at any time from Preferences →
          Danger zone. Cascade deletion is immediate; backups roll off
          on the 30-day cycle described in the{" "}
          <a href="/privacy">privacy policy</a>.
        </li>
      </ul>

      <h2>Acceptable use</h2>
      <p>
        Don&apos;t use Showbook to scrape, resell, or repackage data
        from the integrated third-party APIs (Ticketmaster, setlist.fm,
        Spotify, Google). Don&apos;t upload illegal content, infringing
        material, or anything you wouldn&apos;t want a moderator to
        review.
      </p>

      <h2>Third-party attribution</h2>
      <ul>
        <li>
          Event data shown on Showbook is sourced in part from{" "}
          <strong>Ticketmaster Discovery API</strong>; tickets purchased
          on Ticketmaster are subject to Ticketmaster&apos;s own terms.
        </li>
        <li>
          Past-show setlists are sourced from{" "}
          <strong>setlist.fm</strong>; their data is licensed
          non-commercially under{" "}
          <a
            href="https://creativecommons.org/licenses/by-sa/3.0/"
            target="_blank"
            rel="noreferrer"
          >
            CC BY-SA 3.0
          </a>
          .
        </li>
        <li>
          Playlist generation and listening insights are powered by{" "}
          <strong>Spotify</strong>; using these features requires you
          to agree to Spotify&apos;s own terms in the OAuth flow.
        </li>
        <li>
          Map tiles are served by <strong>Google Maps</strong> and
          subject to Google&apos;s terms of service.
        </li>
      </ul>

      <h2>Termination</h2>
      <p>
        We may suspend or terminate accounts that abuse the service or
        violate these terms. You can terminate your own account at any
        time from Preferences.
      </p>

      <h2>Disclaimers and limitation of liability</h2>
      <p>
        The service is provided &quot;as is&quot; without warranty of
        any kind. We are not liable for indirect, incidental, or
        consequential damages arising from use of the service. To the
        extent permitted by law, our total liability for any claim
        related to the service is limited to the amount you paid for it
        in the 12 months preceding the claim (which, for a free
        product, is zero).
      </p>

      <h2>Changes</h2>
      <p>
        We&apos;ll post material changes here with a new
        &quot;last updated&quot; date and email users when the changes
        affect their data rights.
      </p>

      <h2>Governing law</h2>
      <p>
        These terms are governed by the laws of {GOVERNING_LAW}, without
        regard to conflict-of-law principles.
      </p>

      <h2>Contact</h2>
      <p>
        Questions: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </article>
  );
}
