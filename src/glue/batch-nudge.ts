import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Weak models drift back to serial probes despite prompt instructions. Allow
 * re-issues so dependent lookups can progress, but nudge independent calls into
 * one `tool_batch` call. Nested calls bypass serial detection; their bash chains
 * still go through the same bounded blocking policy as direct calls.
 */
const NUDGE_REASON =
	'Serial or separate probing blocked. Put independent read/grep/find/ls/bash calls in ONE tool_batch call: {"calls": [{"tool": "read", "args": {"path": "a"}}, {"tool": "grep", "args": {"pattern": "b"}}]}. Use codemode only for pipelines. If this call depends on the previous result, re-issue it unchanged and it will run.';

const PROBE_TOOLS = new Set([
	// keep-sorted start
	"bash",
	"find",
	"grep",
	"ls",
	"read",
	// keep-sorted end
]);

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

function classify(message: SessionEntryLike["message"]): Classification {
	const calls = toolCalls(message);
	if (calls.length === 0) return { kind: "skip" };
	if (calls.length > 1) {
		// One script keeps independent probe output together.
		return calls.every((call) => PROBE_TOOLS.has(call.name))
			? { kind: "separate" }
			: { kind: "batched" };
	}
	const [call] = calls;
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

function bashCommands(toolName: string, input: unknown): string[] {
	if (toolName !== "bash" || typeof input !== "object" || input === null)
		return [];
	const { command } = input as Record<string, unknown>;
	return typeof command === "string" ? [command] : [];
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
		.map(
			(segment) =>
				`{"tool": "bash", "args": {"command": ${JSON.stringify(clip(segment))}}}`,
		);
	return [
		"Chained bash blocked: one bash call runs one command, never ; or && / || or newlines. For independent commands, use one tool_batch call; keep dependent or mutating calls sequential:",
		`{"calls": [${calls.join(", ")}]}`,
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
		// Nested calls are absent from the transcript; their root call owns the turn.
		const rootCallId = event.parentToolCallId
			? event.parentToolCallId.split("/")[0]
			: event.toolCallId;

		// sessionManager is synchronized through the current assistant message
		// before tool_call handlers run.
		let currentIndex = -1;
		for (let index = entries.length - 1; index >= 0; index--) {
			const entry = entries[index];
			if (!isAssistant(entry)) continue;
			if (!toolCalls(entry.message).some((call) => call.id === rootCallId))
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

		if (event.parentToolCallId) return;

		const current = classify(entries[currentIndex].message);
		// Scripts and non-probe tools end the serial run.
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
