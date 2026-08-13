/**
 * Background task hub: a session-scoped registry that aggregates background
 * providers (subagents, terminals, …) and exposes a unified picker UI.
 *
 * Each background extension instance owns one hub and passes it to its
 * providers. This keeps task state session-scoped without process globals.
 */

import type { ExtensionContext, KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

// --- Public interface -------------------------------------------------------

export interface BackgroundItem {
	id: string;
	title: string;
	status: "running" | "done" | "error";
	/** Called on every render tick so elapsed time stays live. */
	elapsed(): string;
	/** Extra strings shown on the right side of the row (model, ctx%, …). */
	meta(): string[];
}

export interface BackgroundProvider {
	/** Section header label shown in the picker. */
	label: string;
	list(): BackgroundItem[];
	/** Subscribe to any change. Returns an unsubscribe function. */
	subscribe(onChange: () => void): () => void;
	/** Open the provider-specific detail view for an item. */
	openDetail(id: string, ctx: ExtensionContext): Promise<void>;
	/** Optional: kill a running item (triggered by 'x' in the picker). */
	abort?(id: string): void;
}

// --- Hub --------------------------------------------------------------------

export class BackgroundHub {
	private readonly providers = new Map<string, BackgroundProvider>();

	/** Register a session-scoped provider and return its unregister function. */
	registerProvider(key: string, provider: BackgroundProvider): () => void {
		this.providers.set(key, provider);
		return () => {
			if (this.providers.get(key) === provider) this.providers.delete(key);
		};
	}

	hasAnyItems(): boolean {
		for (const provider of this.providers.values()) {
			if (provider.list().length > 0) return true;
		}
		return false;
	}

	/** Open the picker and return to it whenever a provider detail view closes. */
	async openPicker(ctx: ExtensionContext): Promise<void> {
		if (!this.hasAnyItems()) {
			ctx.ui.notify("No background tasks.", "info");
			return;
		}

		let selIdx = 0;
		const onSelChange = (idx: number) => {
			selIdx = idx;
		};

		while (true) {
			if (!this.hasAnyItems()) return;

			const picked = await ctx.ui.custom<{ providerId: string; itemId: string } | null>(
				(tui, theme, keybindings, done) =>
					new BackgroundDashboard(this.providers, tui, theme, keybindings, done, selIdx, onSelChange),
				{
					overlay: true,
					overlayOptions: { anchor: "center", width: "100%", maxHeight: "100%" },
				},
			);

			if (!picked) return;

			const provider = this.providers.get(picked.providerId);
			if (!provider) continue;
			if (!provider.list().find((item) => item.id === picked.itemId)) continue;

			await provider.openDetail(picked.itemId, ctx);
		}
	}
}

// --- Internal types ---------------------------------------------------------

type FlatRow =
	| { kind: "header"; label: string; total: number; running: number }
	| {
			kind: "item";
			providerId: string;
			provider: BackgroundProvider;
			item: BackgroundItem;
			selIdx: number;
	  };

function buildRows(providers: ReadonlyMap<string, BackgroundProvider>): FlatRow[] {
	const rows: FlatRow[] = [];
	let selIdx = 0;
	for (const [providerId, provider] of providers) {
		const items = provider.list();
		if (items.length === 0) continue;
		const running = items.filter((i) => i.status === "running").length;
		rows.push({ kind: "header", label: provider.label, total: items.length, running });
		for (const item of items) {
			rows.push({ kind: "item", providerId, provider, item, selIdx: selIdx++ });
		}
	}
	return rows;
}

function totalItems(providers: ReadonlyMap<string, BackgroundProvider>): number {
	let total = 0;
	for (const provider of providers.values()) total += provider.list().length;
	return total;
}

function kbKeys(kb: KeybindingsManager, binding: Parameters<KeybindingsManager["getKeys"]>[0]): string {
	return kb.getKeys(binding).join("/") || "unbound";
}

function statusGlyph(item: BackgroundItem, theme: Theme): string {
	switch (item.status) {
		case "running":
			return theme.fg("warning", "■");
		case "done":
			return theme.fg("success", "■");
		case "error":
			return theme.fg("error", "■");
	}
}

function statusWord(item: BackgroundItem, theme: Theme): string {
	switch (item.status) {
		case "running":
			return theme.fg("warning", "running");
		case "done":
			return theme.fg("success", "done");
		case "error":
			return theme.fg("error", "failed");
	}
}

// --- BackgroundDashboard component ------------------------------------------

class BackgroundDashboard implements Component {
	private providers: ReadonlyMap<string, BackgroundProvider>;
	private tui: TUI;
	private theme: Theme;
	private keybindings: KeybindingsManager;
	private done: (value: { providerId: string; itemId: string } | null) => void;
	private onSelChange: (idx: number) => void;

	private selIdx: number;
	private closed = false;
	private ticker: ReturnType<typeof setInterval>;
	private unsubs: Array<() => void> = [];

	constructor(
		providers: ReadonlyMap<string, BackgroundProvider>,
		tui: TUI,
		theme: Theme,
		keybindings: KeybindingsManager,
		done: (value: { providerId: string; itemId: string } | null) => void,
		initialSelIdx: number,
		onSelChange: (idx: number) => void,
	) {
		this.providers = providers;
		this.tui = tui;
		this.theme = theme;
		this.keybindings = keybindings;
		this.done = done;
		this.selIdx = initialSelIdx;
		this.onSelChange = onSelChange;
		// Elapsed times and statuses tick along at 1 Hz.
		this.ticker = setInterval(() => this.tui.requestRender(), 1000);
		// Re-render whenever any provider reports a change.
		for (const provider of this.providers.values()) {
			this.unsubs.push(provider.subscribe(() => this.tui.requestRender()));
		}
	}

	private cleanup() {
		if (this.closed) return false;
		this.closed = true;
		clearInterval(this.ticker);
		for (const unsub of this.unsubs) unsub();
		return true;
	}

	private close(result: { providerId: string; itemId: string } | null) {
		if (this.cleanup()) this.done(result);
	}

	dispose(): void {
		this.cleanup();
	}

	private clampSel(total: number) {
		if (total === 0) {
			this.selIdx = 0;
			return;
		}
		this.selIdx = Math.max(0, Math.min(this.selIdx, total - 1));
	}

	handleInput(data: string): void {
		const total = totalItems(this.providers);
		this.clampSel(total);

		if (this.keybindings.matches(data, "tui.select.cancel")) {
			this.close(null);
			return;
		}
		if (this.keybindings.matches(data, "tui.select.confirm")) {
			if (total === 0) {
				this.close(null);
				return;
			}
			const rows = buildRows(this.providers);
			const row = rows.find(
				(r): r is Extract<FlatRow, { kind: "item" }> => r.kind === "item" && r.selIdx === this.selIdx,
			);
			if (row) this.close({ providerId: row.providerId, itemId: row.item.id });
			return;
		}
		if (this.keybindings.matches(data, "tui.select.up") || data === "k") {
			if (total > 0) {
				this.selIdx = (this.selIdx - 1 + total) % total;
				this.onSelChange(this.selIdx);
				this.tui.requestRender();
			}
			return;
		}
		if (this.keybindings.matches(data, "tui.select.down") || data === "j") {
			if (total > 0) {
				this.selIdx = (this.selIdx + 1) % total;
				this.onSelChange(this.selIdx);
				this.tui.requestRender();
			}
			return;
		}
		if (data === "x") {
			const rows = buildRows(this.providers);
			const row = rows.find(
				(r): r is Extract<FlatRow, { kind: "item" }> => r.kind === "item" && r.selIdx === this.selIdx,
			);
			if (row?.item.status === "running") row.provider.abort?.(row.item.id);
			return;
		}
	}

	private pad(text: string, width: number): string {
		const t = truncateToWidth(text, width);
		return t + " ".repeat(Math.max(0, width - visibleWidth(t)));
	}

	render(width: number): string[] {
		const theme = this.theme;
		const rows = buildRows(this.providers);
		const total = rows.filter((r) => r.kind === "item").length;
		this.clampSel(total);

		const termRows = this.tui.terminal.rows || 30;
		const bodyHeight = Math.max(6, termRows - 5);
		const innerWidth = width - 2;

		const lines: string[] = [];

		// Title bar
		const headerLeft = theme.fg("accent", theme.bold("Background Tasks"));
		const headerRight = theme.fg("muted", `${total} task${total === 1 ? "" : "s"}`);
		const headerPad = Math.max(1, width - visibleWidth(headerLeft) - visibleWidth(headerRight) - 4);
		lines.push(truncateToWidth(`  ${headerLeft}${" ".repeat(headerPad)}${headerRight}  `, width));

		// Top border
		const settled = rows.filter((r) => r.kind === "item" && r.item.status !== "running").length;
		const bLabel = ` tasks · ${settled}/${total} settled `;
		const bLabelW = visibleWidth(bLabel);
		const borderInner =
			theme.fg("border", "─") +
			theme.fg("text", bLabel) +
			theme.fg("border", "─".repeat(Math.max(0, innerWidth - 1 - bLabelW)));
		lines.push(theme.fg("border", "╭") + borderInner + theme.fg("border", "╮"));

		const divider = theme.fg("border", "│");

		// Body: render all rows, then scroll to keep selection visible
		const allBodyRows = this.renderRows(rows, innerWidth);
		let scrollStart = 0;
		if (allBodyRows.length > bodyHeight) {
			// Find the render-row index for the selected item (headers consume rows too)
			let renderSelIdx = 0;
			for (const r of rows) {
				if (r.kind === "header") {
					renderSelIdx++;
					continue;
				}
				if (r.selIdx === this.selIdx) break;
				renderSelIdx++;
			}
			scrollStart = Math.min(
				Math.max(0, renderSelIdx - Math.floor(bodyHeight / 2)),
				Math.max(0, allBodyRows.length - bodyHeight),
			);
		}
		for (let i = 0; i < bodyHeight; i++) {
			const content = allBodyRows[scrollStart + i] ?? "";
			lines.push(divider + this.pad(content, innerWidth) + divider);
		}

		// Bottom border + hints
		lines.push(theme.fg("border", "╰") + theme.fg("border", "─".repeat(innerWidth)) + theme.fg("border", "╯"));
		lines.push(
			truncateToWidth(
				theme.fg(
					"dim",
					`  ${kbKeys(this.keybindings, "tui.select.up")}/${kbKeys(this.keybindings, "tui.select.down")}/jk select · ${kbKeys(this.keybindings, "tui.select.confirm")} open · x abort · ${kbKeys(this.keybindings, "tui.select.cancel")} close`,
				),
				width,
			),
		);

		return lines;
	}

	private renderRows(rows: FlatRow[], width: number): string[] {
		const theme = this.theme;
		const out: string[] = [];

		for (const row of rows) {
			if (row.kind === "header") {
				const label = ` ${row.label} (${row.total}) `;
				const labelW = visibleWidth(label);
				out.push(
					truncateToWidth(
						theme.fg("border", "──") +
							theme.fg("muted", label) +
							theme.fg("border", "─".repeat(Math.max(0, width - 2 - labelW))),
						width,
					),
				);
				continue;
			}

			const { item, selIdx } = row;
			const isSelected = selIdx === this.selIdx;

			const marker = isSelected ? theme.fg("accent", "❯") : " ";
			const titleStr = isSelected ? theme.fg("accent", item.title) : theme.fg("text", item.title);
			const left = ` ${marker} ${statusGlyph(item, theme)} ${titleStr} ${theme.fg("dim", item.id)}`;

			const dot = theme.fg("dim", " · ");
			const right =
				[
					...item.meta().map((s) => theme.fg("muted", s)),
					statusWord(item, theme),
					theme.fg("muted", item.elapsed()),
				].join(dot) + " ";

			const rightW = visibleWidth(right);
			const leftMax = Math.max(0, width - rightW - 2);
			const leftT = truncateToWidth(left, leftMax);
			const gap = Math.max(2, width - visibleWidth(leftT) - rightW);
			out.push(truncateToWidth(leftT + " ".repeat(gap) + right, width));
		}

		return out;
	}

	invalidate(): void {}
}
