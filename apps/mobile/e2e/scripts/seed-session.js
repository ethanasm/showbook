// Maestro runScript helper — builds the e2e seed-session deeplink.
//
// Maestro's runScript runs in a Graal JS context with access to flow
// `env` vars and writes to `output.<name>` so subsequent flow steps can
// substitute via ${output.<name>}.
//
// We expect two env vars from Maestro Cloud secrets (CI sets them via
// .github/workflows/mobile-e2e.yml):
//
//   MAESTRO_E2E_TOKEN     — a Showbook NextAuth-compatible JWT minted
//                           ahead of time against the e2e backend (the
//                           same JWT format /api/auth/mobile-token
//                           returns). Long-lived; rotate quarterly.
//
//   MAESTRO_E2E_USER_JSON — JSON-serialized SessionUser
//                           ({ id, email, name, image }). Must match
//                           the user the JWT identifies.
//
// The deeplink is consumed by the e2e-build deeplink handler, which
// writes the values into SecureStore under `e2e.test-token` and
// `e2e.test-user`. apps/mobile/lib/auth.ts then reads those keys when
// the user taps the sign-in button.

if (!MAESTRO_E2E_TOKEN || !MAESTRO_E2E_USER_JSON) {
  throw new Error(
    'MAESTRO_E2E_TOKEN and MAESTRO_E2E_USER_JSON must be set as Maestro Cloud secrets',
  );
}

const token = encodeURIComponent(MAESTRO_E2E_TOKEN);
const user = encodeURIComponent(MAESTRO_E2E_USER_JSON);

output.seedDeeplink = `showbook://e2e/seed-session?token=${token}&user=${user}`;
