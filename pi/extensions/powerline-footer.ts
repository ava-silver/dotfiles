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
 *   [◄ registered transient segments...][◄ N% ◄][◄ 󰥔 Xm ago ◄][◄ $0.00]
 *
 * Other extensions can inject temporary segments (e.g. spinners) via:
 *   import { registerTransientSegment } from "./shared/footer-segments.ts";
 *   registerTransientSegment("my-ext", { text: "⟳ fetching", bg: "#81c8be", fg: "#232634" });
 *   registerTransientSegment("my-ext", null); // clear
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  getTransientSegments,
  setTransientOnChange,
} from "./shared/footer-segments.ts";

// ── Powerline characters ────────────────────────────────────────────────────
const ARROW_RIGHT = "\uE0B0"; // ► solid right-pointing arrow
const ARROW_LEFT = "\uE0B2";  // ◄ solid left-pointing arrow

// ── Catppuccin Frappé palette (hardcoded for powerline separator rendering) ─
// These are used for segment backgrounds; fg choices are derived from them.
const C = {
  // Backgrounds
  bg:       "#303446", // page background (used as implicit "empty" color)
  panel:    "#292c3c",
  panelAlt: "#232634",
  selected: "#414559",
  // Accent backgrounds
  purple:   "#ca9ee6",
  cyan:     "#81c8be",
  green:    "#a6d189",
  red:      "#e78284",
  yellow:   "#e5c890",
  // Foregrounds
  text:     "#c6d0f5",
  muted:    "#a5adce",
  dim:      "#838ba7",
  dark:     "#1e2030", // dark text for use on bright bg segments
} as const;

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
  if (!segs.length) return "";
  let out = "";
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
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
  if (!segs.length) return "";
  let out = "";
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
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
  out += RESET;
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

/** "spotify/claude-opus-4-6@default" → "claude-opus-4-6" */
function formatModelName(id: string): string {
  return id.split("/").pop()?.split("@")[0] ?? id;
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
  return `$${cost.toFixed(cost < 0.01 ? 4 : 2)}`;
}

// ── Extension ────────────────────────────────────────────────────────────────
const MUTATING_TOOLS = new Set(["bash", "edit", "write"]);

export default function powerlineFooterExtension(pi: ExtensionAPI): void {
  let tui: { requestRender: () => void } | null = null;
  let diff: { added: number; deleted: number } | null = null;
  let contextPct: number | null = null;
  let lastResponseAt: number | null = null;
  let sessionCost = 0;
  let currentModel = "";
  let refreshId = 0;
  let timeTimer: ReturnType<typeof setInterval> | null = null;
  let cleanupTransient: (() => void) | null = null;

  async function refreshDiff(ctx: ExtensionContext): Promise<void> {
    const id = ++refreshId;
    const result = await pi.exec(
      "git",
      ["-C", ctx.cwd, "diff", "HEAD", "--numstat", "--"],
      { timeout: 5_000 },
    );
    if (id !== refreshId) return;
    diff = result.code === 0 ? parseNumstat(result.stdout) : null;
    tui?.requestRender();
  }

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    currentModel = formatModelName(ctx.model?.id ?? "?");
    sessionCost = 0;
    diff = null;
    contextPct = null;
    lastResponseAt = null;

    // Re-render every 30s so the "X ago" time stays fresh.
    timeTimer = setInterval(() => tui?.requestRender(), 30_000);

    ctx.ui.setFooter((_tui, _theme, footerData) => {
      tui = _tui;
      cleanupTransient = setTransientOnChange(() => tui?.requestRender());
      const unsubBranch = footerData.onBranchChange(() => tui?.requestRender());

      return {
        render(width: number): string[] {
          // ── Left side ────────────────────────────────────────────────────
          const left: Seg[] = [];

          // Model
          left.push({ text: currentModel, bg: C.purple, fg: C.dark });

          // Git branch
          const branch = footerData.getGitBranch();
          if (branch) {
            left.push({ text: ` ${branch}`, bg: C.selected, fg: C.text });
          }

          // Git diff (hidden when clean)
          if (diff && (diff.added > 0 || diff.deleted > 0)) {
            const onlyAdded = diff.deleted === 0;
            const onlyDeleted = diff.added === 0;
            const diffBg = onlyAdded ? C.green : onlyDeleted ? C.red : C.yellow;
            const parts: string[] = [];
            if (diff.added > 0) parts.push(`+${diff.added}`);
            if (diff.deleted > 0) parts.push(`-${diff.deleted}`);
            left.push({ text: parts.join(" "), bg: diffBg, fg: C.dark });
          }

          // ── Right side ───────────────────────────────────────────────────
          const right: Seg[] = [];

          // Transient segments registered by other extensions (e.g. spinners)
          for (const seg of getTransientSegments().values()) {
            right.push(seg);
          }

          // Context utilization
          if (contextPct !== null) {
            const ctxFg =
              contextPct < 60 ? C.green : contextPct < 80 ? C.yellow : C.red;
            right.push({ text: `${contextPct}%`, bg: C.panel, fg: ctxFg });
          }

          // Last response time (clock icon from Nerd Fonts)
          if (lastResponseAt !== null) {
            const elapsed = formatElapsed(Date.now() - lastResponseAt);
            right.push({ text: `\u{F0554} ${elapsed} ago`, bg: C.panel, fg: C.dim });
          }

          // Session cost (always shown)
          right.push({
            text: formatCost(sessionCost),
            bg: C.panelAlt,
            fg: C.dim,
          });

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

    // Kick off first diff in parallel with session setup.
    void refreshDiff(ctx);
  });

  pi.on("tool_execution_end", async (event, ctx) => {
    if (ctx.mode !== "tui" || !MUTATING_TOOLS.has(event.toolName)) return;
    await refreshDiff(ctx);
  });

  pi.on("agent_settled", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    await refreshDiff(ctx);
  });

  pi.on("message_end", (event, _ctx) => {
    const msg = event.message;
    if (msg.role !== "assistant") return;

    lastResponseAt = Date.now();
    if (msg.model) currentModel = formatModelName(msg.model);

    // Context utilization: input tokens vs. model context window.
    const usage = msg.usage;
    if (usage) {
      const inputTokens = (usage.input ?? 0) + (usage.cacheRead ?? 0);
      // Claude models all have 200k context windows.
      const contextWindow =
        typeof msg.model === "string" && msg.model.includes("claude")
          ? 200_000
          : null;
      if (contextWindow) {
        contextPct = Math.min(100, Math.round((inputTokens / contextWindow) * 100));
      }
      const cost = usage.cost?.total;
      if (typeof cost === "number" && Number.isFinite(cost)) sessionCost += cost;
    }

    tui?.requestRender();
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    if (timeTimer) {
      clearInterval(timeTimer);
      timeTimer = null;
    }
    cleanupTransient?.();
    cleanupTransient = null;
    refreshId++;
    tui = null;
    ctx.ui.setFooter(undefined);
  });
}
