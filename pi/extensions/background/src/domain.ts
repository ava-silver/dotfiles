/**
 * Domain model for subagents.
 *
 * Everything downstream of the pi backend (manager, tools, UI) speaks only
 * these types.
 */

import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { Data } from "effect";
import type { Effect } from "effect/Effect";
import type { Stream } from "effect/Stream";

/** Shared reasoning-effort scale (pi's thinking levels). Omitted = inherit the parent level. */
export const REASONING_EFFORTS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export type SubagentStatus = "running" | "done" | "error";

/** Parent-session context resolved by the tool layer and passed opaquely. */
export interface ParentContext {
	readonly parentCwd: string;
	readonly projectTrusted: boolean;
	/** Parent pi model, for the pi backend's "inherit" default. */
	readonly inheritedModel?: { readonly provider: string; readonly id: string };
	readonly inheritedThinkingLevel?: string;
	/** Parent model registry; required by the pi backend to resolve models. */
	readonly modelRegistry?: ModelRegistry;
}

export interface SpawnTask {
	readonly prompt: string;
	readonly title: string;
	readonly cwd: string;
	/** "provider/model-id" or bare model id. Omitted = inherit the parent model. */
	readonly model?: string;
	readonly reasoningEffort?: ReasoningEffort;
	readonly parent: ParentContext;
}

export interface SubagentMeta {
	readonly modelLabel?: string;
	readonly contextWindow?: number;
	readonly sessionFilePath?: string;
	readonly nativeSessionId?: string;
}

// --- Transcript ------------------------------------------------------------

export type TranscriptPart =
	| { readonly type: "text"; readonly text: string }
	| {
			readonly type: "thinking";
			readonly text: string;
			readonly redacted?: boolean;
	  }
	| {
			readonly type: "toolCall";
			readonly toolId: string;
			readonly name: string;
			readonly argsPreview?: string;
	  };

export type TranscriptItem =
	| { readonly kind: "user"; readonly text: string }
	| {
			readonly kind: "assistant";
			readonly parts: ReadonlyArray<TranscriptPart>;
	  }
	| {
			readonly kind: "toolResult";
			readonly toolId: string;
			readonly name: string;
			readonly isError: boolean;
			readonly outputPreview?: string;
	  };

export interface LiveToolState {
	readonly toolId: string;
	readonly name: string;
	readonly argsPreview?: string;
	readonly outputPreview?: string;
	readonly done?: boolean;
	readonly isError?: boolean;
}

export interface QueuedMessage {
	readonly text: string;
	readonly kind: "steer" | "follow-up";
}

// --- Events ------------------------------------------------------------------

export type RunOutcome =
	| { readonly _tag: "Completed"; readonly finalText: string }
	| {
			readonly _tag: "Failed";
			readonly errorText: string;
			readonly partialText?: string;
	  }
	| { readonly _tag: "Interrupted"; readonly partialText?: string };

/**
 * Normalized activity stream. Previews (`argsPreview`, `outputPreview`) are
 * pre-flattened single-line strings because the UI only ever renders one
 * sanitized line, which keeps three different native tool-result shapes out
 * of the interface.
 */
export type SubagentEvent =
	// lifecycle (a session can run multiple turns via send())
	| { readonly _tag: "RunStarted" }
	| { readonly _tag: "RunSettled"; readonly outcome: RunOutcome }
	// transcript building blocks
	| { readonly _tag: "UserMessage"; readonly text: string }
	| {
			readonly _tag: "AssistantDelta";
			readonly kind: "text" | "thinking";
			readonly delta: string;
	  }
	| {
			readonly _tag: "AssistantMessage";
			readonly parts: ReadonlyArray<TranscriptPart>;
			readonly cost?: number;
	  }
	| {
			readonly _tag: "ToolStart";
			readonly toolId: string;
			readonly name: string;
			readonly argsPreview?: string;
	  }
	| {
			readonly _tag: "ToolUpdate";
			readonly toolId: string;
			readonly outputPreview?: string;
	  }
	| {
			readonly _tag: "ToolEnd";
			readonly toolId: string;
			readonly name: string;
			readonly isError: boolean;
			readonly outputPreview?: string;
	  }
	// bookkeeping
	| {
			readonly _tag: "QueueChanged";
			readonly queued: ReadonlyArray<QueuedMessage>;
	  }
	| {
			readonly _tag: "UsageChanged";
			readonly tokens?: number;
			readonly contextWindow?: number;
	  }
	| { readonly _tag: "MetaChanged"; readonly meta: Partial<SubagentMeta> };

// --- Session ----------------------------------------------------------------

/** What the manager consumes from a running subagent session. */
export interface SubagentSession {
	readonly meta: Effect<SubagentMeta>;
	readonly events: Stream<SubagentEvent>;
	send(text: string): Effect<void, SendError>;
	readonly interrupt: Effect<void>;
}

// --- Snapshot ---------------------------------------------------------------

/**
 * The manager folds `SubagentEvent`s into one snapshot per subagent. This is
 * everything the tools, footer status, and both TUI views read.
 */
export interface SubagentSnapshot {
	readonly id: string;
	readonly title: string;
	readonly prompt: string;
	readonly cwd: string;
	readonly status: SubagentStatus;
	readonly createdAt: number;
	readonly settledAt?: number;
	readonly errorText?: string;
	readonly meta: SubagentMeta;
	readonly usage: { readonly tokens?: number; readonly contextWindow?: number };
	/** Cumulative cost of finalized assistant messages. */
	readonly cost: number;
	readonly transcript: ReadonlyArray<TranscriptItem>;
	/** Streaming assistant buffers, cleared when the finalized message lands. */
	readonly liveAssistant?: { readonly text: string; readonly thinking: string };
	readonly liveTools: ReadonlyArray<LiveToolState>;
	readonly queued: ReadonlyArray<QueuedMessage>;
	/** Final text of the most recent completed run (v1 `finalOutput`). */
	readonly finalText: string;
	/** Count of finalized assistant messages (for subagent_check). */
	readonly turns: number;
}

/** Final text, or the live streaming buffer while a run is active (v1 `latestOutput`). */
export function latestText(snap: SubagentSnapshot) {
	const live = snap.liveAssistant?.text.trim();
	if (live) return live;
	return snap.finalText;
}

export function formatElapsed(snap: SubagentSnapshot) {
	const end = snap.settledAt ?? Date.now();
	const totalSeconds = Math.max(0, Math.round((end - snap.createdAt) / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return minutes > 0 ? `${minutes}m${seconds.toString().padStart(2, "0")}s` : `${seconds}s`;
}

// --- Errors -------------------------------------------------------------------

export class SpawnError extends Data.TaggedError("SpawnError")<{
	readonly message: string;
}> {}

export class ConcurrencyLimitError extends Data.TaggedError("ConcurrencyLimitError")<{
	readonly message: string;
}> {}

export class SendError extends Data.TaggedError("SendError")<{
	readonly message: string;
}> {}
