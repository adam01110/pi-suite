import type {
	AssistantMessage,
	Context,
	Model,
	SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { contentText } from "@earendil-works/pi-ai";
import {
	AssistantMessageComponent,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { loadProfileConfig, profileFor } from "./model-profile.js";

/**
 * Collapsed thinking blocks: plain label plus a fast-model summary.
 *
 * pi renders every collapsed thinking run with one global label, set through
 * `ctx.ui.setHiddenThinkingLabel`. Two behaviors sit on top of that:
 *
 * - The label is plain text (`thinking`) instead of the nerd-font glyph the
 *   QOL module installs by default.
 * - When a thinking block finishes streaming, the fast profile model writes a
 *   one-line summary of it and that block's label becomes
 *   `thinking · <summary>`. Providers that already ship reasoning summaries
 *   (OpenAI responses/codex, Google) are skipped, because their thinking
 *   content already is the provider's summary.
 *
 * Summaries are keyed by (message timestamp, content index) and applied by
 * wrapping `AssistantMessageComponent.prototype.updateContent` — the same
 * seam QOL patches for its thinking timer. Histories replayed from a session
 * file keep the plain label: only live blocks are summarized.
 *
 * The summary call never thinks: `reasoning` is left out, which every pi-ai
 * adapter except the codex transport reads as "no thinking", and the codex
 * transport is called with `reasoningEffort: "none"`. Fast models whose
 * reasoning cannot be silenced that way are skipped rather than used
 * (see {@link canSilenceThinking}).
 */

/** Collapsed label before a summary exists. */
export const THINKING_LABEL = "thinking";
/** Separator between that label and the summary. */
export const SUMMARY_SEPARATOR = " · ";
/** Shortest thinking block worth a model call. */
export const MIN_SUMMARY_CHARS = 400;
/** Only the head of a long block is sent to the summarizer. */
const MAX_SUMMARY_INPUT_CHARS = 8_000;
/** Output cap for the one-line summary. */
const SUMMARY_MAX_TOKENS = 80;
/** Longest accepted summary before ellipsis. */
const SUMMARY_MAX_CHARS = 160;
/** Concurrent summary requests; extra blocks keep the plain label. */
const MAX_IN_FLIGHT = 2;

/**
 * APIs whose thinking content is authored by the provider as a summary, so
 * pi already shows one. `summary: "auto"` on the OpenAI responses variants,
 * `includeThoughts: true` on Google.
 */
export const PROVIDER_SUMMARY_APIS: ReadonlySet<string> = new Set([
	"azure-openai-responses",
	"google-generative-ai",
	"google-vertex",
	"openai-codex-responses",
	"openai-responses",
]);

interface LabelTarget {
	setText(text: string): void;
	text: string;
}

/** Minimal shape of the patched component; keeps the seam duck-typed. */
interface HiddenThinkingComponent {
	hideThinkingBlock?: boolean;
	hiddenThinkingLabel?: string;
	lastMessage?: AssistantMessage;
	contentContainer?: { children?: unknown[] };
}

type ThinkingBlock = { type: string; thinking?: string };

const PATCH_SYMBOL = Symbol.for("pi-suite.thinking-summary.patch");

/** Summaries for live blocks, keyed by `timestamp:contentIndex`. */
const summaries = new Map<string, string>();
let inFlight = 0;

export function summaryKey(timestamp: number, contentIndex: number): string {
	return `${timestamp}:${contentIndex}`;
}

export function providerSendsSummaries(api: string | undefined): boolean {
	return api !== undefined && PROVIDER_SUMMARY_APIS.has(api);
}

/** Whether this block is worth and eligible for a summary request. */
export function needsSummary(
	api: string | undefined,
	thinking: string,
): boolean {
	if (providerSendsSummaries(api)) return false;
	return thinking.trim().length >= MIN_SUMMARY_CHARS;
}

/**
 * Content indices of every thinking run, in render order. A run is a maximal
 * stretch of consecutive thinking blocks; runs with no non-empty block are
 * dropped, exactly as the component's own render loop does, so run order maps
 * one-to-one onto the collapsed labels.
 */
export function thinkingRuns(content: readonly ThinkingBlock[]): number[][] {
	const runs: number[][] = [];
	for (let i = 0; i < content.length; i++) {
		if (content[i]?.type !== "thinking") continue;
		const indices: number[] = [];
		for (; i < content.length && content[i]?.type === "thinking"; i++) {
			if ((content[i]?.thinking ?? "").trim()) indices.push(i);
		}
		i--;
		if (indices.length > 0) runs.push(indices);
	}
	return runs;
}

export function buildSummaryPrompt(thinking: string): string {
	return [
		"Summarize the reasoning below as one plain line of at most 15 words.",
		"No preamble, no quotes, no markdown, no trailing period.",
		"Name the concrete subject and the decision that was reached.",
		"",
		thinking,
	].join("\n");
}

/** Flatten model output into a single short label fragment. */
export function cleanSummary(text: string): string | undefined {
	const flat = text
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^["'`*_]+|["'`*_]+$/g, "")
		.replace(/[.\s]+$/, "")
		.trim();
	if (!flat) return undefined;
	if (flat.length <= SUMMARY_MAX_CHARS) return flat;
	return `${flat.slice(0, SUMMARY_MAX_CHARS).trimEnd()}…`;
}

export function summaryLabel(summary: string): string {
	return `${THINKING_LABEL}${SUMMARY_SEPARATOR}${summary}`;
}

/** SGR sequences; built from a char code to keep the literal control char out. */
const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

function stripAnsi(text: string): string {
	return text.replace(ANSI_PATTERN, "");
}

/** openai-completions formats that send an explicit thinking-disable flag. */
export const EXPLICIT_DISABLE_FORMATS: ReadonlySet<string> = new Set([
	"qwen",
	"qwen-chat-template",
	"together",
	"zai",
]);

/** APIs that send no thinking parameter at all when `reasoning` is absent. */
export const SILENT_WHEN_UNSET: ReadonlySet<string> = new Set([
	"anthropic-messages",
	"bedrock-converse-stream",
	"mistral-conversations",
]);

/** APIs that fall back to `thinkingLevelMap.off ?? "none"` when absent. */
export const OFF_WHEN_UNSET: ReadonlySet<string> = new Set([
	"azure-openai-responses",
	"openai-responses",
]);

function isLabelText(text: string, expected: string): boolean {
	const plain = stripAnsi(text);
	if (expected && plain === expected) return true;
	return (
		plain === THINKING_LABEL ||
		plain.startsWith(`${THINKING_LABEL}${SUMMARY_SEPARATOR}`)
	);
}

/** Label component inside a child, unwrapping pi-tui's MouseRegion. */
function labelTarget(
	child: unknown,
	expected: string,
): LabelTarget | undefined {
	const inner = (child as { child?: unknown } | undefined)?.child;
	for (const candidate of [child, inner]) {
		const target = candidate as Partial<LabelTarget> | undefined;
		if (
			typeof target?.setText !== "function" ||
			typeof target.text !== "string"
		) {
			continue;
		}
		if (isLabelText(target.text, expected)) return target as LabelTarget;
	}
	return undefined;
}

function labelComponents(component: HiddenThinkingComponent): LabelTarget[] {
	const children = component.contentContainer?.children;
	if (!Array.isArray(children)) return [];
	const expected = stripAnsi(component.hiddenThinkingLabel ?? "");
	const labels: LabelTarget[] = [];
	for (const child of children) {
		const target = labelTarget(child, expected);
		if (target) labels.push(target);
	}
	return labels;
}

export type SummaryLookup = (key: string) => string | undefined;

/** Rewrite collapsed labels in place; runs without a summary get the base. */
export function applyThinkingSummaries(
	component: unknown,
	lookup: SummaryLookup = (key) => summaries.get(key),
): void {
	const target = component as HiddenThinkingComponent;
	if (!target?.hideThinkingBlock) return;
	const message = target.lastMessage;
	if (!message || !Array.isArray(message.content)) return;
	if (typeof message.timestamp !== "number") return;

	const labels = labelComponents(target);
	if (labels.length === 0) return;

	const runs = thinkingRuns(message.content as readonly ThinkingBlock[]);
	for (let runIndex = 0; runIndex < runs.length; runIndex++) {
		const label = labels[runIndex];
		if (!label) return;
		const summary = runs[runIndex]
			?.map((index) => lookup(summaryKey(message.timestamp, index)))
			.find((value) => value !== undefined);
		label.setText(summary ? summaryLabel(summary) : THINKING_LABEL);
	}
}

/**
 * Wrap `updateContent` so every re-render re-applies the summaries. The
 * original runs first: it rebuilds the collapsed labels from the global label
 * text, which is what the matcher above expects to find.
 */
export function installThinkingSummaryPatch(
	component: typeof AssistantMessageComponent = AssistantMessageComponent,
): void {
	const proto = component.prototype as unknown as Record<PropertyKey, any>;
	if (proto[PATCH_SYMBOL]) return;
	const original = proto.updateContent;
	if (typeof original !== "function") return;
	proto[PATCH_SYMBOL] = true;
	proto.updateContent = function patchedUpdateContent(
		this: unknown,
		...args: unknown[]
	): void {
		original.apply(this, args);
		try {
			applyThinkingSummaries(this);
		} catch {
			// Rendering must never break because of this optional patch.
		}
	};
}

/** Fast profile model, resolved from the profile the session model belongs to. */
export function fastModel(
	ctx: Pick<ExtensionContext, "model" | "modelRegistry">,
): Model<any> | undefined {
	const config = loadProfileConfig();
	if (!config || !ctx.model) return undefined;
	const ref = profileFor(config, ctx.model)?.fast?.model;
	if (!ref) return undefined;
	const slash = ref.indexOf("/");
	if (slash === -1) return undefined;
	return ctx.modelRegistry.find(ref.slice(0, slash), ref.slice(slash + 1));
}

async function requestSummary(
	ctx: ExtensionContext,
	key: string,
	model: Model<any>,
	thinking: string,
): Promise<void> {
	inFlight += 1;
	try {
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
		if (!auth.ok) return;
		const response = await completeWithoutThinking(
			model,
			{
				messages: [
					{
						role: "user",
						content: buildSummaryPrompt(thinking),
						timestamp: Date.now(),
					},
				],
			},
			{
				apiKey: auth.apiKey,
				headers: auth.headers,
				signal: ctx.signal,
				maxTokens: SUMMARY_MAX_TOKENS,
				cacheRetention: "none",
			},
		);
		const summary = cleanSummary(contentText(response.content, " "));
		if (summary) summaries.set(key, summary);
	} catch {
		// A failed summary leaves the plain label in place.
	} finally {
		inFlight -= 1;
	}
}

/**
 * One completion with reasoning off.
 *
 * Every adapter except the codex transport disables thinking when the
 * `reasoning` option is absent, so it is simply left out. The codex transport
 * drops an `off` level instead of sending an effort, which would fall back to
 * the backend default, so that API is called directly with
 * `reasoningEffort: "none"` — the value its off level maps to on the responses
 * transports.
 */
async function completeWithoutThinking(
	model: Model<any>,
	context: Context,
	options: SimpleStreamOptions,
): Promise<AssistantMessage> {
	if (model.api === "openai-codex-responses") {
		const { stream } = await import(
			"@earendil-works/pi-ai/api/openai-codex-responses"
		);
		return stream(model as Model<"openai-codex-responses">, context, {
			...options,
			reasoningEffort: "none",
		} as never).result();
	}
	const { completeSimple } = await import("@earendil-works/pi-ai/compat");
	return completeSimple(model, context, options);
}

/**
 * Whether the summary call is guaranteed not to think, read off the pi-ai
 * adapters for an absent `reasoning` option:
 *
 * - `anthropic-messages`, `bedrock-converse-stream`,
 *   `mistral-conversations`: no thinking parameter is sent at all.
 * - `openai-responses`, `azure-openai-responses`: effort falls back to
 *   `thinkingLevelMap.off ?? "none"`; a `null` off means the model cannot
 *   disable it, and github-copilot skips that fallback entirely.
 * - `openai-completions`: the `zai`, `qwen`, `qwen-chat-template`, and
 *   `together` formats send an explicit disable flag; every other format
 *   relies on a string `thinkingLevelMap.off`.
 * - `openai-codex-responses`: forced to `effort: "none"` explicitly.
 *
 * Anything else (Google, pi-messages, cloudflare, custom APIs) has no
 * verifiable way to silence reasoning, so it is not used as a summarizer.
 */
export function canSilenceThinking(
	model: Pick<
		Model<any>,
		"api" | "provider" | "reasoning" | "thinkingLevelMap" | "compat"
	>,
): boolean {
	if (!model.reasoning) return true;
	if (model.api === "openai-codex-responses") return true;
	if (SILENT_WHEN_UNSET.has(model.api)) return true;

	const off = model.thinkingLevelMap?.off;
	if (OFF_WHEN_UNSET.has(model.api)) {
		return model.provider !== "github-copilot" && off !== null;
	}
	if (model.api === "openai-completions") {
		const format = (model.compat as { thinkingFormat?: string } | undefined)
			?.thinkingFormat;
		if (format && EXPLICIT_DISABLE_FORMATS.has(format)) return true;
		return off !== null;
	}
	return false;
}

export default function thinkingSummary(pi: ExtensionAPI): void {
	installThinkingSummaryPatch();

	pi.on("session_start", (_event, ctx) => {
		summaries.clear();
		if (!ctx.hasUI) return;
		// Runs after QOL's session_start handler, replacing its glyph label.
		ctx.ui.setHiddenThinkingLabel(THINKING_LABEL);
	});

	pi.on("message_update", (event, ctx) => {
		const update = event.assistantMessageEvent;
		if (update?.type !== "thinking_end") return;
		if (!ctx.hasUI || inFlight >= MAX_IN_FLIGHT) return;

		const partial = update.partial;
		if (!needsSummary(partial?.api, update.content ?? "")) return;

		const key = summaryKey(partial.timestamp, update.contentIndex);
		if (summaries.has(key)) return;
		const model = fastModel(ctx);
		if (!model || !canSilenceThinking(model)) return;

		void requestSummary(
			ctx,
			key,
			model,
			(update.content ?? "").trim().slice(0, MAX_SUMMARY_INPUT_CHARS),
		);
	});
}
