-- GDPR Art. 6 / Art. 28 consent record for the Gmail-import flow,
-- which ships matched email subject + body (first 8 KB) to Groq
-- (third-party AI processor) to extract ticket details. Null = the
-- user hasn't been shown the disclosure yet; a timestamp = they
-- accepted at that wall-clock moment. The Gmail scan UI gates on
-- this column being non-null. Operator-triggered re-scans from
-- `/admin` are intentionally ungated.

ALTER TABLE "user_preferences"
  ADD COLUMN IF NOT EXISTS "accepted_gmail_scan_at" timestamptz;
