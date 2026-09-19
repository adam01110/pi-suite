import { beforeEach, describe, expect, test } from "bun:test";
import type { AssistantMessage, ThinkingContent } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import thinkingLabel, {
	applyThinkingLabels,
	finishTiming,
	formatElapsed,
	installThinkingLabelPatch,
	labelText,
	resetTimings,
	runKey,
	runStartIndex,
	startTiming,
	THINKING_LABEL,
	THINKING_WORDS,
	thinkingRuns,
	wordFor,
} from "../src/glue/thinking-label.js";

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

const theme = {
	fg: (color: string, text: string) => `${color}:${text}`,
	italic: (text: string) => `<i>${text}</i>`,
} as unknown as ExtensionContext["ui"]["theme"];

class FakeComponent {
	isStreaming = true;
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
const text = (value: string) => ({ type: "text", text: value });

const CONTENT = [
	thinking("first block"),
	text("answer"),
	thinking("second"),
] as AssistantMessage["content"];

// Run timings live in module state, so each test starts from a clean map.
beforeEach(resetTimings);

describe("word selection", () => {
	test("holds Claude Code's 179 spinner verbs, all distinct and lowercase", () => {
		expect(THINKING_WORDS).toHaveLength(179);
		expect(new Set(THINKING_WORDS).size).toBe(179);
		for (const word of THINKING_WORDS) {
			expect(word).toBe(word.toLowerCase());
			expect(word).not.toMatch(/\s/);
		}
	});

	test("is stable for one run key and inside the word list", () => {
		const first = wordFor(runKey(1_700_000_000_000, 0));
		const second = wordFor(runKey(1_700_000_000_000, 0));

		expect(first).toBe(second);
		expect(THINKING_WORDS).toContain(first);
	});

	test("spreads distinct keys over more than one word", () => {
		const words = new Set(
			Array.from({ length: 40 }, (_, i) => wordFor(runKey(1, i))),
		);

		expect(words.size).toBeGreaterThan(3);
	});
});

describe("elapsed formatting", () => {
	test("uses seconds under a minute", () => {
		expect(formatElapsed(0)).toBe("0.0s");
		expect(formatElapsed(3_440)).toBe("3.4s");
		expect(formatElapsed(59_950)).toBe("60.0s");
	});

	test("switches to minutes:seconds above that", () => {
		expect(formatElapsed(62_300)).toBe("1:02.3");
		expect(formatElapsed(600_000)).toBe("10:00.0");
	});

	test("clamps negative durations", () => {
		expect(formatElapsed(-500)).toBe("0.0s");
	});
});

describe("label text", () => {
	test("shows the word alone without a duration", () => {
		expect(labelText("pondering", undefined, undefined)).toBe("pondering");
	});

	test("appends the duration", () => {
		expect(labelText("pondering", 3_400, undefined)).toBe("pondering 3.4s");
	});

	test("styles the word muted and the duration dim", () => {
		expect(labelText("pondering", 3_400, theme)).toBe(
			"<i>muted:pondering</i>dim: 3.4s",
		);
		expect(labelText("pondering", undefined, theme)).toBe(
			"<i>muted:pondering</i>",
		);
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

describe("runStartIndex", () => {
	test("resolves any block of a run to its first block", () => {
		const content = [thinking("a"), thinking("b"), text("x"), thinking("c")];

		expect(runStartIndex(content, 0)).toBe(0);
		expect(runStartIndex(content, 1)).toBe(0);
		expect(runStartIndex(content, 3)).toBe(3);
	});

	test("stays inside the content bounds", () => {
		expect(runStartIndex([], 5)).toBe(0);
		expect(runStartIndex([thinking("a")], 9)).toBe(0);
	});
});

describe("collapsed label application", () => {
	test("labels every collapsing run with its own word", () => {
		const first = new FakeText(THINKING_LABEL);
		const second = new FakeText(THINKING_LABEL);
		const component = new FakeComponent(CONTENT, [
			new FakeRegion(first),
			{ notALabel: true },
			new FakeRegion(second),
		]);

		applyThinkingLabels(component);

		const timestamp = component.lastMessage.timestamp;
		expect(first.text).toBe(wordFor(runKey(timestamp, 0)));
		expect(second.text).toBe(wordFor(runKey(timestamp, 2)));
	});

	test("finds labels wrapped in a mouse region and already styled", () => {
		const label = new FakeText(`\u001b[3m${THINKING_LABEL}\u001b[39m`);
		const component = new FakeComponent(CONTENT, [new FakeRegion(label)]);

		applyThinkingLabels(component);

		expect(label.text).toBe(
			wordFor(runKey(component.lastMessage.timestamp, 0)),
		);
	});

	test("shows the frozen duration of a finished run", () => {
		const label = new FakeText(THINKING_LABEL);
		const component = new FakeComponent(CONTENT, [new FakeRegion(label)]);
		const timestamp = component.lastMessage.timestamp;

		startTiming(timestamp, 0);
		finishTiming(timestamp, 0, Date.now() + 2_500);
		applyThinkingLabels(component);

		expect(label.text).toBe(`${wordFor(runKey(timestamp, 0))} 2.5s`);
	});

	test("counts only the last run as live", () => {
		const first = new FakeText(THINKING_LABEL);
		const second = new FakeText(THINKING_LABEL);
		const component = new FakeComponent(CONTENT, [
			new FakeRegion(first),
			new FakeRegion(second),
		]);
		const timestamp = component.lastMessage.timestamp;
		const now = Date.now();

		startTiming(timestamp, 0);
		startTiming(timestamp, 2);
		applyThinkingLabels(component, now + 1_000);

		// The settled run renders its word only; the live one carries the clock.
		expect(first.text).toBe(wordFor(runKey(timestamp, 0)));
		expect(second.text).toBe(`${wordFor(runKey(timestamp, 2))} 1.0s`);
	});

	test("drops the duration for a replayed history", () => {
		const label = new FakeText(THINKING_LABEL);
		const component = new FakeComponent(CONTENT, [new FakeRegion(label)]);
		component.isStreaming = false;
		const timestamp = component.lastMessage.timestamp;

		startTiming(timestamp, 0);
		applyThinkingLabels(component);

		expect(label.text).toBe(wordFor(runKey(timestamp, 0)));
	});

	test("falls back to the plain label when a run is missing", () => {
		const orphan = new FakeText(THINKING_LABEL);
		const component = new FakeComponent([], [new FakeRegion(orphan)]);

		applyThinkingLabels(component);

		expect(orphan.text).toBe(THINKING_LABEL);
	});

	test("leaves containers without collapsed labels alone", () => {
		const body = new FakeText("answer body");
		const none = new FakeComponent(CONTENT, [body]);
		expect(() => applyThinkingLabels(none)).not.toThrow();
		expect(body.text).toBe("answer body");

		expect(() =>
			applyThinkingLabels(new FakeComponent(CONTENT, [])),
		).not.toThrow();
	});

	test("survives a component whose container is malformed", () => {
		const component = new FakeComponent([thinking("first")], []);
		component.contentContainer = {} as { children: unknown[] };

		expect(() => applyThinkingLabels(component)).not.toThrow();
	});
});

describe("updateContent patch", () => {
	test("wraps the prototype once and applies labels after the original", () => {
		class Component extends FakeComponent {
			constructor() {
				super([thinking("first block")], [new FakeText(THINKING_LABEL)]);
			}
		}
		const asAssistant = Component as unknown as Parameters<
			typeof installThinkingLabelPatch
		>[0];
		installThinkingLabelPatch(asAssistant);
		installThinkingLabelPatch(asAssistant);

		const component = new Component();
		component.updateContent();

		expect(component.updateContentCalls).toBe(1);
		const label = (component.contentContainer.children[0] as FakeText).text;
		expect(label).toBe(wordFor(runKey(component.lastMessage.timestamp, 0)));
	});
});

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;

function setup() {
	const handlers = new Map<string, Handler>();
	const labels: Array<string | undefined> = [];
	const pi = {
		on(name: string, handler: Handler) {
			handlers.set(name, handler);
		},
	} as unknown as ExtensionAPI;
	const ctx = {
		hasUI: true,
		ui: {
			theme,
			setHiddenThinkingLabel: (label?: string) => labels.push(label),
		},
	} as unknown as ExtensionContext;

	thinkingLabel(pi);
	return { ctx, handlers, labels };
}

const update = (type: string, contentIndex: number, content: unknown[]) => ({
	type: "message_update",
	assistantMessageEvent: {
		type,
		contentIndex,
		content: "body",
		partial: { timestamp: 1_700_000_000_000, content },
	},
});

describe("session wiring", () => {
	test("replaces the global label and clears timings on session start", () => {
		const { ctx, handlers, labels } = setup();
		startTiming(1, 0);

		handlers.get("session_start")?.({}, ctx);

		expect(labels).toEqual([THINKING_LABEL]);
	});

	test("does not touch the label without UI", () => {
		const { ctx, handlers, labels } = setup();
		ctx.hasUI = false;

		handlers.get("session_start")?.({}, ctx);

		expect(labels).toEqual([]);
	});

	test("keys the timer by the first block of the run", () => {
		const { ctx, handlers } = setup();
		const content = [thinking("a"), thinking("b")];
		const now = Date.now();

		// The event reports the block that changed, the second one here.
		handlers.get("message_update")?.(update("thinking_start", 1, content), ctx);

		const label = new FakeText(THINKING_LABEL);
		const component = new FakeComponent(
			content as AssistantMessage["content"],
			[new FakeRegion(label)],
		);
		component.lastMessage.timestamp = 1_700_000_000_000;
		applyThinkingLabels(component, now + 1_200);

		expect(label.text).toBe(`${wordFor(runKey(1_700_000_000_000, 0))} 1.2s`);
	});

	test("ignores streaming events without a timestamp", () => {
		const { ctx, handlers } = setup();
		const event = update("thinking_start", 0, [thinking("a")]);
		(event.assistantMessageEvent.partial as { timestamp?: number }).timestamp =
			undefined;

		expect(() => handlers.get("message_update")?.(event, ctx)).not.toThrow();
	});

	test("freezes every run at message end", () => {
		const { ctx, handlers } = setup();
		const content = [thinking("a"), text("x"), thinking("b")];
		handlers.get("message_update")?.(
			update("thinking_start", 0, [thinking("a")]),
			ctx,
		);
		handlers.get("message_update")?.(
			update("thinking_start", 2, [thinking("a"), text("x"), thinking("b")]),
			ctx,
		);

		handlers.get("message_end")?.(
			{
				type: "message_end",
				message: { role: "assistant", content, timestamp: 1_700_000_000_000 },
			},
			ctx,
		);

		const labels = [new FakeText(THINKING_LABEL), new FakeText(THINKING_LABEL)];
		const component = new FakeComponent(
			content as AssistantMessage["content"],
			[new FakeRegion(labels[0]), new FakeRegion(labels[1])],
		);
		component.isStreaming = false;
		applyThinkingLabels(component);

		expect(labels[0]?.text).toMatch(/^[a-z]+ \d+\.\ds$/);
		expect(labels[1]?.text).toMatch(/^[a-z]+ \d+\.\ds$/);
	});

	test("ignores non-assistant messages at message end", () => {
		const { ctx, handlers } = setup();

		expect(() =>
			handlers.get("message_end")?.(
				{ type: "message_end", message: { role: "user", content: [] } },
				ctx,
			),
		).not.toThrow();
	});
});
