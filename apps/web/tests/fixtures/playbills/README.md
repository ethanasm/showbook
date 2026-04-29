# Playbill fixtures

Drop the **Hadestown** playbill cast page (the one shown in chat when this
test was added) here as `hadestown.jpg`. The Playwright spec
`tests/playbill-cast-extract.spec.ts` reads this file and uploads it to the
Add a Show form to verify that Groq's vision model extracts only the
principal cast — no swings, understudies, or orchestra members.

The image is intentionally not committed yet because it didn't have a
shareable source path when the test was authored. Once you save it here,
the test will pick it up automatically.
