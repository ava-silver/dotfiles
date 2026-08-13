/**
 * Powerline footer for pi.
 *
 * Replaces the default footer with a powerline-style status bar using sharp
 * arrows (► ◄) and Catppuccin Frappé colors.
 *
 * Left side — session identity:
 *   [model ►][  branch ►][+N -N ►]
 *
 * Right side — telemetry + transient segments:
 *   [◄ registered transient segments...][◄ 12.3k/200k (6%) ◄][◄ 󰥔 Xm ago ◄][◄ $0.00]
 *
 * Other extensions can inject temporary segments (e.g. spinners) via:
 *   import { registerTransientSegment } from "./shared/footer-segments.ts";
 *   registerTransientSegment("my-ext", { text: "⟳ fetching", bg: "#81c8be", fg: "#232634" });
 *   registerTransientSegment("my-ext", null); // clear
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
import { visibleWidth, truncateToWidth } from "@earendil-works/pi-tui";
import { getTransientSegments, setTransientOnChange } from "./shared/footer-segments.ts";

// ── Powerline characters ────────────────────────────────────────────────────
const ARROW_RIGHT = "\uE0B4"; //  right half-circle
const ARROW_LEFT = "\uE0B6"; //  left half-circle

// ── Catppuccin Frappé palette (hardcoded for powerline separator rendering) ─
// These are used for segment backgrounds; fg choices are derived from them.
const C = {
	// Backgrounds
	bg: "#303446", // page background (used as implicit "empty" color)
	panel: "#292c3c",
	panelAlt: "#232634",
	selected: "#414559",
	border: "#626880",
	// Accent backgrounds
	purple: "#ca9ee6",
	blue: "#8caaee",
	cyan: "#81c8be",
	green: "#a6d189",
	red: "#e78284",
	yellow: "#e5c890",
	// Foregrounds
	text: "#c6d0f5",
	muted: "#a5adce",
	dim: "#838ba7",
	dark: "#1e2030", // dark text for use on bright bg segments
} as const;

// Thinking level → { bg, fg, label }
const THINKING: Record<ThinkingLevel, { bg: string; fg: string; label: string }> = {
	off: { bg: C.panelAlt, fg: C.dim, label: "off" },
	minimal: { bg: C.selected, fg: C.muted, label: "min" },
	low: { bg: C.border, fg: C.text, label: "low" },
	medium: { bg: C.cyan, fg: C.dark, label: "med" },
	high: { bg: C.blue, fg: C.dark, label: "high" },
	xhigh: { bg: C.yellow, fg: C.dark, label: "x-hi" },
	max: { bg: C.red, fg: C.dark, label: "max" },
};

// ── ANSI helpers ────────────────────────────────────────────────────────────
function hexToRgb(hex: string): [number, number, number] {
	const n = parseInt(hex.replace("#", ""), 16);
	return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}
function fgHex(hex: string): string {
	const [r, g, b] = hexToRgb(hex);
	return `\x1b[38;2;${r};${g};${b}m`;
}
function bgHex(hex: string): string {
	const [r, g, b] = hexToRgb(hex);
	return `\x1b[48;2;${r};${g};${b}m`;
}
const RESET = "\x1b[0m";
const RESET_BG = "\x1b[49m";

// ── Segment type ────────────────────────────────────────────────────────────
type Seg = {
	/** Visible text, no ANSI codes. Padded with one space each side. */
	text: string;
	/** Hex background color. */
	bg: string;
	/** Hex foreground color. */
	fg: string;
};

// ── Powerline rendering ─────────────────────────────────────────────────────

/**
 * Render left-side segments with right-pointing arrows between them.
 * The final arrow fades back to the terminal default background.
 */
function renderLeft(segs: Seg[]): string {
	const first = segs[0];
	if (!first) return "";
	let out = RESET_BG + fgHex(first.bg) + ARROW_LEFT;
	for (let i = 0; i < segs.length; i++) {
		const s = segs[i];
		if (!s) continue;
		const nextBg = segs[i + 1]?.bg;

		// Segment content
		out += bgHex(s.bg) + fgHex(s.fg) + ` ${s.text} `;

		// Separator arrow: fg = this segment's bg, bg = next segment's bg (or reset)
		if (nextBg) {
			out += bgHex(nextBg) + fgHex(s.bg) + ARROW_RIGHT;
		} else {
			out += RESET_BG + fgHex(s.bg) + ARROW_RIGHT + RESET;
		}
	}
	return out;
}

/**
 * Render right-side segments with left-pointing arrows preceding each one.
 * The first arrow comes from the terminal default background.
 */
function renderRight(segs: Seg[]): string {
	if (!segs[0]) return "";
	let out = "";
	for (let i = 0; i < segs.length; i++) {
		const s = segs[i];
		if (!s) continue;
		const prevBg = segs[i - 1]?.bg;

		// Separator arrow: fg = this segment's bg, bg = previous segment's bg (or reset)
		if (prevBg) {
			out += bgHex(prevBg) + fgHex(s.bg) + ARROW_LEFT;
		} else {
			out += RESET_BG + fgHex(s.bg) + ARROW_LEFT;
		}

		// Segment content
		out += bgHex(s.bg) + fgHex(s.fg) + ` ${s.text} `;
	}
	const last = segs.at(-1);
	if (last) out += RESET_BG + fgHex(last.bg) + ARROW_RIGHT + RESET;
	return out;
}

/**
 * Combine left and right segments into a full-width powerline bar.
 * The gap between sides uses the terminal default background.
 */
function renderBar(left: Seg[], right: Seg[], width: number): string {
	const leftStr = renderLeft(left);
	const rightStr = renderRight(right);
	const gap = Math.max(0, width - visibleWidth(leftStr) - visibleWidth(rightStr));
	return leftStr + " ".repeat(gap) + rightStr;
}

// ── Data helpers ─────────────────────────────────────────────────────────────

const MODEL_SHORT: [string, string][] = [
	["sonnet", "sonnet"],
	["opus", "opus"],
	["sol", "sol"],
	["terra", "terra"],
	["deepseek", "ds4f"],
];

/** "spotify/claude-opus-4-6@default" → "sonnet" (or short alias) */
function formatModelName(id: string): string {
	const base = (id.split("/").pop()?.split("@")[0] ?? id).toLowerCase();
	return MODEL_SHORT.find(([needle]) => base.includes(needle))?.[1] ?? base;
}

/**
 * Shorten a branch name for display.
 * - Shows the full name if it fits.
 * - For 3-part branches (user/TICKET/desc), strips down to the tail (desc) and truncates from the back.
 * - For 2-part branches (prefix/desc), strips to desc and truncates from the back.
 */
function formatBranch(branch: string, maxWidth: number): string {
	if (branch.length <= maxWidth) return branch;
	const parts = branch.split("/");
	// Anchor: after 2nd slash for 3+ parts, after 1st slash for 2 parts
	const anchorIdx = parts.length >= 3 ? 2 : parts.length === 2 ? 1 : 0;
	const tail = parts.slice(anchorIdx).join("/");
	// tail is plain ASCII (branch slug), so slice directly to preserve colors when embedded in a segment
	if (tail.length <= maxWidth) return tail;
	if (maxWidth > 2) return tail.slice(0, maxWidth - 2) + "..";
	return tail.slice(0, maxWidth);
}

/** Parse `git diff --numstat` output into totals. */
function parseNumstat(output: string): { added: number; deleted: number } {
	let added = 0;
	let deleted = 0;
	for (const line of output.split("\n")) {
		const [a, d] = line.split("\t", 3);
		const fa = Number(a);
		const fd = Number(d);
		if (Number.isFinite(fa)) added += fa;
		if (Number.isFinite(fd)) deleted += fd;
	}
	return { added, deleted };
}

function formatElapsed(ms: number): string {
	const s = Math.floor(ms / 1_000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h}h`;
	return `${Math.floor(h / 24)}d`;
}

function formatCost(cost: number): string {
	return `$${cost.toFixed(2)}`;
}

function formatTokens(tokens: number): string {
	if (tokens < 1_000) return String(Math.round(tokens));
	if (tokens < 10_000) return `${(tokens / 1_000).toFixed(1)}k`;
	if (tokens < 1_000_000) return `${Math.round(tokens / 1_000)}k`;
	if (tokens < 10_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
	return `${Math.round(tokens / 1_000_000)}M`;
}

type CostEntry = { id?: string; type?: string; message?: { role?: string; usage?: { cost?: { total?: number } } } };

export function activeBranchCost(entries: readonly CostEntry[]): { cost: number; entryIds: Set<string> } {
	let cost = 0;
	const entryIds = new Set<string>();
	for (const entry of entries) {
		const amount = entry.message?.role === "assistant" ? entry.message.usage?.cost?.total : undefined;
		if (typeof amount !== "number" || !Number.isFinite(amount)) continue;
		cost += amount;
		if (typeof entry.id === "string") entryIds.add(entry.id);
	}
	return { cost, entryIds };
}

// ── Extension ────────────────────────────────────────────────────────────────
const MUTATING_TOOLS = new Set(["bash", "edit", "write"]);

export default function powerlineExtension(pi: ExtensionAPI): void {
	let tui: { requestRender: () => void } | null = null;
	let savedCtx: ExtensionContext | null = null;
	let branch: string | null = null;
	let diff: { added: number; deleted: number } | null = null;
	let agentStartedAt: number | null = null;
	let agentFinishedAt: number | null = null;
	let sessionCost = 0;
	let countedEntryIds = new Set<string>();
	let currentModel = "";
	let currentThinkingLevel: ThinkingLevel = "off";
	let refreshId = 0;
	let timeTimer: ReturnType<typeof setInterval> | null = null;
	let gitTimer: ReturnType<typeof setInterval> | null = null;
	let cleanupTransient: (() => void) | null = null;

	async function refreshGitState(ctx: ExtensionContext): Promise<void> {
		const id = ++refreshId;
		const [branchResult, diffResult] = await Promise.all([
			pi.exec("git", ["-C", ctx.cwd, "branch", "--show-current"], { timeout: 5_000 }),
			pi.exec("git", ["-C", ctx.cwd, "diff", "HEAD", "--numstat", "--"], { timeout: 5_000 }),
		]);
		if (id !== refreshId) return;
		branch = branchResult.code === 0 ? branchResult.stdout.trim() || null : null;
		diff = diffResult.code === 0 ? parseNumstat(diffResult.stdout) : null;
		tui?.requestRender();
	}

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;

		savedCtx = ctx;
		currentModel = formatModelName(ctx.model?.id ?? "?");
		currentThinkingLevel = pi.getThinkingLevel();
		({ cost: sessionCost, entryIds: countedEntryIds } = activeBranchCost(
			ctx.sessionManager.getBranch() as CostEntry[],
		));
		branch = null;
		diff = null;
		agentStartedAt = null;
		agentFinishedAt = null;

		// Re-render every second so elapsed/ago times stay sharp.
		timeTimer = setInterval(() => tui?.requestRender(), 1_000);
		// Pick up branch and working-tree changes made outside pi.
		gitTimer = setInterval(() => void refreshGitState(ctx), 60_000);

		ctx.ui.setFooter((_tui, _theme, footerData) => {
			tui = _tui;
			cleanupTransient = setTransientOnChange(() => tui?.requestRender());
			const unsubBranch = footerData.onBranchChange(() => void refreshGitState(ctx));

			return {
				render(width: number): string[] {
					// ── Left side ────────────────────────────────────────────────────
					const left: Seg[] = [];

					// Model
					left.push({ text: currentModel, bg: C.purple, fg: C.dark });

					// Thinking level
					const thinking = THINKING[currentThinkingLevel];
					left.push({ text: thinking.label, bg: thinking.bg, fg: thinking.fg });

					// ── Right side ───────────────────────────────────────────────────
					const right: Seg[] = [];

					// Transient segments registered by other extensions (e.g. spinners)
					for (const seg of getTransientSegments().values()) {
						right.push(seg);
					}

					// Context utilization (live from ctx)
					const ctxUsage = savedCtx?.getContextUsage();
					if (ctxUsage?.tokens != null) {
						const pct = Math.round(ctxUsage.percent ?? 0);
						const ctxFg = pct < 60 ? C.green : pct < 80 ? C.yellow : C.red;
						right.push({
							text: `(${pct}%) ${formatTokens(ctxUsage.tokens)}/${formatTokens(ctxUsage.contextWindow)}`,
							bg: C.panel,
							fg: ctxFg,
						});
					}

					// Turn timing: show elapsed while running, time-since when idle.
					if (agentStartedAt !== null) {
						const elapsed = formatElapsed(Date.now() - agentStartedAt);
						right.push({ text: `⏱ ${elapsed}`, bg: C.panel, fg: C.cyan });
					} else if (agentFinishedAt !== null) {
						const elapsed = formatElapsed(Date.now() - agentFinishedAt);
						right.push({ text: `󰥔 ${elapsed} ago`, bg: C.panel, fg: C.dim });
					}

					// Session cost (always shown)
					right.push({
						text: formatCost(sessionCost),
						bg: C.panelAlt,
						fg: C.dim,
					});

					// Branch + diff — build after right so we can size branch to fit.
					if (branch) {
						const hasDiff = diff && (diff.added > 0 || diff.deleted > 0);
						const gitBg = hasDiff ? C.yellow : C.green;
						const leftBaseWidth = visibleWidth(renderLeft(left));
						const rightWidth = visibleWidth(renderRight(right));
						const branchOverhead = 3; // leading space + trailing space + arrow
						const maxBranchText = Math.max(8, width - leftBaseWidth - rightWidth - 2 - branchOverhead);
						let text = formatBranch(branch, maxBranchText);
						if (hasDiff && diff) {
							text += ` ${fgHex("#003609")}+${diff.added}${fgHex(C.dark)}/${fgHex("#520104")}-${diff.deleted}${fgHex(C.dark)}`;
						}
						left.push({ text, bg: gitBg, fg: C.dark });
					}

					const leftStr = renderLeft(left);
					const rightStr = renderRight(right);

					// If too narrow for a single line, stack: left on line 1, right on line 2.
					if (visibleWidth(leftStr) + visibleWidth(rightStr) + 2 > width) {
						const rightTrunc = visibleWidth(rightStr) > width ? truncateToWidth(rightStr, width, "") : rightStr;
						const rightGap = Math.max(0, width - visibleWidth(rightTrunc));
						return [truncateToWidth(leftStr, width, ""), " ".repeat(rightGap) + rightTrunc];
					}

					return [renderBar(left, right, width)];
				},

				invalidate() {},

				dispose() {
					cleanupTransient?.();
					cleanupTransient = null;
					unsubBranch();
				},
			};
		});

		// Kick off the first git-state read in parallel with session setup.
		void refreshGitState(ctx);
	});

	pi.on("session_tree", (_event, ctx) => {
		({ cost: sessionCost, entryIds: countedEntryIds } = activeBranchCost(
			ctx.sessionManager.getBranch() as CostEntry[],
		));
		tui?.requestRender();
	});

	pi.on("tool_execution_end", async (event, ctx) => {
		if (ctx.mode !== "tui" || !MUTATING_TOOLS.has(event.toolName)) return;
		await refreshGitState(ctx);
	});

	pi.on("agent_settled", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		agentFinishedAt = Date.now();
		agentStartedAt = null;
		tui?.requestRender();
		await refreshGitState(ctx);
	});

	pi.on("model_select", (event, _ctx) => {
		currentModel = formatModelName(event.model.id);
		tui?.requestRender();
	});

	pi.on("thinking_level_select", (event, _ctx) => {
		currentThinkingLevel = event.level;
		tui?.requestRender();
	});

	pi.on("agent_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		agentStartedAt = Date.now();
		agentFinishedAt = null;
		tui?.requestRender();
	});

	pi.on("message_end", (event, ctx) => {
		const msg = event.message;
		if (msg.role !== "assistant") return;

		const entry = [...ctx.sessionManager.getEntries()]
			.reverse()
			.find((candidate: any) => candidate.type === "message" && candidate.message === msg);
		if (entry?.id && countedEntryIds.has(entry.id)) return;
		const cost = msg.usage?.cost?.total;
		if (typeof cost === "number" && Number.isFinite(cost)) {
			sessionCost += cost;
			if (typeof entry?.id === "string") countedEntryIds.add(entry.id);
		}
		tui?.requestRender();
	});

	pi.on("session_shutdown", (_event, ctx) => {
		if (ctx.mode !== "tui") return;

		if (timeTimer) {
			clearInterval(timeTimer);
			timeTimer = null;
		}
		if (gitTimer) {
			clearInterval(gitTimer);
			gitTimer = null;
		}
		cleanupTransient?.();
		cleanupTransient = null;
		savedCtx = null;
		refreshId++;
		tui = null;
		ctx.ui.setFooter(undefined);
	});
}
