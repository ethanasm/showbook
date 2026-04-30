# Cloudflare Tunnel Setup

One tunnel on your desktop, routing two apps by subdomain. No open ports, no Docker container, starts on boot.

---

## Prerequisites

- Domain `example.com` added to Cloudflare (free plan)
- Domain nameservers pointed to Cloudflare (they give you two NS addresses when you add the domain)
- macOS with Homebrew

---

## Step 1: Install cloudflared

```bash
brew install cloudflared
```

---

## Step 2: Authenticate

```bash
cloudflared tunnel login
```

This opens your browser. Sign in to Cloudflare and authorize the tunnel for `example.com`. A credentials cert is saved to `~/.cloudflared/cert.pem`.

---

## Step 3: Create the tunnel

```bash
cloudflared tunnel create home-tunnel
```

This prints a tunnel ID (a UUID like `a1b2c3d4-...`) and creates a credentials file at `~/.cloudflared/{tunnel-id}.json`. Note the tunnel ID — you need it for DNS.

---

## Step 4: Configure routing

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: home-tunnel
credentials-file: /Users/YOUR_USERNAME/.cloudflared/{tunnel-id}.json

ingress:
  - hostname: showbook.example.com
    service: http://localhost:3001
  - hostname: vactrack.example.com
    service: http://localhost:3000
  - service: http_status:404
```

Replace `YOUR_USERNAME` and `{tunnel-id}` with your actual values.

The `ingress` block routes by hostname:
- `showbook.example.com` → Showbook Next.js on port 3001
- `vactrack.example.com` → Vacation tracker web on port 3000
- Everything else → 404

The catch-all `http_status:404` at the bottom is required by cloudflared.

---

## Step 5: Add DNS records

In the Cloudflare dashboard → DNS → Records, add two CNAME records:

| Type | Name | Target | Proxy |
|------|------|--------|-------|
| CNAME | `showbook` | `{tunnel-id}.cfargotunnel.com` | Proxied |
| CNAME | `vactrack` | `{tunnel-id}.cfargotunnel.com` | Proxied |

Both point at the same tunnel. The config.yml routes them to different ports.

---

## Step 6: Test it

```bash
cloudflared tunnel run home-tunnel
```

From your phone (on cellular, not WiFi):
- `https://showbook.example.com` → should load Showbook (if Next.js is running on 3001)
- `https://vactrack.example.com` → should load Vacation tracker (if web container is running on 3000)

HTTPS is automatic — Cloudflare handles the TLS certificate.

---

## Step 7: Run on boot

```bash
sudo cloudflared service install
```

This creates a launchd service on macOS. The tunnel starts automatically when your desktop boots. To check status:

```bash
sudo launchctl list | grep cloudflared
```

To stop/start manually:

```bash
sudo launchctl stop com.cloudflare.cloudflared
sudo launchctl start com.cloudflare.cloudflared
```

---

## Adding a third app later

Edit `~/.cloudflared/config.yml` and add another ingress rule:

```yaml
ingress:
  - hostname: showbook.example.com
    service: http://localhost:3001
  - hostname: vactrack.example.com
    service: http://localhost:3000
  - hostname: newapp.example.com
    service: http://localhost:3002
  - service: http_status:404
```

Add a CNAME record for `newapp` → `{tunnel-id}.cfargotunnel.com`.

Restart cloudflared:
```bash
sudo launchctl stop com.cloudflare.cloudflared
sudo launchctl start com.cloudflare.cloudflared
```

---

## Troubleshooting

**Tunnel not connecting:**
```bash
cloudflared tunnel info home-tunnel   # check tunnel status
cloudflared tunnel run home-tunnel    # run manually to see errors
```

**DNS not resolving:**
- Verify the CNAME records are "Proxied" (orange cloud) in Cloudflare dashboard
- DNS propagation can take up to 5 minutes

**App not loading through tunnel:**
- Verify the app is actually running on the expected port: `curl http://localhost:3001`
- Check config.yml for typos in hostname or port

**Check logs:**
```bash
tail -f /Library/Logs/com.cloudflare.cloudflared.err.log
```
