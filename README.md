# PocketFrame

PocketFrame is an Electron + React desktop app that converts video into Game Boy-inspired output.

## Features

- Interactive preview while tuning processing settings
- MP4 export from the desktop app
- Renderer-backed CLI automation (`run` and `inspect`) for batch workflows
- Game Boy style processing controls including palette, dithering, LCD effects, and trim

## Project Status

PocketFrame is in active alpha development. Public builds may include breaking changes between releases.

## Getting Started

### Requirements

- Node.js 20+
- npm 10+

### Install dependencies

```bash
npm ci
```

### Run in development mode

```bash
npm run electron:dev
```

### Build production artifacts

```bash
npm run build
```

### Run CLI tests

```bash
npm run test:cli
```

## CLI Automation (v1)

CLI automation is renderer-backed (same export internals as the UI) and currently supports MP4 jobs.

### Commands

```bash
npm run cli -- run --job <path-to-job.json> [--show-ui] [--timeout-ms <ms>]
npm run cli -- inspect --job <path-to-job.json> [--show-ui]
```

Exit codes:

- `0`: success
- `2`: invalid args, schema, or validation
- `3`: runtime/export failure
- `124`: timeout

### Job file schema

Schema file: `src/automation/schema/job.v1.json`

Minimal `run` job example:

```json
{
  "schemaVersion": 1,
  "inputPath": "./tests/fixtures/tiny-sample.mp4",
  "outputPath": "./tmp/tiny-output.mp4",
  "modeConfig": {
    "format": "mp4"
  },
  "settings": {
    "contrast": 1.15,
    "ditherMode": "bayer4x4",
    "palette": "1989Green",
    "invertPalette": false,
    "targetFps": 24,
    "enableAudioBitcrush": true,
    "audio": {
      "highpass": 500,
      "lowpass": 3500,
      "bitDepth": 6,
      "distortion": 30
    },
    "lcd": {
      "enabled": true,
      "gridIntensity": 0.7,
      "shadowOpacity": 0.35,
      "ghostingStrength": 0.3,
      "baselineAlpha": 0.05
    },
    "trim": {
      "startSec": 0,
      "endSec": 1.5
    }
  }
}
```

For `inspect`, `outputPath` is optional.

### JSONL events

CLI emits JSON Lines to stdout.

Event envelope fields:

- `type`
- `timestamp`
- `jobId`
- type-specific fields

Example output:

```json
{"type":"session_start","timestamp":"2026-02-07T18:00:00.000Z","jobId":"...","command":"run","jobPath":"/abs/job.json","showUi":false,"timeoutMs":300000}
{"type":"job_validated","timestamp":"2026-02-07T18:00:00.500Z","jobId":"...","command":"run","format":"mp4","inputPath":"/abs/in.mp4","outputPath":"/abs/out.mp4"}
{"type":"progress","timestamp":"2026-02-07T18:00:01.000Z","jobId":"...","phase":"extract","value":0.42}
{"type":"progress","timestamp":"2026-02-07T18:00:02.000Z","jobId":"...","phase":"encode","value":0.87}
{"type":"progress","timestamp":"2026-02-07T18:00:02.100Z","jobId":"...","phase":"write","value":1}
{"type":"job_complete","timestamp":"2026-02-07T18:00:02.200Z","jobId":"...","outputPath":"/abs/out.mp4","bytesWritten":123456,"durationMs":1450}
```

## Alpha release docs

- Checklist: `docs/alpha/ALPHA_RELEASE_CHECKLIST.md`
- Release notes template: `docs/alpha/ALPHA_RELEASE_NOTES_TEMPLATE.md`
- Unsigned macOS install guide: `docs/alpha/UNSIGNED_MACOS_INSTALL.md`

## Contributing and community

- Contribution guide: `CONTRIBUTING.md`
- Code of conduct: `CODE_OF_CONDUCT.md`
- Security policy: `SECURITY.md`

## License

PocketFrame is licensed under the MIT License. See `LICENSE`.
