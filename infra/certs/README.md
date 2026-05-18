# SSL Certificates for Local Development

This directory holds mkcert-issued TLS certificates for serving the
dev web app over HTTPS. The dev compose (`infra/docker-compose.yml`)
bind-mounts this directory read-only into the web container at
`/app/certs`, and `apps/web/server.mjs` serves HTTPS when those
files are present.

## Quick Start

### Generate Certificates (mkcert)

```bash
# Install mkcert (if not already installed)
brew install mkcert

# Install local Certificate Authority (one-time)
mkcert -install

# Generate trusted certificates (from repo root)
mkcert -key-file infra/certs/localhost-key.pem \
       -cert-file infra/certs/localhost-cert.pem \
       localhost 127.0.0.1 ::1
```

## Usage

Once certificates are generated, `pnpm dev:up` will serve the app at
https://localhost:3001.

## Files (Git Ignored)

- `localhost-cert.pem` — SSL certificate
- `localhost-key.pem` — Private key

Only this README is tracked. If you previously had certs under the
old `certs/` directory at repo root, `pnpm dev:up` will move them
into here automatically the first time it runs (see
`scripts/migrate-local-certs.mjs`).
