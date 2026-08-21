import { contentText } from "@earendil-works/pi-ai";
import {
	DynamicBorder,
	type ExtensionAPI,
	type ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import type { AnyToolDefinition, ToolTracker } from "../tool-tracker.js";
import { importUpstream } from "../upstream.js";

const BATCH_VALIDATION_PREFIX = 'Validation failed for tool "tool_batch":';

const LSP_TOOL_NAMES = [
	// keep-sorted start
	"lsp_definition",
	"lsp_diagnostics",
	"lsp_hover",
	"lsp_references",
	"lsp_symbols",
	// keep-sorted end
] as const;

function resultText(
	result: Parameters<NonNullable<AnyToolDefinition["renderResult"]>>[0],
): string {
	return contentText(result.content).trim();
}

function lspCallText(
	definition: AnyToolDefinition,
	args: unknown,
	theme: Parameters<NonNullable<AnyToolDefinition["renderCall"]>>[1],
): string {
	const input = args as { path?: unknown };
	const path =
		typeof input.path === "string" ? ` ${theme.fg("muted", input.path)}` : "";
	return `${theme.fg("success", "● ")}${theme.fg("text", theme.bold(definition.label))}${path}`;
}

function normalizeDiagnosticsText(text: string): string {
	return text.replace(/^(?:\u2705|\u26a0\ufe0f?)\s*/gm, "");
}

export function diagnosticsDisplayText(text: string): string {
	const display = normalizeDiagnosticsText(text)
		.replace(/^LSP diagnostics:\s*/i, "")
		.trim();
	const lines = display.split("\n");
	if (lines.length === 2 && lines[0]?.endsWith(":")) {
		return `${lines[0]} ${lines[1]}`;
	}
	return display;
}

export function latestDiagnosticsResult(
	content: ToolResultEvent["content"],
): ToolResultEvent["content"] {
	for (let index = content.length - 1; index >= 0; index--) {
		const item = content[index];
		if (item?.type !== "text" || !item.text.startsWith("LSP diagnostics:")) {
			continue;
		}
		return [{ ...item, text: normalizeDiagnosticsText(item.text) }];
	}
	return content;
}

export function batchValidationText(raw: string): string | undefined {
	if (!raw.startsWith(BATCH_VALIDATION_PREFIX)) return;
	const issue = raw
		.match(/\n\s*-\s*(.+?)\n\nReceived arguments:/s)?.[1]
		?.trim();
	const callIndex = issue?.match(/^calls\.(\d+)\.tool:/)?.[1];
	const argumentsText = raw.split("\n\nReceived arguments:\n", 2)[1];
	if (callIndex !== undefined && argumentsText) {
		try {
			const args = JSON.parse(argumentsText) as {
				calls?: Array<{ name?: unknown; tool?: unknown }>;
			};
			const call = args.calls?.[Number(callIndex)];
			const tool = call?.tool ?? call?.name;
			if (typeof tool === "string") {
				return `Call ${Number(callIndex) + 1} uses unsupported tool ${tool}.\nAllowed tools: read, grep, find, ls, bash.`;
			}
		} catch {
			// Fall back to the concise validator message below.
		}
	}
	return issue ?? "Invalid batch arguments.";
}

function compactBatchValidation(
	definition: AnyToolDefinition,
): AnyToolDefinition {
	return {
		...definition,
		renderResult(result, options, theme, context) {
			const firstText = result.content.find((part) => part.type === "text");
			if (
				!firstText?.text.startsWith(BATCH_VALIDATION_PREFIX) &&
				definition.renderResult
			) {
				return definition.renderResult(result, options, theme, context);
			}

			const raw = resultText(result);
			const validation = batchValidationText(raw);
			if (!validation) return new Text(raw || "no output", 0, 0);
			const [problem, allowed] = validation.split("\n", 2);
			return new Text(
				`${theme.fg("error", "● ")}${theme.fg("text", theme.bold("Tool Batch"))}${theme.fg("error", " · validation failed")}\n${theme.fg(
					"toolOutput",
					theme.bold(problem ?? validation),
				)}${allowed ? `\n${theme.fg("muted", allowed)}` : ""}`,
				0,
				0,
			);
		},
	};
}

function rememberToolCall(toolCalls: Set<string>, toolCallId: string): void {
	toolCalls.add(toolCallId);
	if (toolCalls.size <= 100) return;
	const oldest = toolCalls.values().next().value;
	if (oldest) toolCalls.delete(oldest);
}

function compactLspDefinition(
	definition: AnyToolDefinition,
	diagnosticsCalls: Set<string>,
): AnyToolDefinition {
	return {
		...definition,
		renderShell: "self",
		async execute(toolCallId, params, signal, onUpdate, context) {
			if (definition.name === "lsp_diagnostics")
				rememberToolCall(diagnosticsCalls, toolCallId);
			return definition.execute(toolCallId, params, signal, onUpdate, context);
		},
		renderCall(args, theme, context) {
			if (context.executionStarted) return new Text("", 0, 0);
			return new Text(lspCallText(definition, args, theme), 0, 0);
		},
		renderResult(result, { isPartial, expanded }, theme, context) {
			if (isPartial) return new Text(theme.fg("dim", "working…"), 0, 0);
			const text = resultText(result);
			const raw =
				definition.name === "lsp_diagnostics"
					? diagnosticsDisplayText(text)
					: text;
			if (context.isError)
				return new Text(
					theme.fg("error", raw.split("\n")[0] || "LSP request failed"),
					0,
					0,
				);
			if (!raw) return new Text(theme.fg("dim", "no results"), 0, 0);
			const lines = raw.split("\n");
			const visible = expanded ? lines : lines.slice(0, 4);
			const suffix =
				!expanded && lines.length > visible.length
					? `\n${theme.fg("dim", `… ${lines.length - visible.length} more`)}`
					: "";
			return new Text(
				`${theme.fg("toolOutput", visible.join("\n"))}${suffix}`,
				0,
				0,
			);
		},
	};
}

export default async function toolRendererAdapter(
	pi: ExtensionAPI,
	tracker: ToolTracker,
): Promise<void> {
	const originals = new Map(
		["grep", "find"].map((name) => [name, tracker.get(name)] as const),
	);

	const unblock = tracker.block(new Set(["grep", "find"]));
	try {
		const toolRenderer = await importUpstream(
			"@vanillagreen/pi-tool-renderer/extensions/tool-renderer.js",
		);
		await toolRenderer.default(pi);
	} finally {
		unblock();
	}

	for (const definition of originals.values()) {
		if (definition) pi.registerTool(definition);
	}

	// Pi 0.84.2's public declarations omit ToolResultEventResult, which
	// removes this valid overload from consumers under skipLibCheck.
	const onToolResult = pi.on.bind(pi) as unknown as (
		event: "tool_result",
		handler: (
			event: ToolResultEvent,
		) => { content: ToolResultEvent["content"] } | void,
	) => void;
	onToolResult("tool_result", (event) => {
		if (event.toolName !== "lsp_diagnostics") return;
		const content = latestDiagnosticsResult(event.content);
		if (content === event.content) return;
		return { content };
	});

	const batch = tracker.get("tool_batch");
	if (batch) pi.registerTool(compactBatchValidation(batch));

	const diagnosticsCalls = new Set<string>();
	pi.registerMessageRenderer(
		"pi-lsp-diagnostics",
		(message, _options, theme) => {
			const details = message.details as
				| { path?: unknown; summary?: unknown; toolCallId?: unknown }
				| undefined;
			if (
				typeof details?.toolCallId === "string" &&
				diagnosticsCalls.has(details.toolCallId)
			) {
				return new Text("", 0, 0);
			}
			const path =
				typeof details?.path === "string"
					? ` ${theme.fg("muted", details.path)}`
					: "";
			const summary =
				typeof details?.summary === "string"
					? diagnosticsDisplayText(details.summary)
					: "";
			const title = `${theme.fg("warning", "● ")}${theme.fg("text", theme.bold("LSP Diagnostics"))}${path}`;
			const container = new Container();
			const border = () =>
				new DynamicBorder((text: string) => theme.fg("borderMuted", text));
			container.addChild(border());
			container.addChild(
				new Text(
					summary ? `${title}\n${theme.fg("toolOutput", summary)}` : title,
					0,
					0,
				),
			);
			container.addChild(border());
			return container;
		},
	);

	for (const name of LSP_TOOL_NAMES) {
		const definition = tracker.get(name);
		if (definition)
			pi.registerTool(compactLspDefinition(definition, diagnosticsCalls));
	}
}
