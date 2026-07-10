// Plan mode: plan with a strong model, implement with a fast one.
//
// Flow:
//   /plan <task>  -> switch to the PLAN model (opus, medium thinking), create a
//                    temp plan file, and tell the agent to write a self-contained
//                    plan into it (no restrictions -- edits are fine while planning).
//   When the plan turn ends, a menu offers:
//     - Implement (clear context)    [default] -> fresh session seeded with only
//                                                  the plan, on the IMPL model.
//     - Implement (preserve context) -> same session, switch to the IMPL model.
//     - Refine                       -> stay on the PLAN model, send feedback.
//
// Model switching is effectively session-specific: session_start re-asserts the
// right model per phase, so setModel's global persistence doesn't leak between
// sessions. New sessions default to a separate general-purpose model.

import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

type ModelSpec = { provider: string; id: string };
type Thinking = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

// oxlint-disable-next-line no-unused-vars
const OPUS: ModelSpec = { provider: "anthropic", id: "claude-opus-4-8" };
const GPT_SOL: ModelSpec = { provider: "openai-codex", id: "gpt-5.6-sol" };
const GPT_TERRA: ModelSpec = { provider: "openai-codex", id: "gpt-5.6-terra" };
const GPT_LUNA: ModelSpec = { provider: "openai-codex", id: "gpt-5.6-luna" };
const DEFAULT_MODEL: ModelSpec = GPT_TERRA;
const DEFAULT_THINKING: Thinking = "low";
const PLAN_MODEL: ModelSpec = GPT_SOL;
const PLAN_THINKING: Thinking = "medium";
const IMPL_MODEL: ModelSpec = GPT_LUNA;
const IMPL_THINKING: Thinking = "low";

const IMPLEMENT_MARKER = "plan-mode-implement";
const FILE_MARKER = "plan-mode-file";

export default function planModeExtension(pi: ExtensionAPI): void {
	let planFilePath: string | undefined;
	let planPhase = false;
	let implementPhase = false;
	let planReady = false;

	async function applyModel(ctx: ExtensionContext, spec: ModelSpec, thinking: Thinking): Promise<boolean> {
		const model = ctx.modelRegistry.find(spec.provider, spec.id);
		if (!model) {
			ctx.ui.notify(`plan-mode: model not found: ${spec.provider}/${spec.id}`, "error");
			return false;
		}
		const ok = await pi.setModel(model);
		if (!ok) {
			ctx.ui.notify(`plan-mode: no API key for ${spec.provider}/${spec.id}`, "error");
			return false;
		}
		pi.setThinkingLevel(thinking);
		return true;
	}

	function planKickoff(task: string, path: string): string {
		if (!task.trim()) {
			return `You are now in PLAN MODE. No task has been given yet.

Briefly acknowledge that you're ready to plan and ask the user to describe the task. Do NOT call the \`plan_ready\` tool and do NOT write a plan yet -- wait for the user's next message.

When you eventually finish a plan, write it to this file:
${path}

The plan is handed to a separate agent with NO prior context, so include:
- The goal and any relevant background
- Exact files/paths to touch
- Step-by-step changes
- Gotchas, edge cases, and how to verify

Only once the plan file is written and complete, call the \`plan_ready\` tool with a one-line summary. Do not call it before the plan is actually finished.`;
		}
		return `You are in PLAN MODE. Your goal right now is to produce an implementation plan -- do NOT start implementing yet.

Task:
${task}

Explore the codebase as needed to understand the work. Then write a detailed, self-contained implementation plan to this file:
${path}

The plan is handed to a separate agent with NO prior context, so include:
- The goal and any relevant background
- Exact files/paths to touch
- Step-by-step changes
- Gotchas, edge cases, and how to verify

When the plan file is written and complete, call the \`plan_ready\` tool with a one-line summary. Do not call it before the plan is actually finished.`;
	}

	function implementKickoff(path: string, plan: string): string {
		return `You are implementing a pre-written plan. You have NO prior context beyond this message.

Follow this plan exactly. It also lives at ${path} for reference.

--- PLAN ---
${plan}
--- END PLAN ---

Implement it. Only ask if something is ambiguous or blocked.`;
	}

	pi.registerCommand("plan", {
		description: "Plan a task with a strong model, then implement with a fast one",
		handler: async (args, ctx) => {
			const path = join(tmpdir(), `pi-plan-${Date.now()}.md`);
			writeFileSync(path, "");
			planFilePath = path;
			planPhase = true;
			implementPhase = false;
			planReady = false;

			pi.appendEntry(FILE_MARKER, { path, planPhase: true });
			await applyModel(ctx, PLAN_MODEL, PLAN_THINKING);
			ctx.ui.notify(`Plan mode: ${PLAN_MODEL.id} (${PLAN_THINKING}). Plan file: ${path}`, "info");

			const kickoff = planKickoff(args?.trim() ?? "", path);
			if (ctx.isIdle()) pi.sendUserMessage(kickoff);
			else pi.sendUserMessage(kickoff, { deliverAs: "followUp" });
		},
	});

	// Bridge used by the "clear context" menu choice (needs command-only newSession).
	pi.registerCommand("plan-implement", {
		description: "Implement the current plan in a fresh, context-cleared session",
		handler: async (_args, ctx) => {
			if (!planFilePath) {
				ctx.ui.notify("plan-mode: no plan file. Run /plan first.", "error");
				return;
			}
			const path = planFilePath;
			let plan = "";
			try {
				plan = readFileSync(path, "utf-8");
			} catch {
				ctx.ui.notify(`plan-mode: could not read plan file ${path}`, "error");
				return;
			}
			if (!plan.trim()) {
				ctx.ui.notify("plan-mode: plan file is empty -- refine the plan first.", "error");
				return;
			}

			const parentSession = ctx.sessionManager.getSessionFile() ?? undefined;
			await ctx.newSession({
				parentSession,
				setup: async (sm) => {
					sm.appendCustomEntry(IMPLEMENT_MARKER, { planPath: path });
				},
				withSession: async (sctx) => {
					await sctx.sendUserMessage(implementKickoff(path, plan));
				},
			});
		},
	});

	// Model-controlled signal that the plan is finished and ready for review.
	pi.registerTool({
		name: "plan_ready",
		label: "Plan ready",
		description:
			"Signal that the implementation plan is complete and written to the plan file. " +
			"Call this only when the plan is finished and ready for the user to review or implement.",
		promptSnippet: "Signal that the plan file is complete and ready",
		promptGuidelines: [
			"Use plan_ready only after you have written a complete, self-contained plan to the plan file; do not call plan_ready to acknowledge, ask questions, or mid-planning.",
		],
		parameters: Type.Object({
			summary: Type.Optional(Type.String({ description: "One-line summary of the finished plan" })),
		}),
		async execute(_toolCallId, params) {
			planReady = true;
			const summary = (params?.summary ?? "").trim();
			return {
				content: [{ type: "text", text: summary ? `Plan ready: ${summary}` : "Plan ready." }],
				details: {},
				terminate: true,
			};
		},
	});

	// After a planning turn, offer next actions.
	pi.on("agent_end", async (_event, ctx) => {
		if (!planPhase || implementPhase || !ctx.hasUI) return;
		if (!planFilePath) return;
		if (!planReady) return; // wait for the model to declare the plan finished
		planReady = false; // consume the signal so we don't re-show on later turns

		const choice = await ctx.ui.select("Plan ready -- what next?", [
			"Implement (clear context)",
			"Implement (preserve context)",
			"Refine the plan",
		]);
		if (!choice) return;

		if (choice.startsWith("Implement (clear")) {
			// sendUserMessage does NOT dispatch slash commands (it calls prompt() with
			// command handling disabled), and event-handler contexts lack newSession.
			// Prefill the command so it runs through the real command path on submit.
			planPhase = false;
			ctx.ui.setEditorText("/plan-implement");
			ctx.ui.notify("Press Enter to implement in a fresh, context-cleared session.", "info");
		} else if (choice.startsWith("Implement (preserve")) {
			planPhase = false;
			await applyModel(ctx, IMPL_MODEL, IMPL_THINKING);
			pi.sendUserMessage(`Now implement the plan you wrote in ${planFilePath}. Follow it step by step.`, {
				deliverAs: "followUp",
			});
		} else {
			const refinement = await ctx.ui.editor("Refine the plan:", "");
			if (refinement?.trim()) pi.sendUserMessage(refinement.trim(), { deliverAs: "followUp" });
		}
	});

	// Re-assert the right model per phase whenever a session starts.
	pi.on("session_start", async (event, ctx) => {
		const entries = ctx.sessionManager.getEntries() as Array<{ type: string; customType?: string; data?: unknown }>;

		const isImplement = entries.some((e) => e.type === "custom" && e.customType === IMPLEMENT_MARKER);
		if (isImplement) {
			implementPhase = true;
			planPhase = false;
			await applyModel(ctx, IMPL_MODEL, IMPL_THINKING);
			return;
		}

		// Restore plan file / phase on resume.
		const fileEntry = entries.filter((e) => e.type === "custom" && e.customType === FILE_MARKER).pop();
		if (fileEntry?.data) {
			const data = fileEntry.data as { path?: string; planPhase?: boolean };
			if (data.path) planFilePath = data.path;
			if (data.planPhase) planPhase = true;
		}

		if (event.reason === "startup" || event.reason === "new") {
			await applyModel(ctx, DEFAULT_MODEL, DEFAULT_THINKING);
		}
	});
}
