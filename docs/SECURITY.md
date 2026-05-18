# Security Policy

## Reporting a vulnerability

If you've found a security issue in Showbook, please **do not** open a public
GitHub issue. Instead, report it privately via GitHub's
["Report a vulnerability"](https://github.com/ethanasm/showbook/security/advisories/new)
flow on the repository's Security tab.

I'll acknowledge the report within a few days and follow up with next steps.

## Scope

Only the latest commit on `main` is considered in scope. There is no bug
bounty — Showbook is a personal project and reports are accepted in good
faith.

In-scope examples:

- Authentication / authorization bugs (IDORs, session handling, allowlist
  bypasses, OAuth callback handling).
- Server-side request forgery, command injection, SQL injection, prototype
  pollution.
- Cost-abuse vectors against paid upstream APIs (Groq, Ticketmaster, Google
  Places, setlist.fm, Resend, Cloudflare R2). See
  [`GUARDRAILS.md`](./GUARDRAILS.md) for the existing per-user caps.
- Secrets accidentally committed to the repository.

Out of scope:

- Issues that require a self-hoster to misconfigure their own deployment
  (e.g. running with `ENABLE_TEST_ROUTES=1` against production data).
- Denial of service against a self-hosted instance from an authenticated
  user when the operator has not configured `AUTH_ALLOWED_EMAILS` /
  `AUTH_ALLOWED_DOMAINS`.
- Findings against third-party dependencies that don't have a working
  exploit path through Showbook.
