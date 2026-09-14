import { expect, test } from "bun:test";
import type {
	ExtensionAPI,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { trackToolRegistrations } from "../src/tool-tracker.js";

function definition(name: string, description?: string): ToolDefinition<any> {
	return {
		name,
		label: name,
		description: description ?? name,
		parameters: {} as any,
		async execute() {
			return { content: [{ type: "text", text: name }], details: undefined };
		},
	};
}

test("tool tracker rewrites known heavy tool descriptions", () => {
	const registered: ToolDefinition<any>[] = [];
	const pi = {
		registerTool(tool: ToolDefinition<any>) {
			registered.push(tool);
		},
	} as ExtensionAPI;
	const tracker = trackToolRegistrations(pi);

	const workflow = definition("SubagentWorkflow", "long upstream description");
	const proxy = definition("mcp__context7", "long upstream description");
	const unknown = definition("some-unknown-tool", "long upstream description");
	pi.registerTool(workflow);
	pi.registerTool(proxy);
	pi.registerTool(unknown);

	expect(tracker.get("SubagentWorkflow")?.description).toMatch(
		/subagent-workflows skill/,
	);
	expect(tracker.get("mcp__context7")?.description).toBe(
		'Namespace proxy for MCP server "context7". Forwards {tool, args} to it.',
	);
	expect(tracker.get("some-unknown-tool")?.description).toBe(
		"long upstream description",
	);
	// execute is preserved on rewritten definitions
	expect(tracker.get("SubagentWorkflow")?.execute).toBe(workflow.execute);
	tracker.restore();
});

test("tool tracker suppresses selected overrides and preserves prior definitions", () => {
	const registered: string[] = [];
	const pi = {
		registerTool(tool: ToolDefinition<any>) {
			registered.push(tool.name);
		},
	} as ExtensionAPI;
	const tracker = trackToolRegistrations(pi);
	const original = definition("grep-test-fixture");
	pi.registerTool(original);

	const unblock = tracker.block(new Set(["grep-test-fixture"]));
	pi.registerTool(definition("grep-test-fixture"));
	unblock();

	expect(registered).toEqual(["grep-test-fixture"]);
	expect(tracker.get("grep-test-fixture")).toBe(original);
	tracker.restore();
});
