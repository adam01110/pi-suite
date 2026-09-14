import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ToolTracker } from "./tool-tracker.js";

// Compact model-facing descriptions for tools whose upstream text is verbose.
// Tool definitions are sent to the provider on every request, so description
// and schema text are a constant context tax.
// Applied in hooks after pi-subagents' session_start collision check: that
// check identifies its own SubagentWorkflow registration by exact description
// match, so a registration-time rewrite would make it stand down. session_start
// and before_agent_start both run after the check; the pass is idempotent.
export const compactDescriptions: Readonly<Record<string, string>> = {
	// keep-sorted start
	SubagentWorkflow:
		"Execute a workflow script that orchestrates many subagents deterministically. Runs in the background — returns a task id immediately, and you are notified on completion; watch live in /agents → Workflows.\n\nONLY call this when the user explicitly opted into multi-agent orchestration: they asked for a workflow / fan-out / orchestration in their own words, invoked a skill or slash command that calls SubagentWorkflow, or asked for a named/saved workflow. Otherwise use the Agent tool, or describe what a multi-agent workflow could do and let the user opt in.\n\nScript format (plain JavaScript, async context, one file):\n1. First statement: `export const meta = { name, description, phases: [{ title, detail? }] }` — a pure literal; no variables, function calls, or interpolation. Phase titles must match phase() calls.\n2. Globals: agent(prompt, opts?) → string, or a validated object when opts.schema is set (agent may return null — filter every schema stage); parallel(thunks) is a barrier (waits for all); pipeline(items, stage1, stage2, …) has no barrier — default for multi-stage work; phase(title); log(message); workflow(nameOrRef, args?) runs a saved workflow (one nesting level); args is the workflow input; budget.{total, spent(), remaining()} has no total (pi has no token directive).\n3. agent() opts: {label?, phase?, schema?, model?, effort? ('minimal'|'low'|'medium'|'high'|'xhigh'|'max'), isolation?: 'worktree', agentType?, gate?: '<command>' (runs after the agent finishes; non-zero exit marks it failed with the command output as the error), resume?: '<label>' (continue the child from that label; cannot combine with agentType, model, effort, isolation, gate, or schema)}.\n4. Sandbox: standard JS built-ins only; no filesystem or Node APIs; Date.now(), Math.random(), argless new Date(), and eval throw.\n5. Prefer pipeline over parallel. Load the subagent-workflows skill for the full API guide and examples.",
	mcp: "MCP gateway. Actions: install (URL), status, connect, search, describe, instructions, auth-start, auth-complete, ui-messages; or tool + args to call one tool. Mode: action > tool > connect > describe > instructions > search > server > nothing. Search to discover tools, describe to inspect schemas, then call with tool + args.",
	web_search:
		"Search the web. For research pass queries (2-4 varied angles, searched concurrently); otherwise query. Omit provider to use the configured default; provider accepts 'all' or a list. includeContent: true fetches pages async (read with get_search_content). recencyFilter, domainFilter, numResults optional. workflow: 'none' skips the interactive curator; 'auto-summary' returns a model-generated summary without it.",
	// keep-sorted end
};

// Schema property descriptions that document UI/env-var behavior the model
// cannot act on. Stripping them keeps types and enums intact.
const SLIM_SCHEMA_PROPERTIES: Readonly<Record<string, readonly string[]>> = {
	ask_user: [
		// keep-sorted start
		"allowComment",
		"commentToggleKey",
		"contextExpanded",
		"displayMode",
		"overlayToggleKey",
		"singleSelectLayout",
		// keep-sorted end
	],
};

const PROXY_PREFIX = "mcp__";
const PROXY_DESCRIPTION = (server: string) =>
	`Namespace proxy for MCP server "${server}". Forwards {tool, args} to it.`;

export function installDescriptionTrims(
	pi: ExtensionAPI,
	tracker: ToolTracker,
): void {
	// Idempotent: only re-registers when the description differs, so repeat
	// firings (session_start, each before_agent_start) are no-ops. Hooks fire
	// after pi-subagents' session_start collision check, which matches its own
	// tool by exact description.
	const pass = () => {
		try {
			for (const tool of pi.getAllTools()) {
				const description = tool.name.startsWith(PROXY_PREFIX)
					? PROXY_DESCRIPTION(tool.name.slice(PROXY_PREFIX.length))
					: compactDescriptions[tool.name];
				if (!description || tool.description === description) continue;

				// getAllTools omits execute; the tracker captured full definitions.
				const definition = tracker.get(tool.name);
				if (!definition) continue;
				pi.registerTool({ ...definition, description });
			}

			const slim = SLIM_SCHEMA_PROPERTIES.ask_user;
			const askUser = tracker.get("ask_user");
			if (askUser && slim.length > 0) {
				const parameters = JSON.parse(
					JSON.stringify(askUser.parameters),
				) as Record<string, any>;
				const properties = parameters.properties;
				let changed = false;
				if (properties) {
					for (const name of slim) {
						if (properties[name]?.description === undefined) continue;
						delete properties[name].description;
						changed = true;
					}
				}
				if (changed) {
					pi.registerTool({
						...askUser,
						parameters,
					} as unknown as Parameters<typeof pi.registerTool>[0]);
				}
			}
		} catch {
			// Trimming is best-effort; never block a turn on it.
		}
	};

	pi.on("session_start", pass);
	pi.on("before_agent_start", pass);
}
