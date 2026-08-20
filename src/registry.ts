import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type ModuleState = "loaded" | "disabled" | "failed";
export type ExtensionFactory = (pi: ExtensionAPI) => void | Promise<void>;

export interface SuiteModule {
	readonly id: string;
	readonly factory: ExtensionFactory;
	readonly optional?: boolean;
}

export interface ModuleResult {
	readonly id: string;
	readonly state: ModuleState;
	readonly error?: string;
}

export const DISABLED_MODULES_ENV = "PI_SUITE_DISABLED";

export function parseDisabledModules(value: string | undefined): Set<string> {
	return new Set(
		(value ?? "")
			.split(",")
			.map((id) => id.trim())
			.filter(Boolean),
	);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export async function loadModules(
	pi: ExtensionAPI,
	modules: readonly SuiteModule[],
	disabled = parseDisabledModules(process.env[DISABLED_MODULES_ENV]),
): Promise<ModuleResult[]> {
	const results: ModuleResult[] = [];

	for (const module of modules) {
		if (disabled.has(module.id)) {
			results.push({ id: module.id, state: "disabled" });
			continue;
		}

		try {
			await module.factory(pi);
			results.push({ id: module.id, state: "loaded" });
		} catch (error) {
			const message = errorMessage(error);
			results.push({ id: module.id, state: "failed", error: message });
			console.error(`[pi-suite] ${module.id} failed: ${message}`);
			if (!module.optional) throw error;
		}
	}

	return results;
}

export function formatSuiteStatus(results: readonly ModuleResult[]): string {
	const list = (state: ModuleState) =>
		results
			.filter((result) => result.state === state)
			.map((result) =>
				state === "failed" && result.error
					? `${result.id} (${result.error})`
					: result.id,
			)
			.join(", ") || "none";

	return `loaded: ${list("loaded")}\ndisabled: ${list("disabled")}\nfailed: ${list("failed")}`;
}
