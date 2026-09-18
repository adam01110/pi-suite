import { describe, expect, mock, test } from "bun:test";
import type {
	AssistantMessage,
	TextContent,
	ThinkingContent,
} from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import thinkingSummary, {
	applyThinkingSummaries,
	buildSummaryPrompt,
	canSilenceThinking,
	cleanSummary,
	installThinkingSummaryPatch,
	needsSummary,
	providerSendsSummaries,
	summaryKey,
	summaryLabel,
	THINKING_LABEL,
	thinkingRuns,
} from "../src/glue/thinking-summary.js";

/** Stands in for pi-tui's Text: only the fields the label matcher reads. */
class FakeText {
	constructor(public text: string) {}
	setText(text: string): void {
		this.text = text;
	}
}

/** Stands in for pi-tui's MouseRegion, which wraps a component verbatim. */
class FakeRegion {
	constructor(public child: unknown) {}
}

class FakeComponent {
	hideThinkingBlock = true;
	hiddenThinkingLabel = THINKING_LABEL;
	contentContainer: { children: unknown[] };
	lastMessage: AssistantMessage;
	updateContentCalls = 0;

	constructor(content: AssistantMessage["content"], labels: unknown[]) {
		this.lastMessage = {
			role: "assistant",
			content,
			api: "anthropic-messages",
			provider: "anthropic",
			model: "claude",
			usage: {},
			stopReason: "stop",
			timestamp: 1_700_000_000_000,
		} as unknown as AssistantMessage;
		this.contentContainer = { children: labels };
	}

	updateContent(): void {
		this.updateContentCalls += 1;
	}
}

const thinking = (value: string): ThinkingContent => ({
	type: "thinking",
	thinking: value,
});
const text = (value: string): TextContent => ({ type: "text", text: value });

describe("provider summary detection", () => {
	test("skips APIs that already return reasoning summaries", () => {
		for (const api of [
			"openai-responses",
			"openai-codex-responses",
			"azure-openai-responses",
			"google-generative-ai",
			"google-vertex",
		]) {
			expect(providerSendsSummaries(api)).toBe(true);
		}
	});

	test("summarizes raw-thinking APIs", () => {
		expect(providerSendsSummaries("anthropic-messages")).toBe(false);
		expect(providerSendsSummaries(undefined)).toBe(false);
	});

	test("ignores short blocks", () => {
		const long = "x".repeat(400);
		expect(needsSummary("anthropic-messages", long)).toBe(true);
		expect(needsSummary("anthropic-messages", "short")).toBe(false);
		expect(needsSummary("openai-responses", long)).toBe(false);
	});
});

describe("thinkingRuns", () => {
	test("groups consecutive blocks and skips empty runs", () => {
		const content = [
			thinking("first"),
			thinking("second"),
			text("answer"),
			thinking("   "),
			text("more"),
			thinking("third"),
		];

		expect(thinkingRuns(content)).toEqual([[0, 1], [5]]);
	});

	test("counts only non-empty blocks inside a run", () => {
		expect(thinkingRuns([thinking(""), thinking("kept")])).toEqual([[1]]);
		expect(thinkingRuns([thinking(""), thinking(" ")])).toEqual([]);
	});
});

describe("summary text", () => {
	test("flattens and strips model formatting", () => {
		expect(cleanSummary('  "Checks the cache\n paths."  ')).toBe(
			"Checks the cache paths",
		);
		expect(cleanSummary("**Bold**")).toBe("Bold");
		expect(cleanSummary("   ")).toBeUndefined();
	});

	test("truncates overlong summaries", () => {
		const summary = cleanSummary("y".repeat(200)) ?? "";
		expect(summary).toHaveLength(161);
		expect(summary.endsWith("…")).toBe(true);
	});

	test("prefixes the summary with the label", () => {
		expect(summaryLabel("Traced the flash to the loader")).toBe(
			"thinking · Traced the flash to the loader",
		);
	});

	test("asks for one plain line", () => {
		const prompt = buildSummaryPrompt("reasoning body");
		expect(prompt).toContain("at most 15 words");
		expect(prompt.endsWith("reasoning body")).toBe(true);
	});
});

describe("collapsed label application", () => {
	const content = [thinking("first block"), text("answer"), thinking("second")];

	test("labels every collapsing run, summarizing the ones with a summary", () => {
		const first = new FakeText(THINKING_LABEL);
		const second = new FakeText(THINKING_LABEL);
		const component = new FakeComponent(content, [
			new FakeRegion(first),
			{ notALabel: true },
			new FakeRegion(second),
		]);
		const timestamp = component.lastMessage.timestamp;

		applyThinkingSummaries(component, (key) =>
			key === summaryKey(timestamp, 0)
				? "Picked the braille spinner"
				: undefined,
		);

		expect(first.text).toBe("thinking · Picked the braille spinner");
		expect(second.text).toBe(THINKING_LABEL);
	});

	test("finds labels wrapped in a mouse region and colored by styling", () => {
		const label = new FakeText(`\u001b[3m${THINKING_LABEL}\u001b[39m`);
		const component = new FakeComponent(content, [new FakeRegion(label)]);

		applyThinkingSummaries(component, () => "Summary");

		expect(label.text).toBe("thinking · Summary");
	});

	test("replaces a previously applied summary on re-render", () => {
		const label = new FakeText(summaryLabel("Old summary"));
		const component = new FakeComponent(content, [new FakeRegion(label)]);

		applyThinkingSummaries(component, () => "New summary");

		expect(label.text).toBe("thinking · New summary");
	});

	test("leaves expanded thinking and label-less containers alone", () => {
		const label = new FakeText(THINKING_LABEL);
		const expanded = new FakeComponent(content, [new FakeRegion(label)]);
		expanded.hideThinkingBlock = false;
		applyThinkingSummaries(expanded, () => "Summary");
		expect(label.text).toBe(THINKING_LABEL);

		const none = new FakeComponent(content, []);
		expect(() => applyThinkingSummaries(none, () => "Summary")).not.toThrow();
	});
});

describe("updateContent patch", () => {
	test("wraps the prototype once and applies summaries after the original", () => {
		class Component extends FakeComponent {
			constructor() {
				super([thinking("first block")], [new FakeText(THINKING_LABEL)]);
			}
		}
		const asAssistant = Component as unknown as Parameters<
			typeof installThinkingSummaryPatch
		>[0];
		installThinkingSummaryPatch(asAssistant);
		installThinkingSummaryPatch(asAssistant);

		const component = new Component();
		component.updateContent();

		expect(component.updateContentCalls).toBe(1);
		const label = (component.contentContainer.children[0] as FakeText).text;
		expect(label).toBe(THINKING_LABEL);
	});

	test("survives a component whose container is malformed", () => {
		const component = new FakeComponent([thinking("first")], []);
		component.contentContainer = {} as { children: unknown[] };

		expect(() => applyThinkingSummaries(component)).not.toThrow();
	});
});

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;

/** Long enough to pass the minimum-summary threshold. */
const LONG_THINKING = "Analysing the loader path. ".repeat(20);

function sessionModel() {
	return {
		provider: "anthropic",
		id: "claude",
		api: "anthropic-messages",
	};
}

function fastProfileEnv(fast = "openai-codex/gpt-5.6-luna") {
	process.env.PI_SUITE_PROFILE_AGENTS = JSON.stringify({
		coding: {
			session: { model: "anthropic/claude" },
			fast: { model: fast },
		},
	});
}

/** Fast model whose reasoning the adapters can switch off. */
function codexFastModel() {
	return {
		provider: "openai-codex",
		id: "gpt-5.6-luna",
		api: "openai-codex-responses",
		reasoning: true,
		thinkingLevelMap: { minimal: "low", xhigh: "xhigh", max: "max" },
	};
}

function setupSession(api: string, fastModel: unknown = codexFastModel()) {
	const handlers = new Map<string, Handler>();
	const labels: Array<string | undefined> = [];
	const completed: Array<{ model: unknown; options: unknown }> = [];
	const codexStreams: Array<{ model: unknown; options: unknown }> = [];
	const pi = {
		on(name: string, handler: Handler) {
			handlers.set(name, handler);
		},
	} as unknown as ExtensionAPI;
	const ctx = {
		hasUI: true,
		model: sessionModel(),
		signal: undefined,
		modelRegistry: {
			find: () => fastModel,
			getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k", headers: {} }),
		},
		ui: {
			setHiddenThinkingLabel: (label?: string) => labels.push(label),
		},
	} as unknown as ExtensionContext;

	mock.module("@earendil-works/pi-ai/compat", () => ({
		completeSimple: async (
			model: unknown,
			_context: unknown,
			options: unknown,
		) => {
			completed.push({ model, options });
			return { content: [{ type: "text", text: "Pick the braille spinner" }] };
		},
	}));
	mock.module("@earendil-works/pi-ai/api/openai-codex-responses", () => ({
		stream: (model: unknown, _context: unknown, options: unknown) => {
			codexStreams.push({ model, options });
			return {
				result: async () => ({
					content: [{ type: "text", text: "Pick the braille spinner" }],
				}),
			};
		},
	}));

	thinkingSummary(pi);
	const partial = {
		api,
		timestamp: 1_700_000_000_000,
	} as unknown as AssistantMessage;
	const fire = (content: string) =>
		handlers.get("message_update")?.(
			{
				type: "message_update",
				assistantMessageEvent: {
					type: "thinking_end",
					contentIndex: 0,
					content,
					partial,
				},
			},
			ctx,
		);
	return { codexStreams, completed, ctx, fire, handlers, labels, partial };
}

const settle = async () => {
	for (let i = 0; i < 20; i++) await new Promise((done) => setTimeout(done, 0));
};

describe("thinking summary session", () => {
	test("labels collapsed blocks with plain text instead of a glyph", async () => {
		fastProfileEnv();
		const { ctx, labels, handlers } = setupSession("anthropic-messages");

		await handlers.get("session_start")?.({}, ctx);

		expect(labels).toEqual([THINKING_LABEL]);
	});

	test("summarizes a finished block with the codex fast model, thinking off", async () => {
		fastProfileEnv();
		const { codexStreams, completed, ctx, fire, handlers, partial } =
			setupSession("anthropic-messages");
		await handlers.get("session_start")?.({}, ctx);

		fire(LONG_THINKING);
		await settle();

		// The codex transport drops an off level, so the effort is forced.
		expect(completed).toEqual([]);
		expect(codexStreams).toHaveLength(1);
		expect((codexStreams[0]?.model as { id: string } | undefined)?.id).toBe(
			"gpt-5.6-luna",
		);
		expect(codexStreams[0]?.options).toMatchObject({
			apiKey: "k",
			cacheRetention: "none",
			maxTokens: 80,
			reasoningEffort: "none",
		});

		// The summary lands on the collapsed label of that block.
		const label = new FakeText(THINKING_LABEL);
		const component = new FakeComponent(
			[thinking(LONG_THINKING)],
			[new FakeRegion(label)],
		);
		component.lastMessage.timestamp = partial.timestamp;
		applyThinkingSummaries(component);
		expect(label.text).toBe("thinking · Pick the braille spinner");
	});

	test("omits reasoning for adapters that disable thinking when unset", async () => {
		fastProfileEnv("anthropic/claude-haiku");
		const { codexStreams, completed, ctx, fire, handlers } = setupSession(
			"anthropic-messages",
			{
				provider: "anthropic",
				id: "claude-haiku",
				api: "anthropic-messages",
				reasoning: true,
			},
		);
		await handlers.get("session_start")?.({}, ctx);

		fire(LONG_THINKING);
		await settle();

		expect(codexStreams).toEqual([]);
		expect(completed).toHaveLength(1);
		const options = completed[0]?.options as Record<string, unknown>;
		expect(options).toMatchObject({ cacheRetention: "none", maxTokens: 80 });
		expect("reasoning" in options).toBe(false);
	});

	test("skips providers that already return reasoning summaries", async () => {
		fastProfileEnv();
		const { codexStreams, completed, ctx, fire, handlers } =
			setupSession("openai-responses");
		await handlers.get("session_start")?.({}, ctx);

		fire(LONG_THINKING);
		await settle();

		expect(completed).toEqual([]);
		expect(codexStreams).toEqual([]);
	});

	test("skips fast models whose reasoning cannot be switched off", async () => {
		fastProfileEnv("google/gemini-flash");
		const { codexStreams, completed, ctx, fire, handlers } = setupSession(
			"anthropic-messages",
			{
				provider: "google",
				id: "gemini-flash",
				api: "google-generative-ai",
				reasoning: true,
			},
		);
		await handlers.get("session_start")?.({}, ctx);

		fire(LONG_THINKING);
		await settle();

		expect(completed).toEqual([]);
		expect(codexStreams).toEqual([]);
	});

	test("ignores blocks too short to summarize", async () => {
		fastProfileEnv();
		const { codexStreams, completed, ctx, fire, handlers } =
			setupSession("anthropic-messages");
		await handlers.get("session_start")?.({}, ctx);

		fire("quick check");
		await settle();

		expect(completed).toEqual([]);
		expect(codexStreams).toEqual([]);
	});
});

describe("canSilenceThinking", () => {
	const model = (over: Record<string, unknown>) =>
		({
			api: "anthropic-messages",
			provider: "anthropic",
			reasoning: true,
			...over,
		}) as never;

	test("allows models without reasoning", () => {
		expect(canSilenceThinking(model({ reasoning: false }))).toBe(true);
	});

	test("allows adapters that send no thinking parameter when unset", () => {
		for (const api of [
			"anthropic-messages",
			"bedrock-converse-stream",
			"mistral-conversations",
		]) {
			expect(canSilenceThinking(model({ api }))).toBe(true);
		}
	});

	test("allows the codex transport, which is forced to effort none", () => {
		expect(canSilenceThinking(model({ api: "openai-codex-responses" }))).toBe(
			true,
		);
	});

	test("rejects responses models that cannot disable reasoning", () => {
		expect(
			canSilenceThinking(
				model({
					api: "openai-responses",
					provider: "openai",
					thinkingLevelMap: { off: null },
				}),
			),
		).toBe(false);
		expect(
			canSilenceThinking(
				model({
					api: "openai-responses",
					provider: "github-copilot",
					thinkingLevelMap: { off: "none" },
				}),
			),
		).toBe(false);
	});

	test("falls back to the off effort on responses models that allow it", () => {
		expect(
			canSilenceThinking(
				model({
					api: "openai-responses",
					provider: "openai",
					thinkingLevelMap: { minimal: "low" },
				}),
			),
		).toBe(true);
	});

	test("uses explicit disable formats for openai-completions", () => {
		expect(
			canSilenceThinking(
				model({
					api: "openai-completions",
					compat: { thinkingFormat: "qwen" },
				}),
			),
		).toBe(true);
	});

	test("needs a string off level elsewhere", () => {
		const completions = (over: Record<string, unknown>) =>
			model({ api: "openai-completions", provider: "opencode-go", ...over });

		// deepseek-v4-flash: no off in the map, adapter sends thinking: disabled.
		expect(
			canSilenceThinking(
				completions({ compat: { thinkingFormat: "deepseek" } }),
			),
		).toBe(true);
		// glm-5.3-flash: off is null and no disable format, so it keeps thinking.
		expect(
			canSilenceThinking(completions({ thinkingLevelMap: { off: null } })),
		).toBe(false);
	});

	test("rejects APIs with no verifiable way to silence reasoning", () => {
		for (const api of ["google-generative-ai", "pi-messages"]) {
			expect(canSilenceThinking(model({ api }))).toBe(false);
		}
	});
});
