import assert from "node:assert/strict";
import test from "node:test";
import { Editor } from "@earendil-works/pi-tui";
import { installMidLineSlashTrigger } from "./skill-anywhere-compat.ts";

test("installed Pi TUI supports the mid-line slash compatibility patch", () => {
	const prototype = Editor.prototype as unknown as {
		__skillAnywherePatched?: boolean;
		setAutocompleteTriggerCharacters?: unknown;
	};
	assert.doesNotThrow(installMidLineSlashTrigger);
	const installed = prototype.setAutocompleteTriggerCharacters;
	assert.equal(typeof installed, "function");
	assert.equal(prototype.__skillAnywherePatched, true);
	assert.doesNotThrow(installMidLineSlashTrigger);
	assert.equal(prototype.setAutocompleteTriggerCharacters, installed);
});
