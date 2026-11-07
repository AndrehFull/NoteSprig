# Security policy

NoteSprig is an early-stage, single-vault application. Security fixes target the current development version; there is no supported long-term release branch or independent security audit.

## Reporting a vulnerability

Use **Security → Advisories → Report a vulnerability** on this repository when private vulnerability reporting is enabled. Include affected versions or commits, reproduction steps with synthetic data, the expected security boundary, and the potential impact.

If that option is unavailable, open an issue asking the maintainer to enable a private reporting channel, without publishing exploit details or sensitive data. Do not submit credentials, session cookies, personal notes, or server access.

No guaranteed response time or bug bounty is offered.

## Deployment boundaries

- Use a unique production password and random session secret. The development password is for local development only.
- Terminate HTTPS at a trusted proxy. Expose the app port only to that proxy. `TRUST_PROXY=1` trusts forwarded headers and must not be used behind an untrusted route.
- Treat filesystem and Docker access as access to the vault. Notes are readable files on the server; the app does not provide end-to-end encryption for live data.
- Offline notes and drafts remain in that browser's storage. Logging out clears the private app cache; clearing browser storage removes pending local drafts.
- Use one app instance per vault. Separate user accounts, per-note permissions, and coordinated collaborative editing are not implemented.
- External links, embedded media, and web views may contact external services when opened. AI integration is not implemented.

See [deployment](docs/deployment.md) for operational guidance and [third-party notices](THIRD_PARTY_NOTICES.md) for dependency information.
