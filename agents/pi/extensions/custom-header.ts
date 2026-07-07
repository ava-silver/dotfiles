/**
 * Custom Header Extension
 *
 * Replaces pi's built-in header (logo + keybinding hints) with a custom
 * banner: the orange Claude mascot, big "Hi Ava" ASCII art, and a little
 * cat with a "meow :3" speech bubble.
 */

import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { VERSION } from "@earendil-works/pi-coding-agent";

// Big "Hi Ava"
const HI_AVA = [
  "▌  ▗           ▐",
  "▛▀▖▄  ▝▀▖▌ ▌▝▀▖▐",
  "▌ ▌▐  ▞▀▌▐▐ ▞▀▌▝",
  "▘ ▘▀▘ ▝▀▘ ▘ ▝▀▘▝",
];

// A little sitting cat.
const CAT = ["  ／l、    ", "（ﾟ､ ｡７   ", "  l  ~ヽ   ", "  じしf_,)ノ"];

// Speech bubble sits to the cat's left; the tail connects at the mouth row.
const BUBBLE = ["╭─────────╮", "│ meow :3 │", "╰─────────╯"];
const BUBBLE_W = 11;

// The lil claude mascot.
const CLAUDE = ["         ", " ▐▛███▜▌ ", "▝▜█████▛▘", "  ▘▘ ▝▝  "];

function buildHeader(theme: Theme): string[] {
  const muted = (t: string) => theme.fg("muted", t);
  const dim = (t: string) => theme.fg("dim", t);
  // Raw truecolor ANSI (Theme has no rgb helper): orange Claude, purple banner.
  const orange = (t: string) => `\x1b[38;2;215;119;87m${t}\x1b[39m`;
  const purple = (t: string) => `\x1b[38;2;202;158;230m${t}\x1b[39m`;

  const lines: string[] = [""];

  // Claude mascot to the left of the "Hi Ava" banner, vertically centered.
  const rows = Math.max(CLAUDE.length, HI_AVA.length);
  const claudePad = Math.floor((rows - CLAUDE.length) / 2);
  const avaPad = Math.floor((rows - HI_AVA.length) / 2);
  const claudeWidth = Math.max(...CLAUDE.map((l) => l.length));
  for (let i = 0; i < rows; i++) {
    const c = i - claudePad;
    const a = i - avaPad;
    const left =
      c >= 0 && c < CLAUDE.length ? orange(CLAUDE[c]) : " ".repeat(claudeWidth);
    const right = a >= 0 && a < HI_AVA.length ? purple(HI_AVA[a]) : "";
    lines.push("  " + left + "   " + right);
  }
  lines.push("");

  // Speech bubble on the left, cat on the right, tail joining at the mouth.
  for (let i = 0; i < CAT.length; i++) {
    const left = i < BUBBLE.length ? BUBBLE[i] : " ".repeat(BUBBLE_W);
    const tail = i === 1 ? "──" : "  ";
    lines.push("    " + muted(left + tail + CAT[i]));
  }

  lines.push("");
  lines.push(`  ${muted("pi")}${dim(` v${VERSION}`)}`);
  lines.push("");
  return lines;
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    ctx.ui.setHeader((_tui, theme) => ({
      render: (_width: number): string[] => buildHeader(theme),
      invalidate() {},
    }));
  });
}
