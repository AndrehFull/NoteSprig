# Upgrading earlier development installations

This guide covers installations created before the NoteSprig identity was finalized. Back up the vault and synchronize pending edits before upgrading. Test restoration into a separate directory first.

## Server data

The server migrates the previous internal metadata directory to `.notesprig/`, preserving settings, history, and recovery data. Note, Canvas, Bases, and attachment paths remain unchanged.

If both the previous and current metadata directories exist, startup stops rather than merging or overwriting them. Preserve both copies and review which is authoritative before restarting.

Current environment variables use the `NOTESPRIG_` prefix. The API and backup tool still accept earlier variable names, with current names taking precedence. Compose, systemd, and the backup wrapper use the current operational names; update existing service/container names and configuration before switching to those templates.

Earlier valid session cookies remain readable. New sessions use the current cookie name; logging out expires both. A development restart may end sessions because its temporary session secret changes.

## Browser data

On first access, the app copies earlier preferences and workspace settings without replacing values already stored under the current names. IndexedDB migration similarly preserves existing current records. Original database entries remain until private-cache cleanup on logout.

The migration marker is preserved when private cache is cleared, preventing old drafts from reappearing after logout. The service worker migrates cached attachments and replaces the earlier application shell.

Finish edits, synchronize, and reload old tabs. Migration does not add coordination between tabs using different application versions. Clearing browser storage removes unsynchronized drafts.

## Backups

New backup files start with the format identifier `NSPRIG01`. The authenticated encryption structure remains compatible, and restoration also accepts the earlier format. Passwords are not changed by the identity migration.

Automated migration coverage includes metadata, conflicting metadata directories, configuration precedence, earlier cookies, backup restoration, drafts, logout cleanup, cached attachments, and offline reload. These checks use synthetic data.
