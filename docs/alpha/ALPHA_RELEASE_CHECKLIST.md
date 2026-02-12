# PocketFrame Alpha Release Checklist (Unsigned macOS DMG)

Use this checklist when publishing an alpha build to GitHub.

## 1) Choose alpha version
- Example: `v0.1.0-alpha.1`
- Keep alpha tags increasing: `alpha.1`, `alpha.2`, etc.

## 2) Build the app and DMG
Run from project root:

```bash
npm ci
npm run build
```

Expected output path:
- `release/PocketFrame-<version>-arm64.dmg` (name may vary)

## 3) Smoke test locally
- Open generated DMG.
- Drag app into Applications.
- Launch app and run a quick import/export check.

## 4) Create GitHub prerelease
Manual:
- Create a new release in GitHub.
- Tag: your alpha tag (example `v0.1.0-alpha.1`).
- Mark **This is a pre-release**.
- Upload the DMG asset from `release/`.

CLI option:

```bash
gh release create v0.1.0-alpha.1 release/*.dmg \
  --title "PocketFrame v0.1.0-alpha.1" \
  --notes-file docs/alpha/ALPHA_RELEASE_NOTES_TEMPLATE.md \
  --prerelease
```

## 5) Required warning text in release notes
Always include:
- This build is **unsigned and not notarized**.
- It is for **alpha testing only**.
- macOS may block first launch.
- Link testers to `docs/alpha/UNSIGNED_MACOS_INSTALL.md`.

## 6) Post-release validation
- Verify the release page shows prerelease badge.
- Verify DMG downloads successfully.
- Verify tester instructions are present.
