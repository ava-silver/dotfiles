import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { boundedArtifactTranscript, createWorkflowPersistence, persistWorkflowJson } from "./artifacts.ts";
import { emptyUsage, type TranscriptEntry, type WorkflowDetails } from "./model.ts";

function workflowDetails(): WorkflowDetails {
	return {
		runId: "wf_fixture",
		sessionId: "session_fixture",
		background: false,
		status: "running",
		startedAt: 1,
		phases: [],
		agents: [],
	};
}

test("artifact transcript keeps the initial prompt, marker, and newest entries", () => {
	const prompt = `initial:${"p".repeat(70)}`;
	const transcript = [
		{ role: "user" as const, text: prompt },
		...Array.from({ length: 5 }, (_, index) => ({
			role: "assistant" as const,
			text: `entry-${index}:${String(index).repeat(70)}`,
		})),
	];

	const bounded = boundedArtifactTranscript(transcript, {
		maxBytes: 256,
		entryMaxBytes: 80,
	});

	assert.equal(bounded[0]?.role, "user");
	assert.equal(bounded[0]?.text, prompt);
	assert.match(bounded[1]?.text ?? "", /artifact transcript truncated/);
	assert.equal(bounded.at(-1)?.text, transcript.at(-1)?.text);
	assert.equal(
		bounded.some((entry) => entry.text.startsWith("entry-0:")),
		false,
	);
	assert.ok(bounded.reduce((total, entry) => total + Buffer.byteLength(entry.text, "utf8"), 0) <= 256);
});

test("live artifact persistence includes current agents and transcripts", async () => {
	const directory = mkdtempSync(join(tmpdir(), "pi-workflow-artifacts-"));
	try {
		const details = workflowDetails();
		details.agents.push({
			index: 1,
			label: "running-fixture",
			state: "running",
			startedAt: 2,
			preview: "working",
			usage: emptyUsage(),
			transcript: [
				{ role: "user", text: "current prompt" },
				{
					role: "tool",
					name: "fixture",
					toolCallId: "call-fixture",
					text: "{}",
					startedAt: 10,
					finishedAt: 25,
					durationMs: 15,
				},
			],
		});

		await persistWorkflowJson(directory, details);

		const workflow = JSON.parse(readFileSync(join(directory, "workflow.json"), "utf8")) as WorkflowDetails;
		const transcripts = JSON.parse(readFileSync(join(directory, "transcripts.json"), "utf8")) as Record<
			string,
			TranscriptEntry[]
		>;
		assert.equal(workflow.agents.length, 1);
		assert.equal(workflow.agents[0]?.label, "running-fixture");
		assert.equal(transcripts["1"]?.[0]?.text, "current prompt");
		assert.deepEqual(
			{
				toolCallId: transcripts["1"]?.[1]?.toolCallId,
				startedAt: transcripts["1"]?.[1]?.startedAt,
				finishedAt: transcripts["1"]?.[1]?.finishedAt,
				durationMs: transcripts["1"]?.[1]?.durationMs,
			},
			{
				toolCallId: "call-fixture",
				startedAt: 10,
				finishedAt: 25,
				durationMs: 15,
			},
		);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("workflow persistence coalesces writes and flushes the latest state", async () => {
	const details = workflowDetails();
	const snapshots: WorkflowDetails[] = [];
	let release: (() => void) | undefined;
	let writes = 0;
	const persistence = createWorkflowPersistence("fixture", details, {
		intervalMs: 0,
		persist: async (_runDir, current) => {
			writes += 1;
			snapshots.push(structuredClone(current));
			if (writes < 3) {
				await new Promise<void>((resolve) => {
					release = resolve;
				});
			}
		},
	});

	details.currentPhase = "Scan";
	persistence.checkpoint({ immediate: true });
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(writes, 1);
	details.currentPhase = "Review";
	persistence.checkpoint({ immediate: true });
	assert.equal(writes, 1);
	release?.();
	await new Promise((resolve) => setTimeout(resolve, 10));
	assert.equal(writes, 2);
	release?.();
	await persistence.flush();
	assert.equal(snapshots.at(-1)?.currentPhase, "Review");
});

test("workflow persistence retries a live failure on final flush", async () => {
	const details = workflowDetails();
	let attempts = 0;
	const persistence = createWorkflowPersistence("fixture", details, {
		intervalMs: 0,
		persist: async () => {
			attempts += 1;
			if (attempts === 1) throw new Error("disk full");
		},
	});

	persistence.checkpoint({ immediate: true });
	await new Promise((resolve) => setTimeout(resolve, 10));
	await persistence.flush();
	assert.equal(attempts, 2);
});

test("workflow persistence surfaces a final write failure", async () => {
	const persistence = createWorkflowPersistence("fixture", workflowDetails(), {
		intervalMs: 0,
		persist: async () => {
			throw new Error("disk full");
		},
	});

	await assert.rejects(persistence.flush(), /disk full/);
});
