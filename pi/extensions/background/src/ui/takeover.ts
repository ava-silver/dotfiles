/**
 * Takeover UI for subagents (ported from v1, rendering from the synchronous
 * SubagentReadModel instead of live pi sessions):
 * - SubagentDashboard: full popup (overlay) listing all subagents.
 * - TakeoverView: full interactive view of one subagent with an input line
 *   to steer/continue it.
 */

import type { ExtensionContext, KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, Focusable, TUI } from "@earendil-works/pi-tui";
import { Input, truncateToWidth } from "@earendil-works/pi-tui";
import { formatElapsed, type SubagentSnapshot } from "../domain.ts";
import { formatContextUtilization } from "../format.ts";
import type { SubagentReadModel } from "../manager.ts";
import { buildTranscriptLines } from "./transcript.ts";

function configuredKeys(keybindings: KeybindingsManager, binding: Parameters<KeybindingsManager["getKeys"]>[0]) {
	return keybindings.getKeys(binding).join("/") || "unbound";
}

function statusGlyph(snap: SubagentSnapshot, theme: Theme): string {
	switch (snap.status) {
		case "running":
			return theme.fg("warning", "■");
		case "done":
			return theme.fg("success", "■");
		case "error":
			return theme.fg("error", "■");
	}
}

// --- Entry point ---------------------------------------------------------------

/** Open the subagent-specific TakeoverView for the given subagent id. */
export async function openTakeoverView(id: string, ctx: ExtensionContext, view: SubagentReadModel): Promise<void> {
	await ctx.ui.custom<null>(
		(tui, theme, keybindings, done) => new TakeoverView(tui, theme, keybindings, id, view, done),
		{ overlay: true, overlayOptions: { anchor: "center", width: "100%", maxHeight: "100%" } },
	);
}

// --- Takeover view ------------------------------------------------------------

const TRANSCRIPT_SCROLL_STEP = 6;

class TakeoverView implements Component, Focusable {
	private tui: TUI;
	private theme: Theme;
	private keybindings: KeybindingsManager;
	private id: string;
	private view: SubagentReadModel;
	private done: (value: null) => void;

	private input = new Input();
	/** Scroll offset in lines from the bottom of the transcript. 0 = pinned to bottom. */
	private scrollOffset = 0;
	private unsubscribe: () => void;
	private renderTimer?: ReturnType<typeof setTimeout>;
	private ticker: ReturnType<typeof setInterval>;
	private closed = false;

	private _focused = false;
	get focused(): boolean {
		return this._focused;
	}
	set focused(value: boolean) {
		this._focused = value;
		this.input.focused = value;
	}

	constructor(
		tui: TUI,
		theme: Theme,
		keybindings: KeybindingsManager,
		id: string,
		view: SubagentReadModel,
		done: (value: null) => void,
	) {
		this.tui = tui;
		this.theme = theme;
		this.keybindings = keybindings;
		this.id = id;
		this.view = view;
		this.done = done;
		this.unsubscribe = view.subscribeTo(id, () => this.scheduleRender());
		// Elapsed time in the header ticks along at 1Hz.
		this.ticker = setInterval(() => this.tui.requestRender(), 1000);
		this.input.onSubmit = (value: string) => {
			const text = value.trim();
			if (!text) return;
			this.input.setValue("");
			this.view.requestSend(this.id, text);
			this.scrollOffset = 0;
			this.tui.requestRender();
		};
	}

	private snap(): SubagentSnapshot | undefined {
		return this.view.get(this.id);
	}

	private scheduleRender() {
		if (this.renderTimer) return;
		// Streaming can emit an event per token. Limit terminal repaints so this
		// view cannot starve input handling or make the child look frozen.
		this.renderTimer = setTimeout(() => {
			this.renderTimer = undefined;
			if (!this.closed) this.tui.requestRender();
		}, 50);
	}

	private cleanup() {
		if (this.closed) return false;
		this.closed = true;
		this.unsubscribe();
		clearInterval(this.ticker);
		if (this.renderTimer) clearTimeout(this.renderTimer);
		this.renderTimer = undefined;
		return true;
	}

	private close() {
		if (this.cleanup()) this.done(null);
	}

	dispose(): void {
		this.cleanup();
	}

	handleInput(data: string): void {
		if (this.keybindings.matches(data, "app.clear")) {
			const snap = this.snap();
			if (snap?.status === "running") this.view.requestAbort(this.id);
			return;
		}
		if (this.keybindings.matches(data, "app.interrupt") || this.keybindings.matches(data, "tui.select.cancel")) {
			this.close();
			return;
		}
		if (this.keybindings.matches(data, "tui.editor.cursorUp")) {
			this.scrollOffset += TRANSCRIPT_SCROLL_STEP;
			this.tui.requestRender();
			return;
		}
		if (this.keybindings.matches(data, "tui.editor.cursorDown")) {
			this.scrollOffset = Math.max(0, this.scrollOffset - TRANSCRIPT_SCROLL_STEP);
			this.tui.requestRender();
			return;
		}
		if (this.keybindings.matches(data, "tui.editor.pageUp")) {
			this.scrollOffset += this.viewportHeight();
			this.tui.requestRender();
			return;
		}
		if (this.keybindings.matches(data, "tui.editor.pageDown")) {
			this.scrollOffset = Math.max(0, this.scrollOffset - this.viewportHeight());
			this.tui.requestRender();
			return;
		}
		this.input.handleInput(data);
		this.tui.requestRender();
	}

	private viewportHeight(): number {
		const rows = this.tui.terminal.rows || 30;
		// The complete view renders viewport + 7 chrome rows. Using rows - 8
		// makes the overlay exactly terminal rows - 1.
		return Math.max(6, rows - 8);
	}

	render(width: number): string[] {
		const theme = this.theme;
		const border = theme.fg("borderAccent", "─".repeat(Math.max(1, width)));
		const lines: string[] = [];
		const snap = this.snap();

		if (!snap) {
			lines.push(border);
			lines.push(theme.fg("dim", `${this.id} is no longer tracked`));
			lines.push(border);
			return lines;
		}

		lines.push(border);
		const utilization = formatContextUtilization(snap.usage);
		const header =
			`${statusGlyph(snap, theme)} ` +
			theme.fg("accent", theme.bold(`${snap.id} · ${snap.title}`)) +
			theme.fg("muted", ` · ${snap.status} · ${formatElapsed(snap)}`) +
			theme.fg("dim", ` · ${snap.meta.modelLabel ?? "?"}`) +
			(utilization ? theme.fg("dim", ` · ${utilization}`) : "");
		lines.push(truncateToWidth(header, width));
		lines.push(border);

		// Fixed-height transcript viewport. Error and scroll status consume rows
		// inside the viewport so streaming/scrolling never changes overlay height.
		const transcript = buildTranscriptLines(snap, width, theme);
		const viewport = this.viewportHeight();
		const errorRows = snap.errorText ? 1 : 0;
		const scrollRows = this.scrollOffset > 0 ? 1 : 0;
		const transcriptCapacity = Math.max(1, viewport - errorRows - scrollRows);
		const maxOffset = Math.max(0, transcript.length - transcriptCapacity);
		if (this.scrollOffset > maxOffset) this.scrollOffset = maxOffset;

		const body: string[] = [];
		if (snap.errorText) {
			body.push(truncateToWidth(theme.fg("error", `error: ${snap.errorText}`), width));
		}

		const capacity = Math.max(1, viewport - body.length - (this.scrollOffset > 0 ? 1 : 0));
		const end = transcript.length - this.scrollOffset;
		const visible = transcript.slice(Math.max(0, end - capacity), end);
		if (visible.length === 0) body.push(theme.fg("dim", "(no output yet)"));
		else body.push(...visible);

		if (this.scrollOffset > 0) {
			body.push(truncateToWidth(theme.fg("dim", `... ${this.scrollOffset} lines below · ↓/pgdn`), width));
		}
		while (body.length < viewport) body.push("");
		lines.push(...body.slice(0, viewport));

		lines.push(border);
		lines.push(...this.input.render(width));
		lines.push(
			truncateToWidth(
				theme.fg(
					"dim",
					`${configuredKeys(this.keybindings, "tui.input.submit")} send · ${configuredKeys(this.keybindings, "app.interrupt")} back · ${configuredKeys(this.keybindings, "app.clear")} abort run · ${configuredKeys(this.keybindings, "tui.editor.cursorUp")}/${configuredKeys(this.keybindings, "tui.editor.cursorDown")} scroll · ${configuredKeys(this.keybindings, "tui.editor.pageUp")}/${configuredKeys(this.keybindings, "tui.editor.pageDown")} page`,
				),
				width,
			),
		);
		lines.push(border);
		return lines;
	}

	invalidate(): void {
		this.input.invalidate();
	}
}
