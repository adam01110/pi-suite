import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import atuin from "./glue/atuin.js";
import autoformatRenderer from "./glue/autoformat-renderer.js";
import cacheStatusColor from "./glue/cache-status.js";
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

export default async function piSuite(pi: ExtensionAPI): Promise<void> {
	const tools = trackToolRegistrations(pi);
	let results: Awaited<ReturnType<typeof loadModules>>;

	const modules: readonly SuiteModule[] = [
		// UI base first. Atuin composes with the editor installed by QOL.
		{
			id: "qol",
			factory: upstreamFactory("@vanillagreen/pi-qol/extensions/qol.js"),
			optional: true,
		},
		{
			id: "header",
			factory: upstreamFactory("pi-cc-header/extensions/pi-cc-header.js"),
			optional: true,
		},
		{
			id: "footer",
			factory: upstreamFactory("pi-footer/src/index.js"),
			optional: true,
		},
		{ id: "cache-status", factory: cacheStatusColor, optional: true },
		{
			id: "cache-optimizer",
			factory: upstreamFactory("pi-cache-optimizer/index.js"),
			optional: true,
		},
		{ id: "atuin", factory: atuin, optional: true },

		{
			id: "btw",
			factory: upstreamFactory("pi-btw/extensions/btw.js"),
			optional: true,
		},
		{
			id: "cwd",
			factory: upstreamFactory("@harms-haus/pi-cwd/src/index.js"),
			optional: true,
		},
		{
			id: "fff",
			factory: upstreamFactory("@ff-labs/pi-fff/src/index.js"),
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
		{ id: "mcp", factory: upstreamFactory("pi-mcp-adapter"), optional: true },
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
			factory: (api) => webAccess(api, tools),
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
