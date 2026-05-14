-- Phase 0 of setlist-intelligence — persistent Spotify OAuth tokens.
-- See showbook-specs/setlist-intelligence/implementation.md §3.1 + §3.2.
--
-- Both `access_token_enc` and `refresh_token_enc` are AES-256-GCM ciphertext
-- produced by `packages/api/src/crypto.ts` using the `TOKEN_KEY` env var as
-- the 32-byte key. `revoked_at` is a soft-delete: rows persist for audit
-- after disconnect, with a separate nightly hard-delete after 30 days.

CREATE TABLE "user_spotify_tokens" (
	"user_id" text PRIMARY KEY NOT NULL,
	"access_token_enc" text NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"scope" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"spotify_user_id" text NOT NULL,
	"display_name" text,
	"product" text,
	"last_used_at" timestamp,
	"last_refreshed_at" timestamp,
	"revoked_at" timestamp,
	"revoked_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_spotify_tokens" ADD CONSTRAINT "user_spotify_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
