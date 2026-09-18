import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import modelProfile from "../src/glue/model-profile.js";

type EventHandler = (
	event: unknown,
	ctx: ExtensionContext,
) => Promise<void> | void;
type RegisteredCommand = Parameters<ExtensionAPI["registerCommand"]>[1];

const CODEX_MODEL = {
	provider: "openai-codex",
	id: "gpt-5.6-sol",
	name: "gpt-5.6-sol",
};
const GLM_MODEL = {
	provider: "opencode-go",
	id: "glm-5.3-flash",
	name: "GLM-5.3-Flash",
};

const CONFIG = {
	codex: {
		session: { model: "openai-codex/gpt-5.6-sol", thinking: "medium" },
		coder: { model: "openai-codex/gpt-5.6-sol", thinking: "medium" },
	},
	"go-glm": {
		session: { model: "opencode-go/glm-5.3-flash", thinking: "high" },
		coder: { thinking: "high" },
	},
};

function makeHarness() {
	const commands = new Map<string, RegisteredCommand>();
	const handlers = new Map<string, EventHandler[]>();
	const setModelCalls: Array<{ provider: string; id: string }> = [];
	const pi = {
		on(name: string, handler: EventHandler) {
			handlers.set(name, [...(handlers.get(name) ?? []), handler]);
		},
		registerCommand(name: string, command: RegisteredCommand) {
			commands.set(name, command);
		},
		setModel: async (model: { provider: string; id: string }) => {
			setModelCalls.push(model);
			return true;
		},
		setThinkingLevel: () => {},
	} as unknown as ExtensionAPI;

	modelProfile(pi);

	const ctx = {
		hasUI: true,
		model: CODEX_MODEL,
		thinkingLevel: "medium",
		sessionManager: { getEntries: () => [] as unknown[] },
		modelRegistry: {
			getProviderDisplayName: (provider: string) => provider,
			find: (provider: string, _id: string) =>
				provider === "openai-codex"
					? CODEX_MODEL
					: provider === "opencode-go"
						? GLM_MODEL
						: undefined,
		},
		ui: {
			select: async (_title: string, _options: string[]) =>
				undefined as string | undefined,
			notify: () => {},
		},
	} as unknown as ExtensionContext;

	return { commands, handlers, setModelCalls, ctx };
}

function withConfig(
	value: string | undefined,
	body: () => Promise<void>,
): Promise<void> {
	const saved = process.env.PI_SUITE_PROFILE_AGENTS;
	if (value === undefined) delete process.env.PI_SUITE_PROFILE_AGENTS;
	else process.env.PI_SUITE_PROFILE_AGENTS = value;
	return body().finally(() => {
		if (saved === undefined) delete process.env.PI_SUITE_PROFILE_AGENTS;
		else process.env.PI_SUITE_PROFILE_AGENTS = saved;
	});
}

/** The picker stores its state beside the agent files it also rewrites. */
function lastProfileFile(agentDir: string): string {
	return join(agentDir, "agents", "pi-suite-last-profile.json");
}

function makeAgentDir(): string {
	return join(
		tmpdir(),
		`pi-suite-startup-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
}

// The picker records its last pick in the agent dir, so every test needs its
// own: one run must never touch the real ~/.pi/agent.
let agentDir: string;

beforeEach(() => {
	agentDir = makeAgentDir();
	process.env.PI_CODING_AGENT_DIR = agentDir;
});

afterEach(() => {
	delete process.env.PI_CODING_AGENT_DIR;
	rmSync(agentDir, { recursive: true, force: true });
});

function setSelect(
	ctx: ExtensionContext,
	select: (title: string, options: string[]) => Promise<string | undefined>,
): void {
	(ctx.ui as { select: typeof select }).select = select;
}

describe("startup profile select", () => {
	test("registers /profile with completion and direct switching", async () => {
		await withConfig(JSON.stringify(CONFIG), async () => {
			const { commands, setModelCalls, ctx } = makeHarness();
			const command = commands.get("profile");
			expect(command).toBeDefined();
			expect(command?.getArgumentCompletions?.("go")).toEqual([
				{ value: "go-glm", label: "go-glm" },
			]);
			setSelect(ctx, async () => {
				throw new Error("direct profile switching opened the selector");
			});

			await command?.handler("go-glm", ctx as ExtensionCommandContext);

			expect(setModelCalls).toMatchObject([
				{ provider: "opencode-go", id: "glm-5.3-flash" },
			]);
		});
	});

	test("lists configured profiles and switches on pick", async () => {
		await withConfig(JSON.stringify(CONFIG), async () => {
			const { handlers, setModelCalls, ctx } = makeHarness();
			(
				ctx.ui as {
					select: (
						title: string,
						options: string[],
					) => Promise<string | undefined>;
				}
			).select = async (_title, options) => {
				expect(options[0]).toContain("codex");
				expect(options[1]).toContain("go-glm");
				return options[1];
			};

			for (const handler of handlers.get("session_start") ?? [])
				await handler({ reason: "startup" }, ctx);

			expect(setModelCalls).toHaveLength(1);
			expect(setModelCalls[0]).toMatchObject({
				provider: "opencode-go",
				id: "glm-5.3-flash",
			});
		});
	});

	test("profile without a session model keeps the session model", async () => {
		await withConfig(
			JSON.stringify({
				legacy: {
					coder: { model: "openai-codex/gpt-5.6-sol", thinking: "medium" },
				},
			}),
			async () => {
				const { handlers, setModelCalls, ctx } = makeHarness();
				(
					ctx.ui as {
						select: (
							title: string,
							options: string[],
						) => Promise<string | undefined>;
					}
				).select = async (_title, options) => options[0];

				for (const handler of handlers.get("session_start") ?? [])
					await handler({ reason: "startup" }, ctx);

				expect(setModelCalls).toEqual([]);
			},
		);
	});

	test("unavailable models drop the profile entry", async () => {
		await withConfig(
			JSON.stringify({
				"go-glm": { session: { model: "opencode-go/glm-5.3-flash" } },
				ghost: { session: { model: "ghost/none" } },
			}),
			async () => {
				const { handlers, ctx } = makeHarness();
				(
					ctx.ui as {
						select: (
							title: string,
							options: string[],
						) => Promise<string | undefined>;
					}
				).select = async (_title, options) => {
					expect(options).toEqual(["go-glm"]);
					return options[0];
				};
				for (const handler of handlers.get("session_start") ?? [])
					await handler({ reason: "startup" }, ctx);
			},
		);
	});

	test("skips non-startup reasons and headless runs", async () => {
		await withConfig(JSON.stringify(CONFIG), async () => {
			const { handlers, setModelCalls, ctx } = makeHarness();
			for (const handler of handlers.get("session_start") ?? [])
				await handler({ reason: "resume" }, ctx);
			expect(setModelCalls).toEqual([]);

			const headless = { ...ctx, hasUI: false } as unknown as ExtensionContext;
			for (const handler of handlers.get("session_start") ?? [])
				await handler({ reason: "startup" }, headless);
			expect(setModelCalls).toEqual([]);
		});
	});

	test("skips the picker when startup loaded an existing session", async () => {
		await withConfig(JSON.stringify(CONFIG), async () => {
			const { handlers, setModelCalls, ctx } = makeHarness();
			// `pi -s <session>` / `-c` / `-r` open a session file before
			// session_start while still reporting reason "startup".
			(ctx.sessionManager as { getEntries: () => unknown[] }).getEntries =
				() => [{ type: "message" }];
			setSelect(ctx, async () => {
				throw new Error("the picker opened for a resumed session");
			});

			for (const handler of handlers.get("session_start") ?? [])
				await handler({ reason: "startup" }, ctx);

			expect(setModelCalls).toEqual([]);
		});
	});

	test("asks on startup when only default-change entries exist", async () => {
		await withConfig(JSON.stringify(CONFIG), async () => {
			const { handlers, setModelCalls, ctx } = makeHarness();
			// A fresh session already records its model and thinking level
			// before session_start; neither is conversation history.
			(ctx.sessionManager as { getEntries: () => unknown[] }).getEntries =
				() => [{ type: "model_change" }, { type: "thinking_level_change" }];
			setSelect(ctx, async (_title, options) => options[1]);

			for (const handler of handlers.get("session_start") ?? [])
				await handler({ reason: "startup" }, ctx);

			expect(setModelCalls).toMatchObject([
				{ provider: "opencode-go", id: "glm-5.3-flash" },
			]);
		});
	});

	test("asks again on /new", async () => {
		await withConfig(JSON.stringify(CONFIG), async () => {
			const { handlers, setModelCalls, ctx } = makeHarness();
			setSelect(ctx, async (_title, options) => options[1]);

			for (const handler of handlers.get("session_start") ?? [])
				await handler({ reason: "new" }, ctx);

			expect(setModelCalls).toMatchObject([
				{ provider: "opencode-go", id: "glm-5.3-flash" },
			]);
		});
	});

	test("marks the profile picked last time", async () => {
		await withConfig(JSON.stringify(CONFIG), async () => {
			mkdirSync(join(agentDir, "agents"), { recursive: true });
			writeFileSync(
				lastProfileFile(agentDir),
				JSON.stringify({ profile: "go-glm" }),
			);
			const { handlers, ctx } = makeHarness();
			let seen: string[] = [];
			setSelect(ctx, async (_title, options) => {
				seen = options;
				return undefined;
			});

			for (const handler of handlers.get("session_start") ?? [])
				await handler({ reason: "startup" }, ctx);

			expect(seen).toEqual(["codex", "go-glm  (last used)"]);
		});
	});

	test("records the pick for the next session", async () => {
		await withConfig(JSON.stringify(CONFIG), async () => {
			const { handlers, ctx } = makeHarness();
			setSelect(ctx, async (_title, options) => options[1]);

			for (const handler of handlers.get("session_start") ?? [])
				await handler({ reason: "startup" }, ctx);

			expect(
				JSON.parse(readFileSync(lastProfileFile(agentDir), "utf8")),
			).toEqual({
				profile: "go-glm",
			});
		});
	});
});
