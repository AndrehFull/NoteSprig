# Deployment

This guide describes a single-vault deployment with Docker Compose and an HTTPS reverse proxy. Replace `notes.example.com` with your own hostname. Docker Engine, Compose, and a configured domain are required. Node.js 22.12+ is needed on the machine used to generate credentials and run host backup tools.

## Prepare the application

Place the source repository in `/opt/notesprig`, then install dependencies and create local configuration:

```sh
cd /opt/notesprig
npm ci
cp .env.example .env
chmod 600 .env
npm run set-password
```

The password generator requires at least 12 characters. Copy the complete generated `NOTESPRIG_PASSWORD_HASH` line into `.env`, including the single quotes around `scrypt$...`. The quotes prevent Compose from interpolating dollar signs. Generate the session secret with `openssl rand -hex 32` and place that value in `SESSION_SECRET`.

Production rejects placeholder credentials. The local development password is not used in production. Changing the session secret ends existing sessions.

Prepare the persistent volume and start the service:

```sh
mkdir -p data/vault
sudo chown -R 1000:1000 data
sudo chmod -R u+rwX,go-rwx data
docker compose config -q
docker compose up -d --build
docker compose ps
docker compose logs --tail=40 notesprig
```

The image runs as UID 1000 with a read-only root filesystem, dropped capabilities, and a persistent `./data:/data` bind mount. Compose binds port 4317 to host localhost. Run one application instance per vault.

## Configuration reference

| Variable | Purpose |
| --- | --- |
| `HOST` | Listen address; defaults to localhost outside the image |
| `PORT` | HTTP port; defaults to 4317 |
| `NOTESPRIG_VAULT` | Vault directory; `/data/vault` inside the image |
| `NOTESPRIG_DEV_PASSWORD` | Local development password only |
| `NOTESPRIG_PASSWORD_HASH` | Production scrypt password hash |
| `SESSION_SECRET` | Random production session secret, at least 32 characters |
| `TRUST_PROXY` | Set to `1` only behind a trusted proxy; configured in Compose |
| `NOTESPRIG_BACKUP_PASSWORD` | Backup tool password for unattended execution |

Compose reads `.env`. Direct Node commands use environment variables exported by your shell. Keep `.env` and production credentials out of version control.

## HTTPS and Cloudflare

Choose one route:

- **Cloudflare Tunnel on the host:** forward the hostname to `http://127.0.0.1:4317`. Store tunnel credentials outside the repository. If the tunnel runs in another container, use a private shared Docker network and `http://notesprig:4317`; container localhost is not host localhost.
- **Cloudflare DNS with Caddy:** configure [Caddyfile.example](../Caddyfile.example) for your hostname and run Caddy on the host. Point DNS at the VPS, expose proxy ports 80/443, and use Cloudflare **Full (strict)** TLS. Caddy forwards to `127.0.0.1:4317`.

Configure a **Bypass cache** rule for the entire app hostname. APIs, sessions, and private notes must not be cached at the edge. Browser offline caching is separate. Cloudflare Access can provide an additional login/MFA layer; the app has no built-in TOTP.

Production cookies use `HttpOnly`, `Secure`, and `SameSite=Strict`. `TRUST_PROXY=1` assumes requests can reach the app only through a trusted route.

After connecting through HTTPS, verify login, note editing, attachments, history, and access from another device. Install the PWA using your browser's installation action. The first visit requires a connection.

## Encrypted backups

A full backup includes notes, attachments, `.notesprig/`, and `.trash/`. Archives use AES-256-GCM with a key derived by scrypt. Store the password separately; a lost password cannot be recovered.

Install GNU tar and Node.js 22.12+ on the backup host. Pause writes for a consistent snapshot:

```sh
cd /opt/notesprig
docker pause notesprig
node scripts/backup.mjs create --vault data/vault --output backups/first.obak
docker unpause notesprig
```

The tool prompts for a backup password of at least 16 characters. If the manual command fails, unpause the container. Save backups outside the vault. ZIP export is a portability copy and excludes hidden history, settings, and trash.

### Automated host backups

The wrapper pauses the container, creates a backup, resumes it on success or failure, and optionally uploads using a preconfigured rclone remote. It requires Docker, Node, and tar on the host.

```sh
sudo install -d -m 700 /etc/notesprig /opt/notesprig/backups
sudo install -m 600 /dev/null /etc/notesprig/backup.env
```

Edit `/etc/notesprig/backup.env` with a unique password:

```ini
NOTESPRIG_PROJECT_DIR=/opt/notesprig
NOTESPRIG_BACKUP_PASSWORD=replace-with-a-long-unique-backup-password
# Optional, after configuring an off-host rclone remote:
# NOTESPRIG_BACKUP_REMOTE=remote:notesprig
# RCLONE_CONFIG=/etc/notesprig/rclone.conf
```

Install and test the service before enabling its timer:

```sh
sudo install -m 644 deploy/systemd/notesprig-backup.service /etc/systemd/system/
sudo install -m 644 deploy/systemd/notesprig-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl start notesprig-backup.service
sudo journalctl -u notesprig-backup.service -n 30
sudo systemctl enable --now notesprig-backup.timer
```

The timer runs daily at 03:15 in `America/Sao_Paulo`, with a short randomized delay. Change the timer for a different schedule. The service uses `ProtectHome=true`; keep rclone configuration under `/etc/notesprig/` with permission 600 and set `RCLONE_CONFIG` when needed.

Keep a copy off the VPS and periodically test restoration. Set retention according to available storage; the wrapper does not delete old archives.

## Restore and verify

Restore to a separate empty directory first:

```sh
node scripts/backup.mjs restore --input backups/first.obak --vault /opt/notesprig-restored/vault
```

Restoration verifies authentication before extraction, rejects unsafe paths and links, and refuses an occupied destination. An incorrect password leaves the destination unchanged.

Inspect the restored notes, attachments, and hidden metadata. To switch to that copy, stop the app, update its bind mount, and assign UID 1000 ownership. Keep the previous directory until you have verified access through the browser.

## Updates

Create a backup and verify its restoration before updating. After replacing the source with the new version:

```sh
cd /opt/notesprig
docker compose up -d --build
docker compose ps
```

Data remains in the bind mount. The interface cache updates through the service worker; synchronize edits and reload or reopen tabs if an older version remains active. See [migration](migration.md) for compatibility with earlier development installations.

## Troubleshooting

- **Port 4317 is busy:** stop another API process or adjust the host-side Compose binding and proxy target.
- **Permission errors:** verify the mounted data directory is writable by UID 1000.
- **Login fails in production:** check the complete quoted password hash, session secret, and HTTPS proxy configuration. Never put the development password in production.
- **PWA cannot install or reload offline:** use localhost or HTTPS and open the compiled app online first. Vite does not enable the service worker.
- **Container is unhealthy:** inspect `docker compose logs --tail=100 notesprig`; redact secrets and note content before sharing logs.
