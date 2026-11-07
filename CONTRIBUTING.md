# Contributing to NoteSprig

Contributions that improve writing, navigation, data reliability, accessibility, and self-hosting are welcome. NoteSprig is in early development, so discuss substantial changes in an issue before beginning an implementation.

## Local setup

Use Node.js 22.12+ and npm:

```sh
npm ci
npm run dev
```

The interface is available at `http://localhost:5173`, with API port 4317. The development password is `dev-only-change-me`. Keep development services local and use disposable notes rather than your personal vault.

The interface supports English and Brazilian Portuguese. English is the default. Project documentation and issue templates use English, with a [Brazilian Portuguese README](README.pt-BR.md). Portuguese issue reports are also welcome. See the [translation guide](docs/i18n.md) when changing interface copy.

## Before submitting a pull request

```sh
npm run check:docs
npm run check:i18n
npm run notices:check
npx playwright install --with-deps chrome
npm run test:ui
```

Tests use Chrome and temporary vaults. OpenSSL and GNU tar must be available for the production/backup tests. Ports 4318, 4319, and 4320 must be free. The test server does not use your development vault.

For changes to Docker, deployment, or runtime packaging:

```sh
docker build -t notesprig:test .
node tests/container-smoke.mjs notesprig:test
```

This creates and removes its own disposable container and volume.

Keep changes focused. Explain the problem, the resulting behavior, and the checks you ran. Add regression coverage when it protects meaningful behavior; update the relevant guide when a workflow changes. Include screenshots for visible changes, using synthetic notes.

## Dependencies and notices

Commit lockfile changes alongside dependency changes. If runtime dependencies change, regenerate and review the notices:

```sh
npm ci
npm run notices:generate
npm run notices:check
```

Review the upstream license terms and source availability when introducing a dependency. The notice generator records the locked runtime dependency set and copies license files from the installed packages; it does not make licensing decisions for new components.

## Reporting issues

For bugs, describe the expected behavior, what happened, and the smallest reproduction using synthetic data. Include the app version or commit, browser, OS, and whether you use development mode or Docker. Remove passwords, cookies, tokens, private URLs, and personal notes from logs and screenshots.

For feature requests, describe the workflow and its current limitation. For vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of opening a public issue with exploit details.

## Working together

Be respectful, assume good intent, and keep feedback specific to the work. Harassment, discrimination, personal attacks, and publication of someone else's private information are not acceptable.

Contributions to the project's original code and documentation are made under the [MIT License](LICENSE). Preserve third-party notices and identify any material you did not create.
