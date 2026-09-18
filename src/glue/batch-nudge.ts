import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Weak models (glm, deepseek, ...) batch once under instruction pressure and
 * then decay back into one call per assistant message. Prompt-only nudges are
 * not enough, so the pattern gets blocked instead:
 *
 * - serial probing: a solo read/grep/find/ls/bash call right after another solo
 *   call of the same tool. Same tool only: a grep -> read chain is usually
 *   dependent on the previous result.
 * - chained bash: `;` or `&&`/`||` in a bash command. Several commands belong
 *   in one tool_batch call, not glued into one shell line.
 *
 * Every such call is blocked, except the one that directly follows a blocked
 * call: that is the re-issue, and letting it run is what keeps the model from
 * looping on the nudge instead of making progress. A batched message, a
 * different tool, or a user turn ends the run.
 */
const NUDGE_REASON =
	"Serial or chained probing blocked. Put the independent read/grep/find/ls/bash calls in ONE tool_batch call with {tool, args} entries; never join commands with ; or &&. If this call depends on the previous result, re-issue it unchanged and it will run.";

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
	if (calls.length > 1) return { kind: "batched" };
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

function isChained(command: unknown): boolean {
	if (typeof command !== "string") return false;
	// Separators inside quotes belong to one command (awk scripts, echo text),
	// so scan unquoted text only.
	let quote: string | null = null;
	for (let index = 0; index < command.length; index++) {
		const char = command[index];
		if (char === "\\") {
			index++;
			continue;
		}
		if (quote) {
			if (char === quote) quote = null;
			continue;
		}
		if (char === "'" || char === '"') {
			quote = char;
			continue;
		}
		if (char === ";") return true;
		if (char === "&" && command[index + 1] === "&") return true;
		if (char === "|" && command[index + 1] === "|") return true;
	}
	return false;
}

export default function batchNudge(pi: ExtensionAPI): void {
	const blockedEntries = new Set<string>();

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

		const current = classify(entries[currentIndex].message);
		// Already batching, or not a probe at all.
		if (current.kind !== "probe") return;

		// Only the closest earlier probe decides. Skip entries that batch
		// nothing, stop at anything that ends the run.
		let previousSameTool = false;
		let previousWasBlocked = false;
		for (let index = currentIndex - 1; index >= 0; index--) {
			const entry = entries[index];
			if (entry.type !== "message") continue;
			if (entry.message?.role === "user") break;
			if (!isAssistant(entry)) continue;
			const previous = classify(entry.message);
			if (previous.kind === "skip") continue;
			if (previous.kind === "batched" || previous.tool !== current.tool) break;
			if (blockedEntries.has(entry.id)) {
				previousWasBlocked = true;
				break;
			}
			previousSameTool = true;
			break;
		}

		const chained =
			event.toolName === "bash" &&
			isChained((event.input as { command?: unknown }).command);
		if (previousWasBlocked) return;
		if (!previousSameTool && !chained) return;

		rememberBlock(entries[currentIndex].id);
		return { block: true, reason: NUDGE_REASON };
	});
}
