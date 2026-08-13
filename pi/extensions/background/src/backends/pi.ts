/**
 * pi backend — real implementation over the pi SDK.
 *
 * Each subagent is an in-process `AgentSession` (a port of v1
 * subagents/manager.ts + shared/child-session.ts):
 * - real session files visible in /resume, child resources loaded per-cwd
 *   with trust gating, and the child tool denylist;
 * - `session.subscribe()` events translated to normalized SubagentEvents;
 * - send() steers a streaming run or starts a fresh prompt() when idle;
 * - interrupt clears the queue and aborts; closing the session scope emits
 *   the child session_shutdown hook and disposes the session.
 */

import type { AssistantMessage, Message, Model } from "@earendil-works/pi-ai";
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import type { Cause, Scope } from "effect";
import { Effect, Queue, Stream } from "effect";
import type { SpawnTask, SubagentEvent, SubagentMeta, SubagentSession, TranscriptPart } from "../domain.ts";
import { SendError, SpawnError } from "../domain.ts";
import {
	bindChildSessionExtensions,
	childToolPolicy,
	createChildResources,
	resolveChildModel,
	shutdownAndDisposeChildSession,
	waitForChildSessionOperation,
} from "../../../shared/child-session.ts";
import { createToolCallTimeoutGuard } from "../../../shared/tool-call-timeout.ts";

type ThinkingLevel = NonNullable<NonNullable<Parameters<typeof createAgentSession>[0]>["thinkingLevel"]>;

// --- Event translation ----------------------------------------------------------

function messageRole(msg: unknown): Message["role"] | undefined {
	const role = (msg as { role?: string } | undefined)?.role;
	if (role === "user" || role === "assistant" || role === "toolResult") return role;
	return undefined;
}

function lastAssistantMessage(session: AgentSession): AssistantMessage | undefined {
	const messages = session.messages;
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (messageRole(msg) === "assistant") return msg as AssistantMessage;
	}
	return undefined;
}

/** Final assistant text output (last assistant message with text), v1 semantics. */
function finalOutput(session: AgentSession): string {
	const messages = session.messages;
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (messageRole(msg) !== "assistant") continue;
		const text = (msg as AssistantMessage).content
			.filter((part) => part.type === "text")
			.map((part) => part.text)
			.join("\n")
			.trim();
		if (text) return text;
	}
	return "";
}

function safeJson(value: unknown): string | undefined {
	try {
		const text = JSON.stringify(value);
		return text === "{}" ? undefined : text;
	} catch {
		return undefined;
	}
}

/** The argument key that best summarizes a call for known tool types. */
const TOOL_SUMMARY_KEY: Record<string, string | null> = {
	bash: "command",
	read: "path",
	write: "path",
	edit: "path",
	fetch_content: "url",
	web_search: "query",
	ffgrep: "pattern",
	fffind: "pattern",
	source_check: "claim",
	subagent_spawn: "name",
	subagent_check: "id",
	subagent_wait: "ids",
	subagent_cancel: "ids",
	subagent_list: null,
	workflow: null,
	ask_user: "question",
};

/**
 * Human-readable one-line preview of tool arguments. Extracts the most
 * meaningful argument for known tools; falls back to the first string value
 * found, then raw JSON.
 */
function toolCallPreview(toolName: string, args: unknown): string | undefined {
	if (!args || typeof args !== "object") return safeJson(args);
	const obj = args as Record<string, unknown>;

	const key = Object.hasOwn(TOOL_SUMMARY_KEY, toolName) ? TOOL_SUMMARY_KEY[toolName] : undefined;

	if (key === null) return undefined; // known, no meaningful args to show

	const target = key !== undefined ? obj[key] : undefined;
	if (typeof target === "string") {
		const first = target.split("\n")[0]?.trim() ?? "";
		return first.slice(0, 300) || undefined;
	}
	if (Array.isArray(target)) {
		const items = (target as unknown[]).filter((v): v is string => typeof v === "string");
		return items.join(", ").slice(0, 300) || undefined;
	}

	// Unknown tool: use the first non-empty string value as a best-effort preview.
	for (const val of Object.values(obj)) {
		if (typeof val === "string" && val.trim()) {
			return (val.split("\n")[0] ?? "").trim().slice(0, 300);
		}
	}

	return safeJson(args);
}

/** First non-empty line of a tool result-ish value (v1 liveToolPreview). */
function toolPreview(value: unknown): string | undefined {
	if (typeof value === "string") {
		return value
			.split("\n")
			.find((line) => line.trim())
			?.trim();
	}
	if (!value || typeof value !== "object") return undefined;
	const content = (value as { content?: unknown }).content;
	if (!Array.isArray(content)) return undefined;
	for (const part of content) {
		if (!part || typeof part !== "object") continue;
		const record = part as { type?: unknown; text?: unknown };
		if (record.type !== "text" || typeof record.text !== "string") continue;
		const firstLine = record.text.split("\n").find((line) => line.trim());
		if (firstLine) return firstLine.trim();
	}
	return undefined;
}

function assistantParts(msg: AssistantMessage): TranscriptPart[] {
	const parts: TranscriptPart[] = [];
	for (const part of msg.content) {
		if (part.type === "text") {
			parts.push({ type: "text", text: part.text });
		} else if (part.type === "thinking") {
			parts.push({
				type: "thinking",
				text: part.redacted ? "" : part.thinking,
				...(part.redacted === undefined ? {} : { redacted: part.redacted }),
			});
		} else if (part.type === "toolCall") {
			const argsPreview = toolCallPreview(part.name, part.arguments);
			parts.push({
				type: "toolCall",
				toolId: part.id,
				name: part.name,
				...(argsPreview === undefined ? {} : { argsPreview }),
			});
		}
	}
	return parts;
}

function userText(msg: Message): string {
	const content = (msg as { content: unknown }).content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter(
			(part): part is { type: "text"; text: string } =>
				!!part && typeof part === "object" && (part as { type?: unknown }).type === "text",
		)
		.map((part) => part.text)
		.join("\n");
}

// --- The session ------------------------------------------------------------------

function boundedError(error: unknown) {
	return (error instanceof Error ? error.message : String(error)).slice(0, 4096);
}

export const spawnPiSession = (task: SpawnTask): Effect.Effect<SubagentSession, SpawnError, Scope.Scope> =>
	Effect.gen(function* () {
		const registry = task.parent.modelRegistry;
		if (!registry) {
			return yield* new SpawnError({
				message: "pi backend requires the parent session's model registry.",
			});
		}

		const model = yield* Effect.try({
			try: () => resolveChildModel(registry, task.model, task.parent.inheritedModel),
			catch: (error) => new SpawnError({ message: boundedError(error) }),
		});
		// pi's thinking levels ARE the shared reasoning-effort scale.
		const thinkingLevel = (task.reasoningEffort ?? task.parent.inheritedThinkingLevel) as ThinkingLevel | undefined;

		const session = yield* Effect.tryPromise({
			try: async () => {
				const { loader, settingsManager } = await createChildResources({
					cwd: task.cwd,
					projectTrusted: task.parent.projectTrusted,
				});
				const { session } = await createAgentSession({
					cwd: task.cwd,
					sessionManager: SessionManager.create(task.cwd),
					settingsManager,
					resourceLoader: loader,
					...(model === undefined ? {} : { model }),
					...(thinkingLevel === undefined ? {} : { thinkingLevel }),
					...childToolPolicy(),
				});
				// Start child extension session hooks/resources in headless mode.
				// A rejection here would otherwise leak the freshly created session:
				// the scope finalizer that owns cleanup is only registered later.
				try {
					await bindChildSessionExtensions(session);
				} catch (error) {
					await shutdownAndDisposeChildSession(session);
					throw error;
				}
				return session;
			},
			catch: (error) => new SpawnError({ message: boundedError(error) }),
		});

		const state = {
			closed: false,
			/** prompt() rejection for the active run; folded into RunSettled. */
			runError: undefined as string | undefined,
			/** One terminal event per run: lifecycle, prompt-rejection, and abort
			 * fallbacks can all race to settle; the first wins. */
			settled: false,
		};

		const events = yield* Queue.make<SubagentEvent, Cause.Done>();
		const emit = (event: SubagentEvent) => {
			Queue.offerUnsafe(events, event);
		};

		const toolTimeout = createToolCallTimeoutGuard();
		toolTimeout.apply(session);

		const activeModel = (): Model<any> | undefined => {
			const sessionModel = session.model;
			const last = lastAssistantMessage(session);
			if (!last) return sessionModel;
			if (sessionModel && (last.provider !== sessionModel.provider || last.model !== sessionModel.id)) {
				// The session changed models after this assistant response.
				return sessionModel;
			}
			return registry.find(last.provider, last.responseModel ?? last.model) ?? sessionModel;
		};

		const currentMeta = (): SubagentMeta => {
			const m = activeModel();
			return {
				...(m ? { modelLabel: `${m.provider}/${m.id}` } : {}),
				...(m?.contextWindow === undefined ? {} : { contextWindow: m.contextWindow }),
				...(session.sessionFile === undefined ? {} : { sessionFilePath: session.sessionFile }),
			};
		};

		const emitUsage = () => {
			const usage = session.getContextUsage();
			const tokens = usage?.tokens;
			const contextWindow = activeModel()?.contextWindow ?? usage?.contextWindow;
			emit({
				_tag: "UsageChanged",
				...(typeof tokens === "number" ? { tokens } : {}),
				...(contextWindow === undefined ? {} : { contextWindow }),
			});
		};

		const settle = () => {
			if (state.settled) return;
			state.settled = true;
			const last = lastAssistantMessage(session);
			const partialText = finalOutput(session) || undefined;
			if (last?.stopReason === "aborted") {
				emit({
					_tag: "RunSettled",
					outcome: { _tag: "Interrupted", ...(partialText === undefined ? {} : { partialText }) },
				});
				return;
			}
			const errorText =
				state.runError ?? (last?.stopReason === "error" ? (last.errorMessage ?? "Run failed") : undefined);
			if (errorText !== undefined) {
				emit({
					_tag: "RunSettled",
					outcome: {
						_tag: "Failed",
						errorText: boundedError(errorText),
						...(partialText === undefined ? {} : { partialText }),
					},
				});
				return;
			}
			emit({
				_tag: "RunSettled",
				outcome: { _tag: "Completed", finalText: finalOutput(session) },
			});
		};

		const handleEvent = (event: AgentSessionEvent) => {
			if (state.closed) return;
			switch (event.type) {
				case "agent_start":
					// Extensions may register tools between runs; guard new ones too.
					toolTimeout.apply(session);
					state.settled = false;
					emit({ _tag: "RunStarted" });
					break;
				case "message_update": {
					const streamEvent = event.assistantMessageEvent;
					if (streamEvent.type === "text_delta") {
						emit({
							_tag: "AssistantDelta",
							kind: "text",
							delta: streamEvent.delta,
						});
					} else if (streamEvent.type === "thinking_delta") {
						emit({
							_tag: "AssistantDelta",
							kind: "thinking",
							delta: streamEvent.delta,
						});
					}
					break;
				}
				case "message_end": {
					const role = messageRole(event.message);
					if (role === "user") {
						const text = userText(event.message as Message);
						if (text.trim()) emit({ _tag: "UserMessage", text });
					} else if (role === "assistant") {
						emit({
							_tag: "AssistantMessage",
							parts: assistantParts(event.message as AssistantMessage),
						});
						emitUsage();
						emit({ _tag: "MetaChanged", meta: currentMeta() });
					}
					// toolResult messages are covered by tool_execution_end.
					break;
				}
				case "tool_execution_start": {
					const argsPreview = toolCallPreview(event.toolName, event.args);
					emit({
						_tag: "ToolStart",
						toolId: event.toolCallId,
						name: event.toolName,
						...(argsPreview === undefined ? {} : { argsPreview }),
					});
					break;
				}
				case "tool_execution_update": {
					const outputPreview = toolPreview(event.partialResult);
					emit({
						_tag: "ToolUpdate",
						toolId: event.toolCallId,
						...(outputPreview === undefined ? {} : { outputPreview }),
					});
					break;
				}
				case "tool_execution_end": {
					const outputPreview = toolPreview(event.result);
					emit({
						_tag: "ToolEnd",
						toolId: event.toolCallId,
						name: event.toolName,
						isError: event.isError,
						...(outputPreview === undefined ? {} : { outputPreview }),
					});
					break;
				}
				case "queue_update":
					emit({
						_tag: "QueueChanged",
						queued: [
							...event.steering.map((text) => ({
								text,
								kind: "steer" as const,
							})),
							...event.followUp.map((text) => ({
								text,
								kind: "follow-up" as const,
							})),
						],
					});
					break;
				case "agent_settled":
					settle();
					break;
			}
		};
		const unsubscribe = session.subscribe(handleEvent);

		yield* Effect.addFinalizer(() =>
			Effect.promise(async () => {
				state.closed = true;
				unsubscribe();
				try {
					session.clearQueue();
				} catch {
					// Continue with abort/dispose.
				}
				await waitForChildSessionOperation(session.abort(), 5_000);
				await shutdownAndDisposeChildSession(session);
				Queue.endUnsafe(events);
			}),
		);

		/** Start a fresh run (v1 manager.run): fire-and-forget, errors -> events. */
		const startRun = (text: string) => {
			state.runError = undefined;
			state.settled = false;
			emit({ _tag: "RunStarted" });
			void session.prompt(text).catch((error) => {
				state.runError = boundedError(error);
				// Preflight failures may never start the agent lifecycle, so no
				// agent_settled will arrive for them.
				if (!session.isStreaming) settle();
			});
		};

		// Session naming is best-effort.
		yield* Effect.try(() => session.sessionManager.appendSessionInfo(`subagent: ${task.title}`)).pipe(Effect.ignore);

		emit({ _tag: "MetaChanged", meta: currentMeta() });
		startRun(task.prompt);

		return {
			meta: Effect.sync(currentMeta),
			events: Stream.fromQueue(events),
			send: (text) =>
				Effect.suspend((): Effect.Effect<void, SendError> => {
					if (state.closed) {
						return new SendError({ message: "Subagent session is closed." });
					}
					if (session.isStreaming) {
						// Steer the active run via the SDK's queue; queue_update events
						// render it, message_end(user) lands it in the transcript. A
						// rejected steer is a real send failure, not a diagnostic.
						return Effect.tryPromise({
							try: () => session.steer(text),
							catch: (error) => new SendError({ message: boundedError(error) }),
						}).pipe(Effect.asVoid);
					}
					return Effect.sync(() => startRun(text));
				}),
			interrupt: Effect.promise(async () => {
				if (state.closed) return;
				try {
					session.clearQueue();
				} catch {
					// Abort regardless.
				}
				await session.abort().catch(() => undefined);
				// Only resolve once streaming has actually stopped: reporting the
				// interrupt as complete while the run keeps working would let the
				// manager settle a run that is still mutating the workspace. The
				// manager bounds this effect at 5s and force-disposes on timeout.
				while (!state.closed && session.isStreaming) {
					await new Promise((resolve) => setTimeout(resolve, 50));
				}
				// No streaming run means no agent_settled will arrive; emit the
				// terminal event (once) so the run cannot look running forever.
				if (!state.closed && !state.settled) {
					state.settled = true;
					emit({ _tag: "RunSettled", outcome: { _tag: "Interrupted" } });
				}
			}),
		} satisfies SubagentSession;
	});
