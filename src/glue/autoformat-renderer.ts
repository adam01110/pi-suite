import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

export default function autoformatRenderer(pi: ExtensionAPI): void {
	pi.registerMessageRenderer(
		"autoformat-steering",
		(message, { expanded }, theme) => {
			const content = String(message.content).replace(
				/^\[pi-autoformat\]\s*/,
				"",
			);
			const formatted = content.match(/^Formatted (\d+) file\(s\):\s*([^\n]+)/);
			const failed = content.includes("Failures:");
			const count = formatted?.[1] ?? "0";
			const label = count === "1" ? "file" : "files";
			const status = failed
				? theme.fg("warning", "formatter failures")
				: theme.fg("success", `formatted ${count} ${label}`);
			const hint = expanded ? "" : theme.fg("dim", " · ctrl+o to expand");
			let text = `${theme.fg("accent", "● ")}${theme.fg("text", theme.bold("Autoformat "))}${theme.fg("dim", "· ")}${status}${hint}`;

			if (expanded) {
				const trailing = formatted
					? content.slice(formatted[0].length).trim()
					: content;
				const lines = [
					...(formatted?.[2].split(/,\s*/) ?? []),
					...trailing.split("\n"),
				].filter(Boolean);
				lines.forEach((line, index) => {
					const connector = index === lines.length - 1 ? "└─ " : "├─ ";
					text += `\n${theme.fg("muted", connector)}${theme.fg(failed ? "warning" : "dim", line)}`;
				});
			}

			return new Text(text, 0, 0);
		},
	);
}
