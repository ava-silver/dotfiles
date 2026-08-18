import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	buildGoogleStylePrompt,
	parseGoogleStyleMode,
	readGoogleStyleMode,
	writeGoogleStyleMode,
} from "../google-style.ts";

test("parses Google style modes", () => {
	assert.equal(parseGoogleStyleMode("on"), true);
	assert.equal(parseGoogleStyleMode("new"), true);
	assert.equal(parseGoogleStyleMode("old"), false);
	assert.equal(parseGoogleStyleMode("off"), false);
	assert.equal(parseGoogleStyleMode("status"), undefined);
});

test("persists the Google style mode outside the session", () => {
	const root = mkdtempSync(join(tmpdir(), "google-style-"));
	const statePath = join(root, "state", "google-style.json");
	try {
		assert.equal(readGoogleStyleMode(statePath), false);
		writeGoogleStyleMode(true, statePath);
		assert.equal(readGoogleStyleMode(statePath), true);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("builds a concise Google style prompt", () => {
	const prompt = buildGoogleStylePrompt();
	assert.match(prompt, /every user-facing response/);
	assert.match(prompt, /Use active voice/);
	assert.ok(prompt.length < 500);
});
