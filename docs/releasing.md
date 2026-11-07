# Preparing a public release

This is the maintainer's checklist for source publication and tagged releases. It does not publish a repository, create a release, or deploy the application.

## Review the file set

- Keep original code, tests, lockfiles, documentation, deployment examples, and required third-party notices.
- Exclude `.env`, vaults, backups, local archives, browser profiles, traces, generated builds, and credentials. `.gitignore` helps with untracked files; it does not remove already committed files or history.
- Review code and asset provenance, including any local development history, before the first publication. Rebranding and a new license do not authorize material owned by others.
- Use synthetic data in screenshots, issue reproductions, and public logs. Check screenshots visually.

The original project code and documentation use MIT. Preserve upstream notices and verify the terms of any new or modified dependency. The [notice index](../THIRD_PARTY_NOTICES.md) includes a link to the license bundle and source information for runtime dependencies.

## Run checks

```sh
npm ci
npm run check:docs
npm run check:i18n
npm run notices:check
npx playwright install --with-deps chrome
npm run test:ui
docker build -t notesprig:test .
node tests/container-smoke.mjs notesprig:test
```

Review the exact files selected for the first commit and run a secret scanner against that selection. If an actual secret was committed previously, revoke it and address the history before publication. A repository without a remote has no GitHub CI result; local checks do not imply a hosted workflow has run.

## Configure the GitHub repository

Use `notesprig` as the repository name, or another available repository slug. Suggested description: **A self-hosted workspace for linked Markdown notes, knowledge graphs, and visual thinking.**

Suggested topics: `markdown`, `knowledge-management`, `note-taking`, `self-hosted`, `pwa`, `typescript`, `react`, `docker`.

Enable private vulnerability reporting before opening the repository to the public, as described in [GitHub's reporting guide](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository). Review Actions permissions, enable appropriate branch protections after the first successful CI run, and avoid granting write permissions to pull-request workflows.

Do not invent a homepage, release badge, download link, support email, or coverage percentage. Add real project URLs and badges only after their targets exist.

## Tag a release

Update [CHANGELOG.md](../CHANGELOG.md) with the release version and date, check package metadata, and run the checks above. Describe user-visible changes and known limitations. Link to source, installation instructions, and third-party notices. Publish binary or container artifacts only with their required license texts and source information.

GitHub Pages can serve a separate static presentation, but it does not run this application's Node API or persistent vault.
