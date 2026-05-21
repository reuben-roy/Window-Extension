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
npm run import:learning-quizzes -- --activate-user-email you@example.com
```

`prisma migrate deploy` applies the checked-in migrations, including `20260514123000_learning_system`.

`import:learning-quizzes` loads the generated quiz artifacts from `backend/data/learning/quizzes-cleaned` into Postgres and can optionally activate the imported topics for a specific signed-in user.

### Quiz corpus workflow

Hand-authored packs live in `backend/data/learning/quizzes-cleaned/` (15 topics × 60 questions). Source modules are under `backend/scripts/quiz_banks/`.

```bash
# Regenerate JSON from Python banks
python3 backend/scripts/author_learning_quizzes.py

# Optional: emit a subset only
python3 backend/scripts/author_learning_quizzes.py --only operating-systems-ostep,statistics-openintro

# Validate structure before import
node backend/scripts/validate_quiz_banks.mjs

# Import everything (default: replaces canonical pack per topic — resets spaced-repetition for those topics)
cd backend && npm run import:learning-quizzes

# Import only new or changed packs (slug or topicKey, comma-separated)
cd backend && npm run import:learning-quizzes -- --only operating-systems-ostep,databases-design

# Smoke-test difficulty ramp in-process (requires DATABASE_URL)
cd backend && npx tsx scripts/validate_ramp_up.ts
```

Imported topic keys (Phase 0 + Phase 1): `algorithms`, `machine-learning`, `reinforcement-learning`, `probability`, `logic`, `operating-systems`, `distributed-systems`, `databases`, `networking`, `linear-algebra`, `statistics`, `discrete-math`, `deep-learning`, `transformers`, `calculus`.

Do **not** import from gitignored `backend/data/learning/quizzes/` (PDF-derived templates). Do **not** use the in-app “Regenerate pack” button to refresh corpus content — that creates stub questions via the worker.

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
- The generated quiz JSON files are not served directly from disk. The API only exposes quiz packs that already exist in Postgres, so importing the corpus is a separate deployment step.
