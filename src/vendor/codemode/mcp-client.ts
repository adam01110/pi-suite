// mcp-client.ts — MCP bridge backed by pi-mcp-adapter's proxy tool and metadata cache.

import type { AgentToolUpdateCallback } from "@earendil-works/pi-agent-core";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadMcpConfig } from "pi-mcp-adapter/config";
import {
	isServerCacheValid,
	loadMetadataCache,
} from "pi-mcp-adapter/metadata-cache";
import type { AnyToolDefinition } from "../../tool-tracker.js";
import { generateParamSummary } from "./type-generator.js";

/** Info about an MCP tool from the adapter metadata cache. */
export interface McpToolInfo {
	name: string;
	description?: string;
	inputSchema?: unknown;
}

/** Info about an MCP server and its tools. */
export interface McpServerInfo {
	serverName: string;
	/** Short namespace used in code: tools.<namespace>.toolName(). */
	namespace: string;
	tools: McpToolInfo[];
	fromCache: boolean;
}

export interface McpCallContext {
	toolCallId: string;
	signal?: AbortSignal;
	onUpdate?: AgentToolUpdateCallback;
	extensionContext: ExtensionContext;
}

export interface McpClient {
	getServers(): McpServerInfo[];
	call(
		namespace: string,
		toolName: string,
		args: Record<string, unknown> | undefined,
		context: McpCallContext,
	): Promise<string>;
	search(query: string): string;
	listServers(): string[];
	shutdown(): Promise<void>;
	readonly available: boolean;
}

export function createMcpClient(proxyTool?: AnyToolDefinition): McpClient {
	const config = loadMcpConfig();
	const serverNames = Object.keys(config.mcpServers);
	const cache = loadMetadataCache();
	const servers = new Map<string, McpServerInfo>();

	for (const serverName of serverNames) {
		const namespace = toNamespace(serverName);
		const definition = config.mcpServers[serverName];
		const cached = cache?.servers?.[serverName];
		const tools =
			cached && definition && isServerCacheValid(cached, definition)
				? cached.tools.map((tool) => ({
						name: tool.name,
						description: tool.description,
						inputSchema: tool.inputSchema,
					}))
				: [];

		servers.set(namespace, {
			serverName,
			namespace,
			tools,
			fromCache: tools.length > 0,
		});
	}

	return {
		get available() {
			return proxyTool !== undefined && serverNames.length > 0;
		},

		getServers() {
			return [...servers.values()];
		},

		async call(namespace, toolName, args, context) {
			if (!proxyTool) throw new Error("MCP adapter proxy is unavailable");
			const server = servers.get(namespace);
			if (!server)
				throw new Error(`Unknown MCP server namespace: "${namespace}"`);

			const result = await proxyTool.execute(
				`${context.toolCallId}-mcp-${server.serverName}-${toolName}`,
				{
					tool: toolName,
					server: server.serverName,
					args: args ?? {},
				},
				context.signal,
				context.onUpdate,
				context.extensionContext,
			);
			const text = result.content
				.filter((content) => content.type === "text")
				.map((content) => content.text)
				.join("\n");

			if (
				typeof result.details === "object" &&
				result.details !== null &&
				"error" in result.details
			) {
				const tool = server.tools.find(
					(candidate) => candidate.name === toolName,
				);
				const parameters = tool?.inputSchema
					? `\n\n${generateParamSummary(tool.inputSchema)}`
					: "";
				throw new Error(
					`MCP tool error: tools.${namespace}.${toolName}()\n\n${text}${parameters}`,
				);
			}

			return text || "(empty result)";
		},

		search(query) {
			const terms = query
				.toLowerCase()
				.split(/\s+/)
				.filter((term) => term.length > 0);
			if (terms.length === 0) return "Empty search query.";

			const matches = [...servers.values()]
				.flatMap((server) =>
					server.tools.map((tool) => {
						const searchText =
							`${server.namespace} ${tool.name} ${tool.description ?? ""}`.toLowerCase();
						return {
							namespace: server.namespace,
							tool: tool.name,
							description: tool.description ?? "",
							score: terms.filter((term) => searchText.includes(term)).length,
						};
					}),
				)
				.filter(({ score }) => score > 0)
				.sort((left, right) =>
					right.score === left.score
						? left.tool.localeCompare(right.tool)
						: right.score - left.score,
				)
				.slice(0, 30);

			if (matches.length === 0) return `No MCP tools matching "${query}".`;

			return matches
				.map(
					(match) =>
						`tools.${match.namespace}.${match.tool}()\n  ${match.description || "(no description)"}`,
				)
				.join("\n\n");
		},

		listServers() {
			return serverNames;
		},

		async shutdown() {},
	};
}

function toNamespace(serverName: string): string {
	return serverName.replace(/-?mcp$/i, "").replace(/-/g, "_") || "mcp";
}
