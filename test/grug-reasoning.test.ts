import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import grugReasoning, {
  grugReasoningSystemPrompt,
  isGrugNative,
} from "../src/glue/grug-reasoning.js";

type BeforeAgentStartHandler = (
  event: { systemPrompt: string },
  ctx: { model?: { provider: string; id: string } },
) => Promise<{ systemPrompt: string } | undefined> | undefined;

describe("grug reasoning", () => {
  test("marks codex provider and openai model IDs as native", () => {
    expect(isGrugNative({ provider: "openai-codex", id: "gpt-5" })).toBe(true);
    expect(isGrugNative({ provider: "openai-codex", id: "openai/gpt-5" })).toBe(true);
    expect(isGrugNative({ provider: "glm", id: "openai/gpt-5" })).toBe(true);
    expect(isGrugNative({ provider: "glm", id: "gpt-5" })).toBe(false);
    expect(isGrugNative({ provider: "anthropic", id: "claude" })).toBe(false);
  });

  test("appends the directive to the system prompt", () => {
    const prompt = grugReasoningSystemPrompt("base");
    expect(prompt).toContain("base\n");
    expect(prompt).toContain("reason in grug style");
  });

  test("leaves native models untouched", async () => {
    const handlers = new Map<string, BeforeAgentStartHandler>();
    const pi = {
      on: (name: string, handler: BeforeAgentStartHandler) => {
        handlers.set(name, handler);
      },
    } as unknown as ExtensionAPI;
    grugReasoning(pi);

    const result = await handlers.get("before_agent_start")!(
      { systemPrompt: "base" },
      { model: { provider: "openai-codex", id: "gpt-5" } },
    );
    expect(result).toBeUndefined();
  });

  test("rewrites the system prompt for non-native models", async () => {
    const handlers = new Map<string, BeforeAgentStartHandler>();
    const pi = {
      on: (name: string, handler: BeforeAgentStartHandler) => {
        handlers.set(name, handler);
      },
    } as unknown as ExtensionAPI;
    grugReasoning(pi);

    const result = await handlers.get("before_agent_start")!(
      { systemPrompt: "base" },
      { model: { provider: "glm", id: "glm-5" } },
    );
    expect(result?.systemPrompt).toContain("base\n");
    expect(result?.systemPrompt).toContain("reason in grug style");
  });

  test("leaves the prompt untouched when no model is selected", async () => {
    const handlers = new Map<string, BeforeAgentStartHandler>();
    const pi = {
      on: (name: string, handler: BeforeAgentStartHandler) => {
        handlers.set(name, handler);
      },
    } as unknown as ExtensionAPI;
    grugReasoning(pi);

    const result = await handlers.get("before_agent_start")!({ systemPrompt: "base" }, {});
    expect(result).toBeUndefined();
  });
});
