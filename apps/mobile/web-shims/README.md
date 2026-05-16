# Web shims

Drop-in replacements that Metro swaps in **only when bundling for the
`web` platform** (see `metro.config.js`). They exist so the Expo web
target can boot for headless Playwright verification in the sandbox —
they are NOT shipped on iOS/Android and are NOT meant to be functional
substitutes for the native modules.

The shims give each native API just enough surface to import-and-render
without throwing. Anything storage-shaped is backed by either
`localStorage` (so Playwright can seed sessions via
`page.addInitScript`) or an in-memory map. Permissions/picker/location/
notifications/maps are inert.

If you find yourself reaching past a shim's surface in app code, either
gate the call site on `Platform.OS !== 'web'` or extend the shim — do
**not** add a real web implementation, because the mobile coverage gate
doesn't run web tests and the goal is parity-on-import, not parity-of-
behaviour.
