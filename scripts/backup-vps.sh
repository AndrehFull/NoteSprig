#!/usr/bin/env bash
set -euo pipefail
notesprig_project_dir="${NOTESPRIG_PROJECT_DIR:-/opt/notesprig}"
if [[ -z "${NOTESPRIG_BACKUP_PASSWORD:-}" ]]; then
  printf '%s\n' 'Set NOTESPRIG_BACKUP_PASSWORD in the protected environment file.' >&2
  exit 1
fi
mkdir -p "$notesprig_project_dir/backups"
chmod 700 "$notesprig_project_dir/backups"
notesprig_archive="$notesprig_project_dir/backups/notesprig-$(date -u +%Y-%m-%dT%H-%M-%SZ).obak"
# Pause the owned container while tar reads the vault, including its recovery journal.
docker pause notesprig >/dev/null
trap 'docker unpause notesprig >/dev/null || true' EXIT
node "$notesprig_project_dir/scripts/backup.mjs" create --vault "$notesprig_project_dir/data/vault" --output "$notesprig_archive"
docker unpause notesprig >/dev/null
trap - EXIT
if [[ -n "${NOTESPRIG_BACKUP_REMOTE:-}" ]]; then
  rclone copyto -- "$notesprig_archive" "${NOTESPRIG_BACKUP_REMOTE%/}/$(basename "$notesprig_archive")"
fi
