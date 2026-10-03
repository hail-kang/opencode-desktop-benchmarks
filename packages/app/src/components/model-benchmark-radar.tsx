import { createMemo, createResource, For, Show, type Component } from "solid-js"
import { useLanguage } from "@/context/language"

// Benchmark data comes from the same catalog the opencode.ai/data comparison
// pages use. The catalog is shared and rarely changes, so it is fetched once
// per app session and cached at module scope.

const catalogSourceUrl = "https://models.opencode.ai/catalog.json"
const pricingSourceUrl = "https://models.opencode.ai/api.json"

type CatalogCost = {
  input: number
  output: number
}

type CatalogBenchmark = {
  name: string
  score: number
  version?: string
  harness?: string
  variant?: string
}

type CatalogEntry = {
  id: string
  lab: string
  slug: string
  reasoning?: boolean
  toolCall?: boolean
  limit?: { context?: number }
  modalities: { input: string[]; output: string[] }
  attachment: boolean
  cost?: CatalogCost
  benchmarks: CatalogBenchmark[]
}

export type { CatalogEntry }

export type BenchmarkAxisKey =
  | "model.tooltip.benchmark.axis.reasoning"
  | "model.tooltip.benchmark.axis.coding"
  | "model.tooltip.benchmark.axis.cost"
  | "model.tooltip.benchmark.axis.context"
  | "model.tooltip.benchmark.axis.multimodal"
  | "model.tooltip.benchmark.axis.toolUse"

type RadarAxis = {
  labelKey: BenchmarkAxisKey
  score: (model: CatalogEntry) => number | undefined
  capability?: "reasoning" | "toolCall"
}

type RadarScore = {
  value: number
  fallback?: boolean
}

type CatalogData = {
  entries: CatalogEntry[]
  axes: RadarAxis[]
}

const radarRingCount = 5
const codingBenchmarkPattern = /(swe|aider|code|coding|nl2repo)/
const reasoningBenchmarkPattern = /(gpqa|humanity|last exam|reasoning|aime|hmmt|math|mmlu|mrcr|charxiv|cti realm)/
const toolUseBenchmarkPattern = /(terminal bench|claw eval|tau ?(?:bench|2|3))/

const MODEL_NAME_ALIASES: Record<string, string> = {
  "deepseek-flash": "deepseek-v4.1-flash",
  "deepseek-v4-flash-0731": "deepseek-v4-flash",
  "deepseek-v4-flash-dsv4-flash-final-rnaovd": "deepseek-v4-flash",
  "opencode-go/union-alpha": "union-alpha",
  "opencode/union-alpha": "union-alpha",
  "ox-alpha": "glm-5.3-flash",
  "x-preview-f": "glm-5.3-flash",
  "xiaomi/mimo-v2.5": "mimo-v2.5",
}

const MODEL_NAME_MAX_LENGTH = 256

let catalogPromise: Promise<CatalogData> | undefined

function loadCatalogData() {
  catalogPromise ??= Promise.all([fetchPayload(catalogSourceUrl), fetchPayload(pricingSourceUrl)])
    .then(([catalog, pricing]) => {
      const entries = buildCatalog(catalog, pricing)
      return { entries, axes: buildRadarAxes(entries) }
    })
    .catch((error) => {
      // A failed load should not poison the whole session; retry on the next hover.
      catalogPromise = undefined
      throw error
    })
  return catalogPromise
}

function fetchPayload(url: string) {
  return fetch(url)
    .then((response): Promise<unknown> => (response.ok ? (response.json() as Promise<unknown>) : Promise.resolve()))
    .catch(() => undefined)
}

function buildCatalog(payload: unknown, pricing: unknown): CatalogEntry[] {
  const costs = readCatalogCosts(pricing)
  const models = readCatalogModels(payload)
    .flatMap(readCatalogEntry)
    .map((model) => ({
      ...model,
      cost: costs.get(catalogIdKey(model.id)) ?? costs.get(model.slug) ?? model.cost,
    }))
  return [...models, ...readCatalogAliases(models, costs)]
}

// Contributor is a serving tier of these Muse models, with its own pricing.
// Keep aliases out of the model population used to normalize benchmark scores.
function readCatalogAliases(models: CatalogEntry[], costs: Map<string, CatalogCost>) {
  return ["meta/muse-spark-1.2", "meta/muse-spark-1.3"].flatMap((id) => {
    const model = models.find((entry) => entry.id === id)
    if (!model) return []
    const alias = `${id}-contributor`
    return [
      {
        ...model,
        id: alias,
        slug: `${model.slug}-contributor`,
        cost: costs.get(catalogIdKey(alias)) ?? costs.get(`${model.slug}-contributor`),
      },
    ]
  })
}

function readCatalogModels(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  if (!isRecord(payload)) return []
  if (Array.isArray(payload.models)) return payload.models
  if (isRecord(payload.models)) return Object.values(payload.models)
  return Object.values(payload)
}

function readCatalogEntry(value: unknown): CatalogEntry[] {
  if (!isRecord(value)) return []
  const id = stringValue(value.id)
  const lab = id?.split("/")[0]
  const slug = id?.split("/").slice(1).join("/")
  if (!id || !lab || !slug) return []
  return [
    {
      id,
      lab: catalogSlug(lab),
      slug: catalogSlug(slug),
      reasoning: typeof value.reasoning === "boolean" ? value.reasoning : undefined,
      toolCall: typeof value.tool_call === "boolean" ? value.tool_call : undefined,
      limit: readCatalogLimit(value.limit),
      modalities: readCatalogModalities(value.modalities),
      attachment: value.attachment === true,
      cost: readCatalogCost(value.cost),
      benchmarks: readCatalogBenchmarks(value.benchmarks),
    },
  ]
}

function readCatalogCosts(payload: unknown) {
  const costs = new Map<string, CatalogCost>()
  const add = (model: unknown, provider?: string) => {
    if (!isRecord(model)) return
    const id = stringValue(model.id)
    const cost = readCatalogCost(model.cost)
    if (!id || !cost) return
    costs.set(catalogIdKey(id), cost)
    costs.set(catalogSlug(id), cost)
    if (provider && !id.includes("/")) costs.set(`${catalogSlug(provider)}/${catalogSlug(id)}`, cost)
  }

  if (Array.isArray(payload)) {
    payload.forEach((model) => add(model))
    return costs
  }
  if (!isRecord(payload)) return costs

  Object.entries(payload).forEach(([key, value]) => {
    if (!isRecord(value)) return
    if (isRecord(value.models)) {
      Object.values(value.models).forEach((model) => add(model, stringValue(value.id) ?? key))
      return
    }
    add(value)
  })
  return costs
}

function readCatalogCost(value: unknown): CatalogCost | undefined {
  if (!isRecord(value)) return undefined
  const input = numberValue(value.input)
  const output = numberValue(value.output)
  if (input === undefined || output === undefined) return undefined
  return { input, output }
}

function readCatalogLimit(value: unknown) {
  if (!isRecord(value)) return undefined
  return { context: numberValue(value.context) }
}

function readCatalogModalities(value: unknown) {
  if (!isRecord(value)) return { input: [], output: [] }
  return {
    input: stringArrayValue(value.input),
    output: stringArrayValue(value.output),
  }
}

function readCatalogBenchmarks(value: unknown): CatalogBenchmark[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!isRecord(item)) return []
    const name = stringValue(item.name)
    const score = numberValue(item.score)
    return name && score !== undefined
      ? [
          {
            name,
            score,
            version: stringValue(item.version),
            harness: stringValue(item.harness),
            variant: stringValue(item.variant),
          },
        ]
      : []
  })
}

function catalogIdKey(value: string) {
  return value.split("/").map(catalogSlug).join("/")
}

function catalogSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
}

function catalogLabSlug(value: string) {
  const slug = catalogSlug(value)
  const aliases: Record<string, string> = {
    moonshot: "moonshotai",
    qwen: "alibaba",
    zhipu: "zhipuai",
    zai: "zhipuai",
  }
  return aliases[slug] ?? slug
}

function normalizeInferenceModel(value: string | undefined) {
  return (value || "unknown").toLowerCase().replace(/(-free|:free|:global)+$/, "") || "unknown"
}

function statModel(model: string | undefined) {
  const normalized = normalizeInferenceModel(model)
  const resolved = normalized === "big-pickle" ? "unknown" : normalized
  const value = MODEL_NAME_ALIASES[resolved.toLowerCase()] ?? resolved
  return value.length > MODEL_NAME_MAX_LENGTH ? "unknown" : value
}

// The app's model IDs come from many providers and gateways, so the same
// catalog entry can appear as "claude-fable-5-1", "anthropic/claude-fable-5.1",
// "claude-fable-5-1@default", or "us.anthropic.claude-fable-5". Normalize to the
// plain model name before matching against the catalog.
export function normalizeModelId(value: string) {
  const aliased = statModel(value)
  const leaf = aliased.split("/").at(-1) ?? aliased
  const withoutVariant = leaf.split("@")[0]
  return withoutVariant
    .replace(/^~/, "")
    .replace(/^(us|eu|global)\.anthropic\./, "")
    .replace(/^anthropic[.-]/, "")
}

export function findCatalogEntry(entries: CatalogEntry[], model: string, lab?: string) {
  const canonicalModel = normalizeModelId(model)
  const normalizedId = lab ? `${catalogLabSlug(lab)}/${catalogSlug(canonicalModel)}` : canonicalModel.trim().toLowerCase()
  const leaf = catalogSlug(canonicalModel)
  return (
    entries.find((entry) => entry.id.toLowerCase() === normalizedId) ??
    entries.find((entry) => (lab ? entry.lab === catalogLabSlug(lab) : true) && entry.slug === leaf) ??
    entries.find((entry) => entry.slug === leaf)
  )
}

function buildRadarAxes(entries: CatalogEntry[]): RadarAxis[] {
  const benchmarks = benchmarkScoreGroups(entries)
  const toolUseBenchmarks = benchmarkScoreGroups(entries, true)
  const costs = entries.flatMap((model) => {
    const cost = modelCost(model)
    return cost === undefined ? [] : [cost]
  })
  const contexts = entries.flatMap((model) => (model.limit?.context === undefined ? [] : [model.limit.context]))
  const multimodalMaximum = Math.max(...entries.map(multimodalFeatureCount), 0)

  return [
    {
      labelKey: "model.tooltip.benchmark.axis.reasoning",
      capability: "reasoning",
      score: (model) => benchmarkPercentile(model, benchmarks, reasoningBenchmarkPattern),
    },
    {
      labelKey: "model.tooltip.benchmark.axis.coding",
      score: (model) => benchmarkPercentile(model, benchmarks, codingBenchmarkPattern),
    },
    {
      labelKey: "model.tooltip.benchmark.axis.cost",
      score: (model) => {
        const cost = modelCost(model)
        if (cost === undefined) return
        if (cost === 0) return 100
        return percentileScore(cost, costs, "lower")
      },
    },
    {
      labelKey: "model.tooltip.benchmark.axis.context",
      score: (model) => {
        const context = model.limit?.context
        if (context === undefined) return
        return percentileScore(context, contexts, "higher")
      },
    },
    {
      labelKey: "model.tooltip.benchmark.axis.multimodal",
      score: (model) => {
        if (multimodalMaximum === 0) return
        return (multimodalFeatureCount(model) / multimodalMaximum) * 100
      },
    },
    {
      labelKey: "model.tooltip.benchmark.axis.toolUse",
      capability: "toolCall",
      score: (model) =>
        benchmarkPercentile(model, toolUseBenchmarks, toolUseBenchmarkPattern, {
          aggregate: "average",
          includeHarness: true,
        }),
    },
  ]
}

function benchmarkScoreGroups(entries: CatalogEntry[], includeHarness = false) {
  return entries.reduce<Map<string, number[]>>((groups, model) => {
    model.benchmarks
      .reduce<Map<string, number>>((scores, benchmark) => {
        const key = benchmarkKey(benchmark, includeHarness)
        scores.set(key, Math.max(scores.get(key) ?? -Infinity, benchmark.score))
        return scores
      }, new Map())
      .forEach((score, key) => {
        groups.set(key, [...(groups.get(key) ?? []), score])
      })
    return groups
  }, new Map())
}

function benchmarkKey(benchmark: CatalogBenchmark, includeHarness: boolean) {
  const name = normalizeBenchmarkName(benchmark.name)
  const version = normalizeBenchmarkName(benchmark.version ?? "")
  const versioned = version && !name.endsWith(version) ? `${name} ${version}` : name
  if (!includeHarness) return versioned
  const harness = normalizeBenchmarkName(benchmark.harness ?? benchmark.variant ?? "")
  return harness ? `${versioned} | ${harness}` : versioned
}

function benchmarkPercentile(
  model: CatalogEntry,
  benchmarks: Map<string, number[]>,
  pattern: RegExp,
  options?: { aggregate?: "average" | "best"; includeHarness?: boolean },
) {
  const scores = Object.entries(
    model.benchmarks.reduce<Record<string, number>>((result, benchmark) => {
      const key = benchmarkKey(benchmark, options?.includeHarness ?? false)
      if (!pattern.test(key)) return result
      result[key] = Math.max(result[key] ?? -Infinity, benchmark.score)
      return result
    }, {}),
  ).flatMap(([key, score]) => {
    const values = benchmarks.get(key)
    const percentile = values ? percentileScore(score, values, "higher") : undefined
    return percentile === undefined ? [] : [percentile]
  })
  if (scores.length === 0) return
  if (options?.aggregate === "average") return scores.reduce((sum, score) => sum + score, 0) / scores.length
  // Benchmark coverage varies by model, so additional published results should not lower a model's score.
  return Math.max(...scores)
}

function normalizeBenchmarkName(value: string) {
  return value
    .toLowerCase()
    .replace(/\u03c4/g, "tau")
    .replace(/\u00b2/g, "2")
    .replace(/\u00b3/g, "3")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function modelCost(model: CatalogEntry) {
  if (!model.cost) return
  return model.cost.input + model.cost.output
}

function multimodalFeatureCount(model: CatalogEntry) {
  return new Set([
    ...model.modalities.input.filter((modality) => modality !== "text").map((modality) => `input:${modality}`),
    ...model.modalities.output.filter((modality) => modality !== "text").map((modality) => `output:${modality}`),
    ...(model.attachment ? ["attachment"] : []),
  ]).size
}

function percentileScore(value: number, values: number[], direction: "higher" | "lower") {
  const finite = values.filter(Number.isFinite)
  if (!Number.isFinite(value) || finite.length < 2) return
  const below = finite.filter((candidate) => candidate < value).length
  const equal = finite.filter((candidate) => candidate === value).length
  const percentile = ((below + (equal - 1) / 2) / (finite.length - 1)) * 100
  return direction === "higher" ? percentile : 100 - percentile
}

function resolveRadarScore(axis: RadarAxis, model: CatalogEntry | undefined): RadarScore {
  const score = model ? axis.score(model) : undefined
  if (score !== undefined) return { value: score }
  const supported = axis.capability ? model?.[axis.capability] : undefined
  if (supported === undefined) return { value: 50, fallback: true }
  return supported ? { value: 50, fallback: true } : { value: 0, fallback: true }
}

function radarPoint(index: number, count: number, score: number) {
  const angle = -Math.PI / 2 + (index * Math.PI * 2) / count
  const radius = Math.max(0, Math.min(100, score)) / 2
  return {
    x: roundRadarCoordinate(50 + Math.cos(angle) * radius),
    y: roundRadarCoordinate(50 + Math.sin(angle) * radius),
  }
}

function radarPolygonPoints(count: number, score: number) {
  return Array.from({ length: count })
    .map((_, index) => radarPoint(index, count, score))
    .map((point) => `${point.x},${point.y}`)
    .join(" ")
}

function radarSeriesPoints(scores: RadarScore[]) {
  return scores
    .map((score, index) => radarPoint(index, scores.length, score.value))
    .map((point) => `${point.x},${point.y}`)
    .join(" ")
}

function roundRadarCoordinate(value: number) {
  return Math.round(value * 1000) / 1000
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function stringArrayValue(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    : []
}

export const ModelBenchmarkRadar: Component<{ model: { id: string; providerID: string } }> = (props) => {
  const language = useLanguage()
  const [catalog] = createResource(loadCatalogData)

  const entry = createMemo(() => {
    const data = catalog()
    if (!data) return
    return findCatalogEntry(data.entries, props.model.id, props.model.providerID)
  })
  const axes = createMemo(() => catalog()?.axes ?? [])
  const scores = createMemo(() => axes().map((axis) => resolveRadarScore(axis, entry())))

  const ariaLabel = createMemo(() =>
    language.t("model.tooltip.benchmarks.aria", {
      scores: axes()
        .map((axis, index) =>
          language.t("model.tooltip.benchmark.score", {
            label: language.t(axis.labelKey),
            score: Math.round(scores()[index].value),
          }),
        )
        .join(", "),
    }),
  )

  return (
    <Show when={scores().some((score) => !score.fallback)}>
      <div class="h-px bg-v2-border-border-muted" />
      <div class="flex flex-col gap-1.5">
        <div class="text-[11px] font-medium leading-4 text-v2-text-text-muted">
          {language.t("model.tooltip.benchmarks")}
        </div>
        <div class="flex items-center gap-2.5">
          <svg viewBox="0 0 100 100" class="size-[104px] shrink-0" role="img" aria-label={ariaLabel()}>
            <g fill="none" class="text-v2-border-border-muted" stroke-width="0.4">
              <For each={Array.from({ length: radarRingCount })}>
                {(_, index) => (
                  <polygon points={radarPolygonPoints(axes().length, ((index() + 1) / radarRingCount) * 100)} stroke="currentColor" />
                )}
              </For>
              <For each={axes()}>
                {(_, index) => {
                  const point = () => radarPoint(index(), axes().length, 100)
                  return <line x1="50" y1="50" x2={point().x} y2={point().y} stroke="currentColor" />
                }}
              </For>
            </g>
            <g class="text-v2-text-text-accent">
              <polygon
                points={radarSeriesPoints(scores())}
                fill="currentColor"
                fill-opacity="0.12"
                stroke="currentColor"
                stroke-width="0.8"
                stroke-linejoin="round"
              />
              <For each={scores()}>
                {(score, index) => {
                  const point = () => radarPoint(index(), scores().length, score.value)
                  return (
                    <circle
                      cx={point().x}
                      cy={point().y}
                      r="1.2"
                      fill={score.fallback ? "none" : "currentColor"}
                      stroke="currentColor"
                      stroke-width={score.fallback ? "0.6" : "0"}
                    />
                  )
                }}
              </For>
            </g>
          </svg>
          <div class="flex min-w-0 flex-1 flex-col">
            <For each={axes()}>
              {(axis, index) => (
                <div class="flex items-center justify-between gap-2 text-[11px] leading-[17px]">
                  <span class="min-w-0 truncate text-v2-text-text-muted">{language.t(axis.labelKey)}</span>
                  <span class="shrink-0 tabular-nums text-v2-text-text-base">{Math.round(scores()[index()].value)}</span>
                </div>
              )}
            </For>
          </div>
        </div>
        <Show when={scores().some((score) => score.fallback)}>
          <div class="text-[10px] leading-3.5 text-v2-text-text-faint">
            {language.t("model.tooltip.benchmarks.fallback")}
          </div>
        </Show>
      </div>
    </Show>
  )
}
