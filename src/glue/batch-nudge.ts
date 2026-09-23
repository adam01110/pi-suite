import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Weak models (glm, deepseek, ...) batch once under instruction pressure and
 * then decay back into one call per assistant message. Prompt-only nudges are
 * not enough, so the pattern gets blocked instead:
 *
 * - chained bash: `;`, `&&`, `||`, or a newline in a bash command, whether the
 *   command is a solo call or an entry inside a tool_batch. Several commands
 *   belong in separate tool_batch entries, not glued into one shell line. The
 *   nudge carries the rewritten tool_batch call so the model can copy it.
 * - serial probing: a solo read/grep/find/ls/bash call right after another solo
 *   call of the same tool. Same tool only: a grep -> read chain is usually
 *   dependent on the previous result.
 * - separate parallel probes: two or more read/grep/find/ls/bash calls in one
 *   message. They run, but as separate entries: one tool_batch call renders as
 *   a single stack and shares the aggregate output cap.
 *
 * Every such call is blocked, except calls in the message that directly
 * follows a blocked one: that is the re-issue, and letting it run is what keeps
 * the model from looping on the nudge instead of making progress. Chained bash
 * is the exception: a chained call is never a legitimate single probe, so the
 * re-issue exemption does not apply and it is blocked again until the model
 * either splits it or hits the escape hatch (same command blocked
 * MAX_CHAINED_BLOCKS times). A tool_batch call, a non-probe tool, or a user
 * turn ends the run.
 */
const NUDGE_REASON =
	"Serial or separate probing blocked. Put the independent read/grep/find/ls/bash calls in ONE tool_batch call with {tool, args} entries instead of one call per message. If this call depends on the previous result, re-issue it unchanged and it will run.";

const PROBE_TOOLS = new Set([
	// keep-sorted start
	"bash",
	"find",
	"grep",
	"ls",
	"read",
	// keep-sorted end
]);

const BATCH_TOOL = "tool_batch";

/** Blocked entry ids are remembered only to let the next call through. */
const MAX_REMEMBERED_BLOCKS = 500;

/**
 * How often one chained command may be blocked before it is let through. The
 * second nudge carries the rewrite, so a model that ignores both is looping and
 * blocking forever would only stall the turn.
 */
const MAX_CHAINED_BLOCKS = 2;

/** Caps on the rewrite embedded in the chained-bash nudge. */
const MAX_REASON_SEGMENTS = 8;
const MAX_SEGMENT_CHARS = 160;

interface ToolCallContent {
	arguments?: unknown;
	id: string;
	name: string;
	type: "toolCall";
}

type SessionEntryLike = {
	id: string;
	type: string;
	message?: { content?: unknown; role?: string };
};

type Classification =
	| { kind: "batched" }
	| { kind: "probe"; tool: string }
	| { kind: "separate" }
	| { kind: "skip" };

function toolCalls(message: SessionEntryLike["message"]): ToolCallContent[] {
	const content = message?.content;
	if (!Array.isArray(content)) return [];
	return content.filter(
		(item): item is ToolCallContent =>
			typeof item === "object" &&
			item !== null &&
			(item as ToolCallContent).type === "toolCall",
	);
}

function batchSize(call: ToolCallContent): number {
	const input = call.arguments;
	if (typeof input !== "object" || input === null) return 0;
	const calls = (input as { calls?: unknown }).calls;
	return Array.isArray(calls) ? calls.length : 0;
}

function classify(message: SessionEntryLike["message"]): Classification {
	const calls = toolCalls(message);
	if (calls.length === 0) return { kind: "skip" };
	if (calls.length > 1) {
		// Several probe calls in one message run concurrently, so they are not
		// serial probing; they are still nudged into a real tool_batch call.
		return calls.every((call) => PROBE_TOOLS.has(call.name))
			? { kind: "separate" }
			: { kind: "batched" };
	}
	const [call] = calls;
	// A batch of one is a solo call in disguise, and a batch with no usable
	// entries batches nothing: neither ends a serial run.
	if (call.name === BATCH_TOOL) {
		return batchSize(call) > 1 ? { kind: "batched" } : { kind: "skip" };
	}
	return PROBE_TOOLS.has(call.name)
		? { kind: "probe", tool: call.name }
		: { kind: "batched" };
}

function isAssistant(entry: SessionEntryLike): boolean {
	return entry.type === "message" && entry.message?.role === "assistant";
}

/**
 * Split one shell command on unquoted separators. Separators inside quotes
 * belong to the command (awk scripts, echo text), so they are ignored, and a
 * backslash escapes the next character, which keeps `\` line continuations in
 * one segment. A single pipe is not a separator: `rg x | head` is one command.
 */
function chainSegments(command: string): string[] {
	const segments: string[] = [];
	let current = "";
	let quote: string | null = null;
	for (let index = 0; index < command.length; index++) {
		const char = command[index];
		if (char === "\\") {
			current += char;
			index++;
			current += command[index] ?? "";
			continue;
		}
		if (quote) {
			current += char;
			if (char === quote) quote = null;
			continue;
		}
		if (char === "'" || char === '"') {
			quote = char;
			current += char;
			continue;
		}
		const chained =
			char === ";" ||
			char === "\n" ||
			(char === "&" && command[index + 1] === "&") ||
			(char === "|" && command[index + 1] === "|");
		if (!chained) {
			current += char;
			continue;
		}
		segments.push(current);
		current = "";
		// `&&` and `||` are two characters; `;` and a newline are one.
		if (char === "&" || char === "|") index++;
	}
	segments.push(current);
	return segments.map((segment) => segment.trim()).filter(Boolean);
}

/**
 * The bash commands a call would run. A tool_batch entry's arguments may sit
 * under `args`, `arguments`, or flat on the entry, matching the batch tool's
 * own normalization.
 */
function bashCommands(toolName: string, input: unknown): string[] {
	if (typeof input !== "object" || input === null) return [];
	const record = input as Record<string, unknown>;
	if (toolName === "bash") {
		return typeof record.command === "string" ? [record.command] : [];
	}
	if (toolName !== BATCH_TOOL || !Array.isArray(record.calls)) return [];
	const commands: string[] = [];
	for (const raw of record.calls) {
		if (typeof raw !== "object" || raw === null) continue;
		const entry = raw as Record<string, unknown>;
		if ((entry.tool ?? entry.name) !== "bash") continue;
		const args = (entry.args ?? entry.arguments ?? entry) as Record<
			string,
			unknown
		>;
		if (typeof args.command === "string") commands.push(args.command);
	}
	return commands;
}

/** Chained commands in the call, one segment list per offending command. */
function findChains(toolName: string, input: unknown): string[][] {
	return bashCommands(toolName, input)
		.map(chainSegments)
		.filter((segments) => segments.length > 1);
}

function clip(segment: string): string {
	return segment.length > MAX_SEGMENT_CHARS
		? `${segment.slice(0, MAX_SEGMENT_CHARS)}…`
		: segment;
}

function chainedReason(chains: string[][]): string {
	const calls = chains
		.flat()
		.slice(0, MAX_REASON_SEGMENTS)
		.map((segment) => ({ tool: "bash", args: { command: clip(segment) } }));
	return [
		"Chained bash blocked: one bash entry runs one command, never ; or && / || or newlines. Split it into one tool_batch entry per command, for example:",
		`tool_batch(${JSON.stringify({ calls })})`,
	].join("\n");
}

/** Index of the closest user turn before `index`, or -1. */
function lastUserIndex(entries: SessionEntryLike[], index: number): number {
	for (let cursor = index - 1; cursor >= 0; cursor--) {
		const entry = entries[cursor];
		if (entry.type === "message" && entry.message?.role === "user")
			return cursor;
	}
	return -1;
}

export default function batchNudge(pi: ExtensionAPI): void {
	const blockedEntries = new Set<string>();
	/** Chained blocks per command, for the current run only. */
	const chainedBlocks = new Map<string, number>();
	let chainedRunStart = -1;

	const rememberBlock = (entryId: string) => {
		if (blockedEntries.size >= MAX_REMEMBERED_BLOCKS) {
			const oldest = blockedEntries.values().next().value;
			if (oldest) blockedEntries.delete(oldest);
		}
		blockedEntries.add(entryId);
	};

	pi.on("tool_call", (event, ctx) => {
		const entries = ctx.sessionManager.getBranch() as SessionEntryLike[];

		// sessionManager is synchronized through the current assistant message
		// before tool_call handlers run.
		let currentIndex = -1;
		for (let index = entries.length - 1; index >= 0; index--) {
			const entry = entries[index];
			if (!isAssistant(entry)) continue;
			if (
				!toolCalls(entry.message).some((call) => call.id === event.toolCallId)
			)
				continue;
			currentIndex = index;
			break;
		}
		if (currentIndex < 0) return;

		const runStart = lastUserIndex(entries, currentIndex);
		if (runStart !== chainedRunStart) {
			chainedRunStart = runStart;
			chainedBlocks.clear();
		}

		// A chain is never a legitimate probe, so it is checked before any run
		// state and it ignores the re-issue exemption below.
		const chains = findChains(event.toolName, event.input);
		if (chains.length > 0) {
			const key = chains.map((segments) => segments.join("\n")).join("\n\n");
			const seen = chainedBlocks.get(key) ?? 0;
			if (seen >= MAX_CHAINED_BLOCKS) {
				chainedBlocks.delete(key);
				return;
			}
			chainedBlocks.set(key, seen + 1);
			rememberBlock(entries[currentIndex].id);
			return { block: true, reason: chainedReason(chains) };
		}

		const current = classify(entries[currentIndex].message);
		// Already batching with tool_batch, or not a probe at all.
		if (current.kind === "batched" || current.kind === "skip") return;

		// Only the closest earlier entry that did something decides. Skip entries
		// that batch nothing, stop at anything that ends the run.
		let previousSameTool = false;
		let previousWasBlocked = false;
		for (let index = currentIndex - 1; index >= 0; index--) {
			const entry = entries[index];
			if (entry.type !== "message") continue;
			if (entry.message?.role === "user") break;
			if (!isAssistant(entry)) continue;
			const previous = classify(entry.message);
			if (previous.kind === "skip") continue;
			if (blockedEntries.has(entry.id)) {
				previousWasBlocked = true;
				break;
			}
			if (
				previous.kind !== "probe" ||
				current.kind !== "probe" ||
				previous.tool !== current.tool
			)
				break;
			previousSameTool = true;
			break;
		}

		if (previousWasBlocked) return;
		if (current.kind !== "separate" && !previousSameTool) return;

		rememberBlock(entries[currentIndex].id);
		return { block: true, reason: NUDGE_REASON };
	});
}
