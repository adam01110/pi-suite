import { describe, expect, test } from "bun:test";
import { opensHistorySearch } from "../src/glue/atuin.js";

const editor = (text: string) => ({ getText: () => text });
const UP = "\x1b[A";
const DOWN = "\x1b[B";

describe("atuin history shortcut", () => {
	test("opens the history search on up from an empty editor", () => {
		expect(opensHistorySearch(editor(""), UP)).toBe(true);
	});

	test("does not open the search once the editor has text", () => {
		expect(opensHistorySearch(editor("draft"), UP)).toBe(false);
	});

	test("leaves other keys to the previous shortcut handler", () => {
		expect(opensHistorySearch(editor(""), DOWN)).toBe(false);
	});
});
