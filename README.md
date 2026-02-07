# PocketFrame

PocketFrame is an Electron + React app for converting videos into Game Boy-style output.

## CLI Automation (v1)

CLI automation is renderer-backed (same export internals as the UI) and currently supports MP4 jobs only.

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

### Job File Schema

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
    "ditherMode": "floydSteinberg",
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

### JSONL Events

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

## Constraints (v1)

- Desktop session required (not true headless CI)
- MP4 output only in CLI
- One job per invocation
- Batch automation only (`run` and `inspect`)
