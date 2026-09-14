import { expect, test } from "bun:test";
import type {
	ExtensionAPI,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { installDescriptionTrims } from "../src/tool-descriptions.js";
import { trackToolRegistrations } from "../src/tool-tracker.js";

interface FakePi extends ExtensionAPI {
	handler: () => void;
	registered: ToolDefinition<any>[];
}

function stripExecute(tool: ToolDefinition<any>) {
	const { execute: _execute, ...rest } = tool;
	return rest;
}

function definition(
	name: string,
	description: string,
	parameters: Record<string, unknown> = {},
): ToolDefinition<any> {
	return {
		name,
		label: name,
		description,
		parameters: parameters as any,
		async execute() {
			return { content: [{ type: "text", text: name }], details: undefined };
		},
	};
}

test("description trims rewrite registered tools at before_agent_start", () => {
	const upstream = definition("SubagentWorkflow", "long upstream description");
	const proxy = definition("mcp__context7", "long proxy description");
	const untouched = definition("some-tool", "long upstream description");

	const registered: ToolDefinition<any>[] = [];
	const pi = {
		registered,
		handler: () => {},
		registerTool(tool: ToolDefinition<any>) {
			registered.push(tool);
		},
		getAllTools: () => [upstream, proxy, untouched].map(stripExecute),
		on(_event: string, handler: () => void) {
			pi.handler = handler;
		},
	} as unknown as FakePi;
	// Simulate what the real tracker saw at load time.
	const tools = trackToolRegistrations(pi as ExtensionAPI);
	for (const tool of [upstream, proxy, untouched]) pi.registerTool(tool);
	tools.restore();

	installDescriptionTrims(pi as ExtensionAPI, tools);
	pi.handler();

	const workflow = [...registered].reverse().find((tool) => tool.name === "SubagentWorkflow");
	expect(workflow?.description).toMatch(/subagent-workflows skill/);
	expect(workflow?.execute).toBe(upstream.execute);

	const proxyTrim = [...registered].reverse().find((tool) => tool.name === "mcp__context7");
	expect(proxyTrim?.description).toBe(
		'Namespace proxy for MCP server "context7". Forwards {tool, args} to it.',
	);

	expect([...registered].reverse().find((tool) => tool.name === "some-tool")).toBe(untouched);
});

test("description trims run once and slim ask_user schema properties", () => {
	const askUser = definition("ask_user", "Ask the user a question", {
		type: "object",
		properties: {
			question: { type: "string", description: "The question to ask" },
			displayMode: {
				type: "string",
				enum: ["overlay", "inline"],
				description: "UI rendering mode details",
			},
			commentToggleKey: {
				type: "string",
				description: "Shortcut for toggling the comment row",
			},
		},
	});

	const registered: ToolDefinition<any>[] = [];
	const pi = {
		registered,
		handler: () => {},
		registerTool(tool: ToolDefinition<any>) {
			registered.push(tool);
		},
		getAllTools: () => [askUser].map(stripExecute),
		on(_event: string, handler: () => void) {
			pi.handler = handler;
		},
	} as unknown as FakePi;
	const tools = trackToolRegistrations(pi as ExtensionAPI);
	pi.registerTool(askUser);

	installDescriptionTrims(pi as ExtensionAPI, tools);
	pi.handler();
	const countAfterFirst = registered.length;
	pi.handler();
	expect(registered.length).toBe(countAfterFirst);

	const slimmed = [...registered].reverse().find((tool) => tool.name === "ask_user");
	if (!slimmed) throw new Error("ask_user was not re-registered");
	const properties = (slimmed.parameters as {
		properties: Record<
			string,
			{ description?: string; enum?: string[] }
		>;
	}).properties;
	expect(properties.question.description).toBe("The question to ask");
	expect(properties.displayMode.enum).toEqual(["overlay", "inline"]);
	expect(properties.displayMode.description).toBeUndefined();
	expect(properties.commentToggleKey.description).toBeUndefined();
	expect(slimmed?.execute).toBe(askUser.execute);
});
