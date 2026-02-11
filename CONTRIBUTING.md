# Contributing to PocketFrame

Thanks for your interest in contributing.

## Before you start

- Search existing issues and pull requests before opening new ones.
- For substantial changes, open an issue first so we can align on scope.

## Local setup

```bash
npm ci
npm run electron:dev
```

## Build and test

Run these before opening a pull request:

```bash
npm run build:app
npm run test:cli
```

## Pull request guidelines

- Keep PRs focused on a single change or tightly related set of changes.
- Include a short summary of what changed and why.
- If UI behavior changes, include screenshots or screen recordings.
- If CLI behavior changes, include sample command output.
- Add or update tests when behavior changes.

## Commit quality

- Use clear, descriptive commit messages.
- Avoid force-pushing over review feedback unless necessary.
- Rebase or merge `main` before final review if your branch is stale.

## Code of conduct

By participating, you agree to follow `CODE_OF_CONDUCT.md`.
