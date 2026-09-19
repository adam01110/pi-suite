import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
	AssistantMessageComponent,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

/**
 * Collapsed thinking blocks: a random verb plus the elapsed time.
 *
 * pi renders every collapsed thinking run with one global label, set through
 * `ctx.ui.setHiddenThinkingLabel`. Two behaviors sit on top of that:
 *
 * - The global label is replaced with plain text, dropping the nerd-font glyph
 *   the QOL module installs by default.
 * - Each collapsed run gets its own label: a word picked from
 *   {@link THINKING_WORDS} for that run, followed by how long the run has been
 *   streaming (`pondering 3.4s`). The duration freezes once the run ends.
 *
 * Live durations need no timer of their own: pi re-renders the streaming
 * component on every delta, and the label is rewritten from the wrapped
 * `updateContent` each time. Run state is keyed by (message timestamp, first
 * content index of the run), so re-renders, mouse toggles, and replayed
 * histories all resolve to the same word and duration.
 *
 * Histories replayed from a session file keep their word and lose the
 * duration: only live runs are timed.
 */

/** Global label, used as the fallback and as the matcher's expected text. */
export const THINKING_LABEL = "thinking";

/**
 * Words for a collapsed run, picked deterministically from the run key so a
 * re-render never changes the word mid-stream. This is Claude Code's spinner
 * verb list, lowercased to match the plain global label.
 */
export const THINKING_WORDS: readonly string[] = [
	"accomplishing",
	"actioning",
	"actualizing",
	"architecting",
	"baking",
	"beaming",
	"beboppin'",
	"befuddling",
	"billowing",
	"blanching",
	"bloviating",
	"boogieing",
	"boondoggling",
	"booping",
	"bootstrapping",
	"brewing",
	"bunning",
	"burrowing",
	"calculating",
	"canoodling",
	"caramelizing",
	"cascading",
	"catapulting",
	"cerebrating",
	"channeling",
	"channelling",
	"choreographing",
	"churning",
	"clauding",
	"coalescing",
	"cogitating",
	"combobulating",
	"composing",
	"computing",
	"concocting",
	"considering",
	"contemplating",
	"cooking",
	"crafting",
	"creating",
	"crunching",
	"crystallizing",
	"cultivating",
	"deciphering",
	"deliberating",
	"determining",
	"dilly-dallying",
	"discombobulating",
	"doing",
	"doodling",
	"drizzling",
	"ebbing",
	"effecting",
	"elucidating",
	"embellishing",
	"enchanting",
	"envisioning",
	"evaporating",
	"fermenting",
	"fiddle-faddling",
	"finagling",
	"flambéing",
	"flibbertigibbeting",
	"flowing",
	"flummoxing",
	"fluttering",
	"forging",
	"forming",
	"frolicking",
	"frosting",
	"gallivanting",
	"galloping",
	"garnishing",
	"generating",
	"gesticulating",
	"germinating",
	"gitifying",
	"grooving",
	"gusting",
	"harmonizing",
	"hashing",
	"hatching",
	"herding",
	"honking",
	"hullaballooing",
	"hyperspacing",
	"ideating",
	"imagining",
	"improvising",
	"incubating",
	"inferring",
	"infusing",
	"ionizing",
	"jitterbugging",
	"levitating",
	"lollygagging",
	"manifesting",
	"marinating",
	"meandering",
	"metamorphosing",
	"misting",
	"moonwalking",
	"moseying",
	"mulling",
	"mustering",
	"musing",
	"nebulizing",
	"nesting",
	"newspapering",
	"noodling",
	"nucleating",
	"orbiting",
	"orchestrating",
	"osmosing",
	"perambulating",
	"percolating",
	"perusing",
	"philosophising",
	"photosynthesizing",
	"pollinating",
	"pondering",
	"pontificating",
	"pouncing",
	"precipitating",
	"prestidigitating",
	"processing",
	"proofing",
	"propagating",
	"puttering",
	"puzzling",
	"quantumizing",
	"razzle-dazzling",
	"razzmatazzing",
	"recombobulating",
	"reticulating",
	"roosting",
	"ruminating",
	"sautéing",
	"scampering",
	"schlepping",
	"scurrying",
	"sketching",
	"slithering",
	"smooshing",
	"sock-hopping",
	"spelunking",
	"spinning",
	"sprouting",
	"stewing",
	"sublimating",
	"swirling",
	"swooping",
	"symbioting",
	"synthesizing",
	"tempering",
	"thinking",
	"thundering",
	"tinkering",
	"tomfoolering",
	"topsy-turvying",
	"transfiguring",
	"transmuting",
	"twisting",
	"undulating",
	"unfurling",
	"unravelling",
	"vibing",
	"waddling",
	"wandering",
	"warping",
	"whatchamacalliting",
	"whirlpooling",
	"whirring",
	"whisking",
	"wibbling",
	"working",
	"wrangling",
	"zesting",
	"zigzagging",
];

/** Style used for the word and the duration. */
export type LabelTheme = ExtensionContext["ui"]["theme"];

interface LabelTarget {
	setText(text: string): void;
	text: string;
}

/** Minimal shape of the patched component; keeps the seam duck-typed. */
interface HiddenThinkingComponent {
	isStreaming?: boolean;
	hiddenThinkingLabel?: string;
	lastMessage?: AssistantMessage;
	contentContainer?: { children?: unknown[] };
}

type ThinkingBlock = { type: string; thinking?: string };

const PATCH_SYMBOL = Symbol.for("pi-suite.thinking-label.patch");

/** Per-run timing, keyed by `timestamp:firstContentIndex`. */
interface RunTiming {
	startedAt?: number;
	durationMs?: number;
}

const timings = new Map<string, RunTiming>();
let currentTheme: LabelTheme | undefined;

/** Drop every recorded run timing and the cached theme. */
export function resetTimings(): void {
	timings.clear();
	currentTheme = undefined;
}

export function runKey(timestamp: number, contentIndex: number): string {
	return `${timestamp}:${contentIndex}`;
}

/** FNV-1a over the run key; stable across renders and processes. */
export function wordFor(seed: string): string {
	let hash = 2166136261;
	for (let i = 0; i < seed.length; i++) {
		hash ^= seed.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return THINKING_WORDS[(hash >>> 0) % THINKING_WORDS.length] as string;
}

/** `3.4s` under a minute, `1:02.3` above it. */
export function formatElapsed(ms: number): string {
	const totalSeconds = Math.max(0, ms) / 1000;
	if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds - minutes * 60;
	return `${minutes}:${seconds.toFixed(1).padStart(4, "0")}`;
}

/** `word`, or `word 3.4s` once a duration is known. */
export function labelText(
	word: string,
	elapsedMs: number | undefined,
	theme: LabelTheme | undefined = currentTheme,
): string {
	const suffix = elapsedMs === undefined ? "" : ` ${formatElapsed(elapsedMs)}`;
	if (!theme) return `${word}${suffix}`;
	const base = theme.italic(theme.fg("muted", word));
	return elapsedMs === undefined ? base : `${base}${theme.fg("dim", suffix)}`;
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

/**
 * First content index of the thinking run containing `index`. Streaming events
 * report the block that changed, which is the last block of a run once it has
 * grown, so both ends of a run must resolve to the same key.
 */
export function runStartIndex(
	content: readonly ThinkingBlock[],
	index: number,
): number {
	let start = Math.max(0, Math.min(index, content.length - 1));
	while (start > 0 && content[start - 1]?.type === "thinking") start--;
	return start;
}

/** SGR sequences; built from a char code to keep the literal control char out. */
const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

function stripAnsi(text: string): string {
	return text.replace(ANSI_PATTERN, "");
}

function isLabelText(text: string, expected: string): boolean {
	const plain = stripAnsi(text);
	if (expected && plain === expected) return true;
	return plain === THINKING_LABEL;
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

/**
 * Collapsed labels paired with their thinking run.
 *
 * pi renders every thinking run as one child: a `MouseRegion` around the
 * collapsed label, or around the expanded `Markdown`. Runs are therefore
 * counted in child order, which keeps the mapping right when only some runs
 * are collapsed (per-block mouse toggles do not change the global setting).
 */
function labelComponents(
	component: HiddenThinkingComponent,
): Array<{ runIndex: number; target: LabelTarget }> {
	const children = component.contentContainer?.children;
	if (!Array.isArray(children)) return [];
	const expected = stripAnsi(component.hiddenThinkingLabel ?? "");
	const labels: Array<{ runIndex: number; target: LabelTarget }> = [];
	let runIndex = 0;
	for (const child of children) {
		const wrapped = (child as { child?: unknown } | undefined)?.child;
		const target = labelTarget(child, expected);
		if (target) labels.push({ runIndex, target });
		if (wrapped !== undefined || target) runIndex++;
	}
	return labels;
}

/** Elapsed time to show for a run, or undefined when nothing is timed. */
function elapsedFor(
	timing: RunTiming | undefined,
	live: boolean,
	now: number,
): number | undefined {
	if (!timing) return undefined;
	if (timing.durationMs !== undefined) return timing.durationMs;
	if (!live || timing.startedAt === undefined) return undefined;
	return now - timing.startedAt;
}

/** Rewrite collapsed labels in place with word plus duration. */
export function applyThinkingLabels(
	component: unknown,
	now: number = Date.now(),
): void {
	const target = component as HiddenThinkingComponent;
	const message = target?.lastMessage;
	if (!message || !Array.isArray(message.content)) return;
	if (typeof message.timestamp !== "number") return;

	const labels = labelComponents(target);
	if (labels.length === 0) return;

	const runs = thinkingRuns(message.content as readonly ThinkingBlock[]);
	const streaming = target.isStreaming === true;
	for (const { runIndex, target: label } of labels) {
		const first = runs[runIndex]?.[0];
		if (first === undefined) {
			label.setText(THINKING_LABEL);
			continue;
		}
		const key = runKey(message.timestamp, first);
		const word = wordFor(key);
		// Only the last run can still be streaming; earlier runs are settled.
		const live = streaming && runIndex === runs.length - 1;
		label.setText(labelText(word, elapsedFor(timings.get(key), live, now)));
	}
}

/**
 * Wrap `updateContent` so every re-render re-applies the labels. The original
 * runs first: it rebuilds the collapsed labels from the global label text,
 * which is what the matcher above expects to find.
 */
export function installThinkingLabelPatch(
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
			applyThinkingLabels(this);
		} catch {
			// Rendering must never break because of this optional patch.
		}
	};
}

function timingFor(key: string): RunTiming {
	let timing = timings.get(key);
	if (!timing) {
		timing = {};
		timings.set(key, timing);
	}
	return timing;
}

/** Start the clock for a run; a replay of the same run keeps its duration. */
export function startTiming(timestamp: number, contentIndex: number): void {
	const timing = timingFor(runKey(timestamp, contentIndex));
	if (timing.startedAt !== undefined || timing.durationMs !== undefined) return;
	timing.startedAt = Date.now();
}

/** Freeze the clock for a run. */
export function finishTiming(
	timestamp: number,
	contentIndex: number,
	now: number = Date.now(),
): void {
	const timing = timings.get(runKey(timestamp, contentIndex));
	if (!timing || timing.startedAt === undefined) return;
	timing.durationMs = Math.max(0, now - timing.startedAt);
	timing.startedAt = undefined;
}

export default function thinkingLabel(pi: ExtensionAPI): void {
	installThinkingLabelPatch();

	pi.on("session_start", (_event, ctx) => {
		resetTimings();
		currentTheme = ctx.hasUI ? ctx.ui.theme : undefined;
		if (!ctx.hasUI) return;
		// Runs after QOL's session_start handler, replacing its glyph label.
		ctx.ui.setHiddenThinkingLabel(THINKING_LABEL);
	});

	pi.on("message_update", (event, ctx) => {
		if (!ctx.hasUI) return;
		const update = event.assistantMessageEvent;
		if (update.type !== "thinking_start" && update.type !== "thinking_end") {
			return;
		}
		const timestamp = update.partial?.timestamp;
		if (typeof timestamp !== "number") return;
		const index = runStartIndex(
			(update.partial?.content ?? []) as readonly ThinkingBlock[],
			update.contentIndex,
		);
		if (update.type === "thinking_start") startTiming(timestamp, index);
		else finishTiming(timestamp, index);
	});

	// A run whose end event never arrived still freezes at message end.
	pi.on("message_end", (event) => {
		const message = event.message as AssistantMessage | undefined;
		if (message?.role !== "assistant" || !Array.isArray(message.content)) {
			return;
		}
		if (typeof message.timestamp !== "number") return;
		for (const run of thinkingRuns(
			message.content as readonly ThinkingBlock[],
		)) {
			for (const index of run) finishTiming(message.timestamp, index);
		}
	});
}
