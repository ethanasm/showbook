# SSL Certificates for Local Development

This directory contains SSL certificates for running the application with HTTPS in local development.

## Quick Start

### Generate Certificates (mkcert)

```bash
# Install mkcert (if not already installed)
brew install mkcert

# Install local Certificate Authority (one-time)
mkcert -install

# Generate trusted certificates (from repo root)
mkcert -key-file certs/localhost-key.pem -cert-file certs/localhost-cert.pem localhost 127.0.0.1 ::1
```

## Usage

Once certificates are generated, `docker compose up -d` will serve the app at https://localhost:3001.

## Files (Git Ignored)

- `localhost-cert.pem` - SSL certificate
- `localhost-key.pem` - Private key
