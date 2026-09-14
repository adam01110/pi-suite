import type { AnyToolDefinition } from "./tool-tracker.js";

// Compact model-facing descriptions for tools registered with verbose upstream
// text. Tool definitions are sent to the provider on every request, so long
// descriptions are a constant context tax. The full scripting API lives in the
// subagent-workflows skill and the mcp-scripting skill.
export const compactDescriptions: Readonly<Record<string, string>> = {
	// keep-sorted start
	SubagentWorkflow:
		"Execute a workflow script that orchestrates many subagents deterministically. Runs in the background — returns a task id immediately, and you are notified on completion; watch live in /agents → Workflows.\n\nONLY call this when the user explicitly opted into multi-agent orchestration: they asked for a workflow / fan-out / orchestration in their own words, invoked a skill or slash command that calls SubagentWorkflow, or asked for a named/saved workflow. Otherwise use the Agent tool, or describe what a multi-agent workflow could do and let the user opt in.\n\nScript format (plain JavaScript, async context, one file):\n1. First statement: `export const meta = { name, description, phases: [{ title, detail? }] }` — a pure literal; no variables, function calls, or interpolation. Phase titles must match phase() calls.\n2. Globals: agent(prompt, opts?) → string, or a validated object when opts.schema is set (a JSON Schema; agent may return null — filter every schema stage); parallel(thunks) is a barrier (waits for all); pipeline(items, stage1, stage2, …) has no barrier between stages — default for multi-stage work; phase(title) groups agents; log(message) narrates progress; workflow(nameOrRef, args?) runs a saved workflow (one nesting level); args is the workflow input; budget.{total, spent(), remaining()} has no total (pi has no token directive).\n3. agent() opts: {label?, phase?, schema?, model?, effort? ('minimal'|'low'|'medium'|'high'|'xhigh'|'max'), isolation?: 'worktree', agentType?, gate?: '<command>' (runs after the agent finishes; non-zero exit marks it failed with the command output as the error), resume?: '<label>' (continue the child from that label; cannot combine with agentType, model, effort, isolation, gate, or schema)}.\n4. Sandbox: standard JS built-ins only; no filesystem or Node APIs; Date.now(), Math.random(), argless new Date(), and eval throw.\n5. Subagents return their final text as raw data (with schema, a StructuredOutput tool enforces the shape). Verify by running (gate) rather than asking. If bounds cap coverage, log() what was dropped.\n\nPrefer pipeline over parallel. Load the subagent-workflows skill for the full API guide and examples.",
	ask_user:
		"Ask the user one focused question with optional multiple-choice options; allowFreeform adds free text. Use when intent is ambiguous, a decision needs explicit input, or valid options exist. Ask exactly one question per call; pass a short context summary.",
	bash: "Execute a bash command in the working directory. Returns stdout and stderr, truncated to the last 2000 lines or 50KB.",
	computer_use_linux_tools:
		"Enable native Linux desktop observation/control tools (screenshot, click, type_text, …) starting next turn for this session. Nothing runs until an enabled tool is called.",
	edit: "Make precise text replacements in one file. Each edits[] entry is {oldText: exact unique non-overlapping text, newText: replacement}; matches run against the original file, not earlier edits. Merge nearby or overlapping changes into one edit; use one call with several entries for multiple disjoint spots.",
	fetch_content:
		"Fetch URL(s) and extract readable content as markdown. mode: readable (default), raw (exact HTTP body), or answer (prompt answered using only fetched content). Direct image URLs return resized images. Also handles YouTube transcripts (yt-dlp + ffmpeg), GitHub repos, PDFs, and local videos (timestamp/frames extract video frames). auth opts into a browser-cookie profile; proxy needed when the target is unreachable directly.",
	find: "Fuzzy path search and glob search matched against the whole repo-relative path; multi-word queries narrow (AND). Prefer this first to surface files for a named concept, feature, or symbol. path constrains by directory prefix, filename, or glob; exclude prunes noise; limit default 30. For content use grep.",
	get_search_content:
		"Retrieve stored content from a previous web_search, source_check, or fetch_content call via its responseId. Slice with offset/limit, select by query/queryIndex/url/urlIndex, or findText (max 10 items × 500 chars) with findMode to jump to matching passages.",
	get_subagent_result:
		"Check status or retrieve a background agent's full result by agent ID (or its name/type handle). The completion notification carries only a preview; this returns the full output. wait: true blocks until completion; verbose: true includes the agent's full conversation.",
	goal_complete:
		"Mark the active /goal complete after all required work is fully implemented and verified. Audit requirements against current state first. Pass the exact goal_id from the current /goal prompt; never reuse a goal_id from an older, paused, replaced, or cleared turn.",
	grep: "Search file contents for a pattern (literal text or regex; all-lowercase patterns are case-insensitive). path constrains by directory prefix, filename with extension, or glob; exclude uses the same syntax. Results are frecency-ranked, matches in source order; limit default 20, context adds surrounding lines. Prefer bare identifier patterns; after 1-2 greps read the top match instead of more greps.",
	ls: "List directory contents alphabetically, dotfiles included, with '/' suffix for directories. Truncated at 500 entries or 50KB.",
	mcp: "MCP gateway. Actions: install (URL), status, connect, search, describe, instructions, auth-start, auth-complete, ui-messages — or call one tool with tool + args. Mode: action > tool > connect > describe > instructions > search > server. Use search to discover tools, describe to inspect schemas, then tool + args to call.",
	mcpScript:
		"Run trusted JavaScript that makes several MCP tool calls in one request — loop, filter, chain, or fan out. await tools.search({query}) to discover, tools.describe({path}) to inspect, tools.call(path, args) or tools.<prefixedToolName>(args) to call, emit(value) for user output. Load the mcp-scripting skill for the full workflow guide.",
	read: "Read a text or image file (jpg, png, gif, webp, bmp; images attach). Output truncated at 2000 lines or 50KB; use offset/limit and continue paging for the full file.",
	source_check:
		"Check a claim against web sources and return a bounded machine-readable artifact with exact passage citations. Optional: queries (default: the claim), numResults, recencyFilter, domainFilter, provider, fetchContent (fetches up to 5 pages).",
	steer_subagent:
		"Send a mid-run message to a running background agent. It interrupts the agent after its current tool execution and joins its conversation. Only works on currently running agents.",
	tool_batch:
		"Run 2+ independent read/grep/find/ls/bash calls as one composite tool with a single stacked renderer. Prefer over separate parallel calls when the combined output fits the budget. Do not use for edit/write or mutating, ordered, or streaming bash; use individual calls when a call needs its full output budget.",
	web_search:
		"Search the web. For research pass queries (2-4 varied angles, searched concurrently); otherwise query. Omit provider to use the configured default; provider accepts 'all' or a list to search several simultaneously. includeContent: true fetches full pages async (read them with get_search_content). recencyFilter, domainFilter, numResults optional. workflow: 'none' skips the interactive curator; 'auto-summary' returns a model-generated summary without it.",
	// keep-sorted end
};

// Namespace proxies (mcp__<server>) repeat one boilerplate sentence per server.
const PROXY_PREFIX = "mcp__";

export function applyCompactDescription(
	definition: AnyToolDefinition,
): AnyToolDefinition {
	if (definition.name.startsWith(PROXY_PREFIX)) {
		const server = definition.name.slice(PROXY_PREFIX.length);
		return {
			...definition,
			description: `Namespace proxy for MCP server "${server}". Forwards {tool, args} to it.`,
		};
	}
	const description = compactDescriptions[definition.name];
	return description ? { ...definition, description } : definition;
}
