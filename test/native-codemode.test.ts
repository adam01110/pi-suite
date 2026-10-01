import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import computerUse from "@agent-sh/computer-use-linux/pi/extension/index.js";
import {
	createAgentSession,
	createCodemodeExtension,
	createMcpExtension,
	DefaultResourceLoader,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import toolRenderer from "../src/glue/tool-renderer.js";
import { trackToolRegistrations } from "../src/tool-tracker.js";

test("native codemode batches rendered probes without the adapter", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-suite-native-codemode-"));
	const agentDir = join(cwd, "agent");
	const settingsManager = SettingsManager.inMemory({
		defaultTools: ["+codemode"],
	});
	writeFileSync(join(cwd, "a.txt"), "first probe");
	writeFileSync(join(cwd, "b.txt"), "second probe");
	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		extensionFactories: [
			createCodemodeExtension(),
			createMcpExtension(),
			computerUse,
			async (pi) => {
				const tracker = trackToolRegistrations(pi);
				try {
					await toolRenderer(pi, tracker);
				} finally {
					tracker.restore();
				}
			},
		],
	});
	let session:
		| Awaited<ReturnType<typeof createAgentSession>>["session"]
		| undefined;
	try {
		await resourceLoader.reload();
		expect(resourceLoader.getExtensions().errors).toEqual([]);
		({ session } = await createAgentSession({
			cwd,
			agentDir,
			resourceLoader,
			settingsManager,
			sessionManager: SessionManager.inMemory(cwd),
		}));
		await session.bindExtensions({});
		const names = session.getAllTools().map((tool) => tool.name);
		expect(names).not.toContain("tool_batch");
		expect(names).not.toContain("mcpScript");
		expect(names).not.toContain("mcp");
		expect(session.getActiveToolNames()).toContain("computer_use_linux_tools");
		expect(session.getActiveToolNames()).not.toContain(
			"computer_use_linux_click",
		);
		const codemode = session.agent.state.tools.find(
			(tool) => tool.name === "codemode",
		);
		if (!codemode) throw new Error("native codemode was not activated");
		// Nested execution needs an issuing assistant message, but no model request.
		session.agent.state.messages.push({
			role: "assistant",
			api: "openai-completions",
			provider: "openai",
			model: "test",
			content: [
				{
					type: "toolCall",
					id: "native-batch",
					name: "codemode",
					arguments: {},
				},
			],
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "toolUse",
			timestamp: 0,
		});
		const result = await codemode.execute("native-batch", {
			code: `
const results = await Promise.allSettled([
  tools.read({path: "a.txt"}),
  tools.read({path: "b.txt"}),
  tools.bash({command: "printf native-bash"}),
  tools.read({path: "missing.txt"})
]);
text(results.map(result => result.status === "rejected" ? {...result, reason: String(result.reason)} : result));
text(await searchTools("read", {limit: 1}));
text(await describeTool("bash"));
`,
		});
		const output = result.content
			.filter((part) => part.type === "text")
			.map((part) => part.text)
			.join("\n");
		expect(output).toContain("Script completed");
		expect(output).toContain("first probe");
		expect(output).toContain("second probe");
		expect(output).toContain("native-bash");
		expect(output).toContain('"exit_code":0');
		expect(output).toContain('"status":"rejected"');
		console.log(
			"Native Pi codemode: Script completed; rendered reads, structured bash, allSettled failure, discovery; computer-use loader active without adapter",
		);
	} finally {
		session?.dispose();
		rmSync(cwd, { recursive: true, force: true });
	}
}, 30_000);
