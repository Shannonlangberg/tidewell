#!/usr/bin/env bash
# Backs up the live Planted HQ database to an ENCRYPTED file on this machine.
#
#   scripts/hq/backup.sh            (or: npm run hq:backup)
#
# Why: the Supabase free plan has no automatic backups. This is a stopgap, not a replacement for Pro.
# What it saves: the data in the hq and auth schemas (people, contacts, contractors, tasks, audit log, sign-ins)
# plus the schema, as two SQL dumps in one encrypted archive. It does NOT save files in storage (contractor
# documents); there are none yet.
# Where: ~/.planted-hq/backups/ (kept: the newest 30). The passphrase lives in ~/.planted-hq/backup-passphrase.
# KEEP A COPY OF THE PASSPHRASE ELSEWHERE (a password manager). Without it a backup cannot be opened, and a
# backup that lives only on this laptop is lost with this laptop: copy the newest file to a second place.
# To restore: decrypt (openssl enc -d -aes-256-cbc -pbkdf2 -pass file:<passphrase> -in <file> | tar -xz), apply schema.sql to an
# empty project, then data.sql with triggers disabled (psql -c "set session_replication_role = replica" ...); test it
# on a scratch project before you ever need it.
# Needs: the Supabase CLI logged in, Docker running (the CLI dumps through a container), and
# SUPABASE_DB_PASSWORD in ~/.planted-hq/secrets.env. Read-only against the live database.
set -euo pipefail
HOME_DIR="${HOME}/.planted-hq"
OUT_DIR="${HOME_DIR}/backups"
PASS_FILE="${HOME_DIR}/backup-passphrase"
STAMP="$(date +%Y-%m-%d_%H%M)"
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

mkdir -p "${OUT_DIR}"
chmod 700 "${HOME_DIR}" "${OUT_DIR}"
if [ ! -f "${PASS_FILE}" ]; then
  openssl rand -base64 36 > "${PASS_FILE}"
  chmod 600 "${PASS_FILE}"
  echo "Created a new backup passphrase at ${PASS_FILE}. Copy it somewhere safe now."
fi
# shellcheck disable=SC1091
set -a; . "${HOME_DIR}/secrets.env"; set +a

cd "$(dirname "$0")/../.."
supabase db dump --linked -f "${TMP}/schema.sql"
supabase db dump --linked --data-only --schema hq,auth -f "${TMP}/data.sql"
tar -C "${TMP}" -czf "${TMP}/backup.tar.gz" schema.sql data.sql
openssl enc -aes-256-cbc -pbkdf2 -salt -pass "file:${PASS_FILE}" -in "${TMP}/backup.tar.gz" -out "${OUT_DIR}/planted-hq-${STAMP}.tar.gz.enc"
chmod 600 "${OUT_DIR}/planted-hq-${STAMP}.tar.gz.enc"
ls -1t "${OUT_DIR}"/planted-hq-*.enc | tail -n +31 | xargs -r rm -f
echo "Saved ${OUT_DIR}/planted-hq-${STAMP}.tar.gz.enc ($(du -h "${OUT_DIR}/planted-hq-${STAMP}.tar.gz.enc" | cut -f1))"
