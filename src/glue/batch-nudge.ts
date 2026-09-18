import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Weak models (glm, deepseek, ...) emit one tool call per assistant message
 * and never batch, even when instructions demand it. Prompt-only nudges fail,
 * so the pattern gets blocked instead: a solo read-only lookup right after
 * another solo lookup with the same tool is rejected once with a pointer to
 * tool_batch. Cross-tool chains (grep -> read) stay allowed: those are usually
 * dependent on the previous result. One block per same-tool run; the blocked
 * assistant entry marks the suppression point, so session history stays the
 * source of truth across rewinds and forks.
 */
const NUDGE_REASON =
	"Serial same-tool lookup blocked. Put the independent read/grep/find/ls calls in ONE tool_batch call with {tool, args} entries. If this call depends on the previous result, re-issue it unchanged and it will run.";

const BATCHABLE_TOOLS = new Set([
	// keep-sorted start
	"find",
	"grep",
	"ls",
	"read",
	// keep-sorted end
]);

interface ToolCallContent {
	id: string;
	name: string;
	type: "toolCall";
}

type SessionEntryLike = {
	id: string;
	type: string;
	message?: { content?: unknown; role?: string };
};

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

function isAssistantWithCalls(entry: SessionEntryLike): boolean {
	return entry.type === "message" && entry.message?.role === "assistant";
}

export default function batchNudge(pi: ExtensionAPI): void {
	// Entry id of the assistant message that was blocked. Encountering it
	// during a backward scan means the run was already nudged.
	let blockedEntryId: string | null = null;

	pi.on("tool_call", (event, ctx) => {
		const entries = ctx.sessionManager.getBranch() as SessionEntryLike[];

		// sessionManager is synchronized through the current assistant message
		// before tool_call handlers run.
		let currentIndex = -1;
		let currentCalls: ToolCallContent[] = [];
		for (let index = entries.length - 1; index >= 0; index--) {
			const entry = entries[index];
			if (!isAssistantWithCalls(entry)) continue;
			const calls = toolCalls(entry.message);
			if (!calls.some((call) => call.id === event.toolCallId)) continue;
			currentIndex = index;
			currentCalls = calls;
			break;
		}
		if (currentIndex < 0) return;

		const currentCall = currentCalls.find(
			(call) => call.id === event.toolCallId,
		);
		if (!currentCall) return;
		// Sibling calls in the same message mean the model is already batching.
		if (currentCalls.length > 1 || !BATCHABLE_TOOLS.has(currentCall.name)) {
			blockedEntryId = null;
			return;
		}

		// Walk back through the run. Same-tool solo lookups accumulate; a user
		// turn, a batched message, or a non-batchable call breaks the run.
		let previousSoloSameTool = false;
		for (let index = currentIndex - 1; index >= 0; index--) {
			const entry = entries[index];
			if (entry.type !== "message") continue;
			const message = entry.message;
			if (message?.role === "user") {
				blockedEntryId = null;
				break;
			}
			if (message?.role !== "assistant") continue;
			const calls = toolCalls(message);
			if (calls.length === 0) continue;
			if (entry.id === blockedEntryId) return;
			if (
				calls.length > 1 ||
				!BATCHABLE_TOOLS.has(calls[0].name) ||
				calls[0].name !== currentCall.name
			) {
				blockedEntryId = null;
				break;
			}
			previousSoloSameTool = true;
		}
		if (!previousSoloSameTool) return;

		blockedEntryId = entries[currentIndex].id;
		return { block: true, reason: NUDGE_REASON };
	});
}
