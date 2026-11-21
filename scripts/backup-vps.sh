#!/usr/bin/env bash
set -euo pipefail
notesprig_project_dir="${NOTESPRIG_PROJECT_DIR:-/opt/notesprig}"
if [[ -z "${NOTESPRIG_BACKUP_PASSWORD:-}" ]]; then
  printf '%s\n' 'Set NOTESPRIG_BACKUP_PASSWORD in the protected environment file.' >&2
  exit 1
fi
mkdir -p "$notesprig_project_dir/backups"
chmod 700 "$notesprig_project_dir/backups"
notesprig_stamp="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
# The default vault keeps its original archive name; each additional vault in data/vaults gets its own archive.
notesprig_sources=("$notesprig_project_dir/data/vault")
notesprig_names=("notesprig-$notesprig_stamp.obak")
if [[ -d "$notesprig_project_dir/data/vaults" ]]; then
  for notesprig_dir in "$notesprig_project_dir"/data/vaults/*/; do
    [[ -d "$notesprig_dir" ]] || continue
    notesprig_folder="$(basename "$notesprig_dir")"
    [[ "$notesprig_folder" == .* ]] && continue
    notesprig_sources+=("${notesprig_dir%/}")
    notesprig_names+=("notesprig-vault-$notesprig_folder-$notesprig_stamp.obak")
  done
fi
notesprig_archives=()
# Pause the owned container while tar reads every vault, including recovery journals, for one consistent snapshot.
docker pause notesprig >/dev/null
trap 'docker unpause notesprig >/dev/null || true' EXIT
for notesprig_index in "${!notesprig_sources[@]}"; do
  notesprig_archive="$notesprig_project_dir/backups/${notesprig_names[$notesprig_index]}"
  node "$notesprig_project_dir/scripts/backup.mjs" create --vault "${notesprig_sources[$notesprig_index]}" --output "$notesprig_archive"
  notesprig_archives+=("$notesprig_archive")
done
docker unpause notesprig >/dev/null
trap - EXIT
if [[ -n "${NOTESPRIG_BACKUP_REMOTE:-}" ]]; then
  for notesprig_archive in "${notesprig_archives[@]}"; do
    rclone copyto -- "$notesprig_archive" "${NOTESPRIG_BACKUP_REMOTE%/}/$(basename "$notesprig_archive")"
  done
fi
