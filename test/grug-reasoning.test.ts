import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import grugReasoning, { isGrugNative } from "../src/glue/grug-reasoning.js";

type BeforeAgentStartHandler = (
	event: { systemPromptOptions: { appendSystemPrompt: string } },
	ctx: { model?: { provider: string; id: string } },
) => Promise<void> | void;

function handler(): BeforeAgentStartHandler {
	const handlers = new Map<string, BeforeAgentStartHandler>();
	const pi = {
		on: (name: string, register: BeforeAgentStartHandler) => {
			handlers.set(name, register);
		},
	} as unknown as ExtensionAPI;
	grugReasoning(pi);
	return handlers.get("before_agent_start")!;
}

describe("grug reasoning", () => {
	test("marks codex provider and openai model IDs as native", () => {
		expect(isGrugNative({ provider: "openai-codex", id: "gpt-5" })).toBe(true);
		expect(isGrugNative({ provider: "openai-codex", id: "openai/gpt-5" })).toBe(
			true,
		);
		expect(isGrugNative({ provider: "glm", id: "openai/gpt-5" })).toBe(true);
		expect(isGrugNative({ provider: "glm", id: "gpt-5" })).toBe(false);
		expect(isGrugNative({ provider: "anthropic", id: "claude" })).toBe(false);
	});

	test("appends the directive to the prompt append section", async () => {
		const event = { systemPromptOptions: { appendSystemPrompt: "" } };
		await handler()(event, { model: { provider: "glm", id: "glm-5" } });
		expect(event.systemPromptOptions.appendSystemPrompt).toContain(
			"reason in grug style",
		);
		expect(event.systemPromptOptions.appendSystemPrompt).toContain(
			"tool_batch",
		);
		expect(event.systemPromptOptions.appendSystemPrompt).toContain(
			"codemode` is for pipelines only",
		);
	});

	test("leaves native models untouched", async () => {
		const event = { systemPromptOptions: { appendSystemPrompt: "" } };
		await handler()(event, {
			model: { provider: "openai-codex", id: "gpt-5" },
		});
		expect(event.systemPromptOptions.appendSystemPrompt).toBe("");
	});

	test("leaves the prompt untouched when no model is selected", async () => {
		const event = { systemPromptOptions: { appendSystemPrompt: "" } };
		await handler()(event, {});
		expect(event.systemPromptOptions.appendSystemPrompt).toBe("");
	});
});
