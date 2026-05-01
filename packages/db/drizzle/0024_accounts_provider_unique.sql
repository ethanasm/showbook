-- Prevent duplicate accounts for the same (provider, providerAccountId) pair.
-- Without this index, concurrent first-logins for the same Google sub can
-- race past the "account exists?" lookup and create two separate user rows.
-- ON CONFLICT DO NOTHING in upsertUserFromGoogle relies on this constraint.

CREATE UNIQUE INDEX "accounts_provider_provider_account_id_uniq"
  ON "accounts" ("provider", "provider_account_id");
