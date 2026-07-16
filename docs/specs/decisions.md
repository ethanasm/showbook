# Showbook — Design Decisions

Only the decisions that operational automation cites by ID live here.
The historical design-decision log (D1–D24: data-layer, dedup, Discover,
search, etc.) moved to the private knowledge vault:
`brain/projects/showbook/decisions/design-decisions.md` in the workspace.

---

### D25: Mobile app versioning → SemVer; 0.x is the beta line, 1.0.0 is the first public release
**Decision:** The mobile app uses plain numeric SemVer (`MAJOR.MINOR.PATCH`) in `apps/mobile/app.config.ts`. All beta builds (TestFlight / Play internal track, `preview-store` profile) live on the `0.MINOR.PATCH` line: bump MINOR for a feature batch, PATCH for a fix-only build. `1.0.0` is reserved for the first `production`-profile store submission. Build numbers are owned entirely by EAS (`appVersionSource: "remote"` + `autoIncrement`) — monotonic per platform, never reset, never set by hand, no semantic meaning.

**Rules:**
- **No pre-release suffixes.** `1.0.0-beta.1` is invalid as an iOS `CFBundleShortVersionString` (Apple requires up to three period-separated integers), so the beta marker is the major-version-zero line itself — which is exactly what SemVer reserves 0.x for ("initial development; anything may change").
- **Version bumps are coupled to native builds**, because `runtimeVersion: { policy: 'appVersion' }` derives the OTA runtime from the version string. Any build with native changes (SDK upgrade, native dep, `app.config.ts`, permissions) MUST bump the version so old binaries refuse incompatible bundles. Conversely, JS-only releases ship via `eas update` *without* a bump — bumping for an OTA-only release would target a runtime no installed binary has, so nobody would receive it.
- **After 1.0.0, "beta" is a distribution property, not a version property.** A `1.x` build goes to TestFlight / Play internal first and the *same artifact* is promoted to public when ready; the `preview` vs `production` update channels keep beta and prod OTAs apart even when version strings coincide. (One store record per bundle id — a permanently forked beta version line isn't possible anyway.)
- The web app's `package.json` version is not user-facing and does not track the mobile version; web deploys are continuous.
- **Bumping is automated** by `mobile-deploy.yml` on its build path (never on OTA): a conventional-commit scan of squash-merge subjects since the last `mobile-v*` tag picks minor (`feat:` / breaking `!`) vs patch (everything else), `scripts/bump-mobile-version.mjs` edits `app.config.ts`, and the workflow commits + tags `mobile-vX.Y.Z` back to `main` before building. Feature PR titles should carry a `feat:` prefix so the scan sees them; a manual version edit (the 1.0.0 jump) is detected and never double-bumped. See the Versioning section of `mobile-deployment.md`.

**Rationale:** Matches what's already shipped (`0.1.1` build 7 on devices), requires zero changes to `eas.json`, keeps the user-visible promise simple (0.x = beta, ≥1.0 = released), and respects the two hard constraints: Apple's numeric-only version format and expo-updates' appVersion runtime policy.

### D26: Mobile store releases → environment approval gate; OTA stays continuous
**Decision:** Store submissions (the `mobile-deploy.yml` build path: version bump + `eas build` + `eas submit` to Play internal / TestFlight) are gated by the `mobile-release` GitHub environment with a required reviewer. Native-affecting merges to `main` still *trigger* a release run automatically, but the run pauses at the gate — before any side effect — until the pending deployment is approved from the run page / email / GitHub mobile app. Rejecting (or ignoring for 30 days) ships nothing and leaves no bump commit or tag; the changes ride the next approved release. OTA JS updates are **not** gated and keep deploying continuously on every CI-green merge.

**Rules:**
- The gate sits in front of the version bump, so skipped releases never pollute the `mobile-v*` tag history — and the range-based version scan (D25) means a later approved release automatically accounts for everything skipped before it.
- The `ota` and `release` jobs hold separate concurrency groups so a release waiting at the gate can never block OTA deploys from later merges.
- `workflow_dispatch` build mode passes through the same gate (self-approval allowed by default).
- The environment is fail-open until "Required reviewers" is configured on it in repo settings (Settings → Environments → mobile-release) — one-time manual setup, documented in `mobile-deployment.md` § "Release approval gate".
- Approval means "upload to the preview testing tracks", not a public store release; the future `production` pipeline gets its own environment.

**Rationale:** Every native merge auto-submitting to TestFlight / Play internal made each merge an implicit release; the only opt-out was remembering not to merge, and the alternative (no auto-submit) meant manually dispatching the workflow after every merge. GitHub environments are the purpose-built middle ground: the trigger, versioning, build, and submit stay fully automated, while the human decision is reduced to a one-click approve/reject with a notification, an audit trail, and zero cost for skipped releases. Alternatives considered: PR labels (decision forced at merge time, easy to forget, invisible audit trail) and tag/release-triggered deploys (still a manual post-merge ritual — exactly what this replaces).
