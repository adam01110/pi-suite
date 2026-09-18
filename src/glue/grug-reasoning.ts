import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Codex models reason in grug style natively: terse plain sentences, small
 * plans, no narration. Weaker models (glm, deepseek, kimi, ...) default to
 * verbose reasoning, burn tokens, and drift mid-turn. For non-OpenAI models,
 * append a grug reasoning directive to the system prompt each turn.
 *
 * The directive must stay tiny: it is resent with every request.
 */
const GRUG_REASONING = `
## reasoning style

reason in grug style, caveman engineer saving tokens:

- short plain sentences, first person, present tense.
- probes (read/grep/find/ls/bash)? one tool_batch call, never separate calls or
  semicolon and && chains.
- no headings, no bullet spam in thinking. numbered steps only when order matters.
- plan at most 5 short lines, then act. plan lives in tool calls, not text.
- no restating task, no narration of attempts, no apologies.
- final report: what changed, how verified, file paths. then stop.
`;

/** True for models that already reason in grug style. */
export function isGrugNative(model: {
	readonly provider: string;
	readonly id: string;
}): boolean {
	return model.provider === "openai-codex" || model.id.startsWith("openai/");
}

export function grugReasoningSystemPrompt(systemPrompt: string): string {
	return `${systemPrompt}\n${GRUG_REASONING}`;
}

export default function grugReasoning(pi: ExtensionAPI): void {
	pi.on("before_agent_start", async (event, ctx) => {
		const model = ctx.model;
		if (!model || isGrugNative(model)) return;

		return {
			systemPrompt: grugReasoningSystemPrompt(event.systemPrompt),
		};
	});
}
