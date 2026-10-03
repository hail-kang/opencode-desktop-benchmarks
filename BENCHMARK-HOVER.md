# Benchmark radar in the model tooltip

This fork of [OpenCode](https://github.com/anomalyco/opencode) adds a benchmark
pentagon (radar) chart to the model selector tooltip in the desktop / web app.

When you hover a model in the model picker, the tooltip shows the existing
Model / Provider / Inputs / Reasoning / Context rows, followed by a
**Benchmarks** section with a normalized capability radar and per-axis scores:

![Model tooltip with benchmark radar](docs/benchmark-radar-tooltip.png)

## How it works

- Data comes from the same catalog the [opencode.ai/data](https://opencode.ai/data)
  comparison pages use: `https://models.opencode.ai/catalog.json` (+ `api.json`
  for pricing). The catalog is fetched once per app session, on the first hover,
  and cached in memory.
- The six axes — Reasoning, Coding, Cost efficiency, Context window,
  Multimodal, Tool use — and the 0–100 normalization (percentile ranks across
  the whole catalog, capability fallbacks) are ported from the stats site's
  `compare-radar` implementation, so scores match the comparison pages.
- Hollow chart points mark fallback values (capability defaults) exactly like
  the website.
- Models without a catalog entry or without any benchmark keep the original
  tooltip untouched.

### Files

- `packages/app/src/components/model-benchmark-radar.tsx` — catalog loader,
  model matching, radar normalization, and the chart component.
- `packages/app/src/components/model-tooltip.tsx` — mounts the radar in the
  v2 tooltip.
- `packages/app/src/i18n/en.ts`, `ko.ts` — new `model.tooltip.benchmark*` keys.

## Local development

Requirements: [Bun](https://bun.sh).

```sh
bun install
```

Backend (from `packages/opencode`):

```sh
bun run ./src/index.ts serve --port 4096
```

App (from `packages/app`):

```sh
bun dev -- --port 4444
```

Open `http://localhost:4444`, open a model selector, and hover a model.

To run the Electron desktop app instead:

```sh
bun dev   # from packages/desktop
```

Type checking:

```sh
bun typecheck   # from packages/app
```

## Staying up to date

```sh
git fetch upstream
git rebase upstream/dev
```

The patch is intentionally small (one new component + tooltip wiring), so it
rebases cleanly across upstream changes.
