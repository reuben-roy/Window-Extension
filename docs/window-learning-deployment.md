# Window Learning Deployment

This rollout assumes:

- Oracle VM runs the always-on API and worker.
- Neon hosts PostgreSQL.
- Oracle Object Storage stores source files, generated artifacts, and nightly logical backups.

## Required Environment

Create `/etc/window/window.env` on the Oracle VM:

```bash
NODE_ENV=production
PORT=8787
DATABASE_URL=postgresql://...
JWT_SECRET=replace-me
WINDOW_BACKUP_BUCKET=window-backups
WINDOW_BACKUP_NAMESPACE=your-oracle-namespace
WINDOW_BACKUP_PREFIX=postgres
WINDOW_BACKUP_ROOT=/var/backups/window
WINDOW_BACKUP_RETENTION_DAYS=14
```

Add any existing Window backend secrets that are already required by the API.

## Build And Release

```bash
cd /opt/window/window-extension
npm install
npm run build
npm run build:backend
cd backend
npx prisma migrate deploy
```

`prisma migrate deploy` applies the checked-in migrations, including `20260514123000_learning_system`.

## Services

Install the unit files from [ops/oracle](/Users/reubenroy/github/hobby/window-extension/ops/oracle):

- [window-api.service](/Users/reubenroy/github/hobby/window-extension/ops/oracle/window-api.service)
- [window-worker.service](/Users/reubenroy/github/hobby/window-extension/ops/oracle/window-worker.service)
- [window-db-backup.service](/Users/reubenroy/github/hobby/window-extension/ops/oracle/window-db-backup.service)
- [window-db-backup.timer](/Users/reubenroy/github/hobby/window-extension/ops/oracle/window-db-backup.timer)

Then enable them:

```bash
sudo cp ops/oracle/window-*.service /etc/systemd/system/
sudo cp ops/oracle/window-db-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now window-api.service
sudo systemctl enable --now window-worker.service
sudo systemctl enable --now window-db-backup.timer
```

## Reverse Proxy

Use [ops/oracle/Caddyfile](/Users/reubenroy/github/hobby/window-extension/ops/oracle/Caddyfile) as the baseline Caddy configuration. Replace `window.example.com` with the real hostname and point the upstream port at the backend API.

## Backups

Nightly logical exports run through [backend/scripts/backup-postgres.sh](/Users/reubenroy/github/hobby/window-extension/backend/scripts/backup-postgres.sh).

Behavior:

- writes a timestamped `pg_dump` custom-format archive under `WINDOW_BACKUP_ROOT`
- uploads it to Oracle Object Storage when `WINDOW_BACKUP_BUCKET` and `WINDOW_BACKUP_NAMESPACE` are configured
- deletes local dumps older than `WINDOW_BACKUP_RETENTION_DAYS`

## Restore

1. Provision a fresh Neon branch or replacement Postgres database.
2. Download the desired dump from Oracle Object Storage.
3. Restore with `pg_restore --clean --if-exists --no-owner --no-privileges -d "$DATABASE_URL" window-<timestamp>.dump`.
4. Point `/etc/window/window.env` at the restored database and restart `window-api` plus `window-worker`.

## Notes

- The learning worker is intentionally separate from the API so source discovery and quiz generation continue even when the API is idle.
- The checked-in migration creates the canonical learning entities, quiz pack versions, spaced-repetition progress tables, and worker job table required by the new Learning feature.
- This repo does not apply the migration automatically to the live Neon database; run `npx prisma migrate deploy` during the release window you choose.
