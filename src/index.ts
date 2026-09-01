import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import atuin from "./glue/atuin.js";
import autoformatRenderer from "./glue/autoformat-renderer.js";
import cacheStatusColor from "./glue/cache-status.js";
import { fixedBtwModel, suppressCommands } from "./glue/commands.js";
import regularBottomAnchor from "./glue/regular-bottom-anchor.js";
import rewind from "./glue/rewind.js";
import toolRenderer from "./glue/tool-renderer.js";
import webAccess from "./glue/web-access.js";
import {
	formatSuiteStatus,
	loadModules,
	type SuiteModule,
} from "./registry.js";
import { trackToolRegistrations } from "./tool-tracker.js";
import { upstreamFactory } from "./upstream.js";
import rtk from "./vendor/rtk.js";

const BTW_MODEL = process.env.PI_SUITE_BTW_MODEL;

const BLOCKED_COMMANDS = {
	atuin: new Set(["atuin"]),
	cacheOptimizer: new Set(["cache-optimizer"]),
	fff: new Set(["fff-health", "fff-mode", "fff-rescan"]),
	footer: new Set(["footer"]),
	header: new Set([
		"hc",
		"hcl",
		"hdf",
		"hi",
		"hm",
		"hps",
		"hs",
		"hsp",
		"htg",
		"hv",
	]),
	mcp: new Set(["mcp-auth", "pi-mcp"]),
	qol: new Set([
		"qol",
		"qol:rename",
		"qol:rename:full",
		"schedule",
		"search",
		"search:refresh",
		"search:resume-pending",
	]),
	webAccess: new Set(["curator", "google-account", "search", "websearch"]),
} as const;

export default async function piSuite(pi: ExtensionAPI): Promise<void> {
	const tools = trackToolRegistrations(pi);
	let results: Awaited<ReturnType<typeof loadModules>>;

	const modules: readonly SuiteModule[] = [
		// Capture the regular renderer before UI extensions install their components.
		{
			id: "regular-bottom-anchor",
			factory: regularBottomAnchor,
			optional: true,
		},

		// UI base first. Atuin composes with the editor installed by QOL.
		{
			id: "qol",
			factory: suppressCommands(
				upstreamFactory("@vanillagreen/pi-qol/extensions/qol.js"),
				BLOCKED_COMMANDS.qol,
			),
			optional: true,
		},
		{
			id: "header",
			factory: suppressCommands(
				upstreamFactory("pi-cc-header/extensions/pi-cc-header.js"),
				BLOCKED_COMMANDS.header,
			),
			optional: true,
		},
		{
			id: "footer",
			factory: suppressCommands(
				upstreamFactory("pi-footer/src/index.js"),
				BLOCKED_COMMANDS.footer,
			),
			optional: true,
		},
		{ id: "cache-status", factory: cacheStatusColor, optional: true },
		{
			id: "cache-optimizer",
			factory: suppressCommands(
				upstreamFactory("pi-cache-optimizer/index.js"),
				BLOCKED_COMMANDS.cacheOptimizer,
			),
			optional: true,
		},
		{
			id: "atuin",
			factory: suppressCommands(atuin, BLOCKED_COMMANDS.atuin),
			optional: true,
		},
		{
			id: "fast-resume",
			factory: upstreamFactory("pi-fast-resume/fast-resume.ts"),
			optional: true,
		},

		{
			id: "btw",
			factory: BTW_MODEL
				? fixedBtwModel(
						upstreamFactory("pi-btw/extensions/btw.js"),
						BTW_MODEL,
					)
				: upstreamFactory("pi-btw/extensions/btw.js"),
			optional: true,
		},
		{
			id: "cwd",
			factory: upstreamFactory("@harms-haus/pi-cwd/src/index.js"),
			optional: true,
		},
		{
			id: "fff",
			factory: suppressCommands(
				upstreamFactory("@ff-labs/pi-fff/src/index.js"),
				BLOCKED_COMMANDS.fff,
			),
			optional: true,
		},
		{
			id: "autoformat",
			optional: true,
			factory: async (api) => {
				await upstreamFactory("@gotgenes/pi-autoformat/src/extension.js")(api);
				autoformatRenderer(api);
			},
		},
		{
			id: "computer-use",
			factory: upstreamFactory(
				"@agent-sh/computer-use-linux/pi/extension/index.js",
			),
			optional: true,
		},
		{
			id: "mcp",
			factory: suppressCommands(
				upstreamFactory("pi-mcp-adapter"),
				BLOCKED_COMMANDS.mcp,
			),
			optional: true,
		},
		{
			id: "ask-user",
			factory: upstreamFactory("pi-ask-user/index.js"),
			optional: true,
		},
		{ id: "rewind", factory: rewind, optional: true },
		{
			id: "subagents",
			factory: upstreamFactory("@tintinweb/pi-subagents/src/index.js"),
			optional: true,
		},
		{
			id: "lsp",
			factory: upstreamFactory("pi-lsp/extensions/pi-lsp/index.js"),
			optional: true,
		},
		{
			id: "web-access",
			factory: suppressCommands(
				(api) => webAccess(api, tools),
				BLOCKED_COMMANDS.webAccess,
			),
			optional: true,
		},
		{ id: "rtk", factory: rtk, optional: true },

		// Functional providers are registered above; the visual renderer is last.
		{
			id: "tool-renderer",
			factory: (api) => toolRenderer(api, tools),
			optional: true,
		},
	];

	try {
		results = await loadModules(pi, modules);
	} finally {
		tools.restore();
	}

	pi.registerCommand("suite", {
		description: "Show Pi suite module status",
		handler: async (_args, ctx) => {
			ctx.ui.notify(
				formatSuiteStatus(results),
				results.some((result) => result.state === "failed")
					? "warning"
					: "info",
			);
		},
	});
}
