import type { TranscriptEntry, WorkflowDetails } from "./model.ts";
import { safeStringify, truncateUtf8, writeFileAtomic } from "./serialization.ts";
import * as path from "node:path";

const ARTIFACT_TRANSCRIPT_MAX_BYTES = 32 * 1024;
const ARTIFACT_TRANSCRIPT_ENTRY_MAX_BYTES = 8 * 1024;
export const WORKFLOW_CHECKPOINT_INTERVAL_MS = 500;
const ENTRY_TRUNCATION_MARKER = "\n[entry truncated]";
const TRANSCRIPT_TRUNCATION_MARKER = "[artifact transcript truncated: older entries omitted]";

function textBytes(text: string) {
	return Buffer.byteLength(text, "utf8");
}

function boundEntry(entry: TranscriptEntry, maxBytes: number) {
	if (textBytes(entry.text) <= maxBytes) return { ...entry };
	const markerBytes = textBytes(ENTRY_TRUNCATION_MARKER);
	const text =
		maxBytes > markerBytes
			? `${truncateUtf8(entry.text, maxBytes - markerBytes)}${ENTRY_TRUNCATION_MARKER}`
			: truncateUtf8(ENTRY_TRUNCATION_MARKER, maxBytes);
	return { ...entry, text };
}

/** Keep the initial prompt plus the newest useful context within the artifact cap. */
export function boundedArtifactTranscript(
	transcript: TranscriptEntry[],
	options: { maxBytes?: number; entryMaxBytes?: number } = {},
) {
	if (transcript.length === 0) return [];
	const maxBytes = Math.max(256, options.maxBytes ?? ARTIFACT_TRANSCRIPT_MAX_BYTES);
	const entryMaxBytes = Math.max(64, Math.min(maxBytes, options.entryMaxBytes ?? ARTIFACT_TRANSCRIPT_ENTRY_MAX_BYTES));
	const bounded = transcript.map((entry) => boundEntry(entry, entryMaxBytes));
	if (bounded.reduce((total, entry) => total + textBytes(entry.text), 0) <= maxBytes) {
		return bounded;
	}

	const initialIndex = transcript.findIndex((entry) => entry.role === "user");
	const initialEntry = transcript[initialIndex >= 0 ? initialIndex : 0];
	if (!initialEntry) return [];
	const initial = boundEntry(initialEntry, Math.min(entryMaxBytes, maxBytes - textBytes(TRANSCRIPT_TRUNCATION_MARKER)));
	const marker: TranscriptEntry = {
		role: "toolResult",
		name: "transcript",
		text: TRANSCRIPT_TRUNCATION_MARKER,
	};
	let remaining = maxBytes - textBytes(initial.text) - textBytes(marker.text);
	const tail: TranscriptEntry[] = [];

	for (let index = transcript.length - 1; index >= 0 && remaining > 0; index--) {
		if (index === initialIndex || (initialIndex < 0 && index === 0)) continue;
		const sourceEntry = transcript[index];
		if (!sourceEntry) continue;
		const entry = boundEntry(sourceEntry, Math.min(entryMaxBytes, remaining));
		tail.push(entry);
		remaining -= textBytes(entry.text);
	}

	tail.reverse();
	return [initial, marker, ...tail];
}

async function writeRunFile(runDir: string, name: string, content: string) {
	await writeFileAtomic(path.join(runDir, name), content);
}

export async function persistWorkflowJson(runDir: string, details: WorkflowDetails): Promise<void> {
	const transcripts = Object.fromEntries(
		details.agents.map((agent) => [agent.index, boundedArtifactTranscript(agent.transcript)]),
	);
	const compact: WorkflowDetails = {
		...details,
		...(details.result !== undefined ? { result: "[stored in result.json]", resultArtifact: "result.json" } : {}),
		transcriptArtifact: "transcripts.json",
		agents: details.agents.map((agent) => ({ ...agent, transcript: [] })),
	};
	const writes = await Promise.allSettled([
		writeRunFile(runDir, "transcripts.json", safeStringify(transcripts, { maxBytes: 2 * 1024 * 1024 })),
		...(details.result === undefined
			? []
			: [writeRunFile(runDir, "result.json", safeStringify(details.result, { maxBytes: 1024 * 1024 }))]),
		writeRunFile(runDir, "workflow.json", safeStringify(compact, { maxBytes: 1024 * 1024 })),
	]);
	const failure = writes.find((result): result is PromiseRejectedResult => result.status === "rejected");
	if (failure) throw failure.reason;
}

/** Coalesce nonblocking checkpoints and persist the latest state on flush. */
export function createWorkflowPersistence(
	runDir: string,
	details: WorkflowDetails,
	options: {
		intervalMs?: number;
		persist?: (runDir: string, details: WorkflowDetails) => Promise<void>;
	} = {},
) {
	const intervalMs = Math.max(0, options.intervalMs ?? WORKFLOW_CHECKPOINT_INTERVAL_MS);
	const persist = options.persist ?? persistWorkflowJson;
	let lastPersistedAt = Date.now();
	let dirty = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let write: Promise<void> | undefined;
	let flushing: Promise<void> | undefined;

	const schedule = (immediate = false) => {
		if (timer || write) return;
		const delay = immediate ? 0 : Math.max(0, intervalMs - (Date.now() - lastPersistedAt));
		timer = setTimeout(() => {
			timer = undefined;
			void startWrite().catch(() => undefined);
		}, delay);
	};

	const startWrite = (): Promise<void> => {
		if (write) return write;
		if (!dirty) return Promise.resolve();
		dirty = false;
		let succeeded = false;
		write = persist(runDir, details)
			.then(() => {
				succeeded = true;
				lastPersistedAt = Date.now();
			})
			.catch((error) => {
				dirty = true;
				throw error;
			})
			.finally(() => {
				write = undefined;
				if (succeeded && dirty && !flushing) schedule();
			});
		return write;
	};

	return {
		checkpoint(options: { immediate?: boolean } = {}) {
			dirty = true;
			if (options.immediate && timer) {
				clearTimeout(timer);
				timer = undefined;
			}
			schedule(options.immediate);
		},
		flush(): Promise<void> {
			if (timer) clearTimeout(timer);
			timer = undefined;
			dirty = true;
			if (!flushing) {
				flushing = (async () => {
					const liveWrite = write;
					if (liveWrite) await liveWrite.catch(() => undefined);
					while (dirty || write) {
						if (write) await write;
						else await startWrite();
					}
				})().finally(() => {
					flushing = undefined;
				});
			}
			return flushing;
		},
	};
}
