import { describe, expect, test } from "bun:test"
import { findCatalogEntry, normalizeModelId, type CatalogEntry } from "./model-benchmark-radar"

const entry = (id: string): CatalogEntry => ({
  id,
  lab: id.split("/")[0],
  slug: id.split("/")[1],
  modalities: { input: ["text"], output: ["text"] },
  attachment: false,
  benchmarks: [],
})

const catalog = [
  entry("anthropic/claude-fable-5-1"),
  entry("anthropic/claude-fable-5"),
  entry("openai/gpt-6-luna"),
  entry("deepseek/deepseek-v4-1-flash"),
]

describe("normalizeModelId", () => {
  test("keeps plain model ids", () => {
    expect(normalizeModelId("claude-fable-5-1")).toBe("claude-fable-5-1")
    expect(normalizeModelId("gpt-6-luna")).toBe("gpt-6-luna")
  })

  test("strips provider-qualified prefixes", () => {
    expect(normalizeModelId("anthropic/claude-fable-5.1")).toBe("claude-fable-5.1")
    expect(normalizeModelId("openrouter/anthropic/claude-fable-5.1")).toBe("claude-fable-5.1")
  })

  test("strips gateway variant suffixes", () => {
    expect(normalizeModelId("claude-fable-5-1@default")).toBe("claude-fable-5-1")
    expect(normalizeModelId("claude-fable-5@eu")).toBe("claude-fable-5")
  })

  test("strips gateway region and provider prefixes", () => {
    expect(normalizeModelId("us.anthropic.claude-fable-5")).toBe("claude-fable-5")
    expect(normalizeModelId("eu.anthropic.claude-fable-5")).toBe("claude-fable-5")
    expect(normalizeModelId("global.anthropic.claude-fable-5-1")).toBe("claude-fable-5-1")
    expect(normalizeModelId("anthropic.claude-fable-5")).toBe("claude-fable-5")
    expect(normalizeModelId("anthropic-claude-fable-5.1")).toBe("claude-fable-5.1")
  })

  test("does not touch unrelated model names", () => {
    expect(normalizeModelId("gemma-4-31b-it-fabled")).toBe("gemma-4-31b-it-fabled")
    expect(normalizeModelId("duo-chat-fable-5-1")).toBe("duo-chat-fable-5-1")
  })
})

describe("findCatalogEntry", () => {
  test("matches by provider-qualified id", () => {
    expect(findCatalogEntry(catalog, "anthropic/claude-fable-5.1", "openrouter")?.id).toBe(
      "anthropic/claude-fable-5-1",
    )
  })

  test("matches plain ids with the provider hint", () => {
    expect(findCatalogEntry(catalog, "claude-fable-5-1", "anthropic")?.id).toBe("anthropic/claude-fable-5-1")
    expect(findCatalogEntry(catalog, "gpt-6-luna", "openai")?.id).toBe("openai/gpt-6-luna")
  })

  test("matches dotted model ids to dashed catalog slugs", () => {
    expect(findCatalogEntry(catalog, "deepseek-v4.1-flash", "deepseek")?.id).toBe("deepseek/deepseek-v4-1-flash")
  })

  test("returns undefined for unknown models", () => {
    expect(findCatalogEntry(catalog, "claude-fable-latest", "anthropic")).toBeUndefined()
  })
})
