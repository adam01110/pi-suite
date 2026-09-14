import { expect, test } from "bun:test";
import type {
	ExtensionAPI,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { trackToolRegistrations } from "../src/tool-tracker.js";

function definition(name: string): ToolDefinition<any> {
	return {
		name,
		label: name,
		description: name,
		parameters: {} as any,
		async execute() {
			return { content: [{ type: "text", text: name }], details: undefined };
		},
	};
}

test("tool tracker suppresses selected overrides and preserves prior definitions", () => {
	const registered: string[] = [];
	const pi = {
		registerTool(tool: ToolDefinition<any>) {
			registered.push(tool.name);
		},
	} as ExtensionAPI;
	const tracker = trackToolRegistrations(pi);
	const original = definition("grep");
	pi.registerTool(original);

	const unblock = tracker.block(new Set(["grep"]));
	pi.registerTool(definition("grep"));
	unblock();

	expect(registered).toEqual(["grep"]);
	expect(tracker.get("grep")).toBe(original);
	tracker.restore();
});
