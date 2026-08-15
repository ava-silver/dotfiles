/* oxlint-disable typescript/no-base-to-string, typescript/unbound-method */
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const TOOL_PATCH = Symbol.for("ava.pi.outputCompaction.tool.v1");
const CONTAINER_PATCH = Symbol.for("ava.pi.outputCompaction.container.v1");
const ASSISTANT_PATCH = Symbol.for("ava.pi.outputCompaction.assistant.v1");
const ANSI_RE = /\u001b\[[0-9;]*m/g;

interface ThemeLike {
	bold(text: string): string;
	fg(color: string, text: string): string;
	bg(color: string, text: string): string;
}

interface ComponentLike {
	render(width: number): string[];
	invalidate(): void;
}

interface ContainerLike extends ComponentLike {
	children?: unknown[];
	addChild?(component: ComponentLike): void;
}

interface AssistantMessageLike {
	updateContent(message: { content: Array<{ type: string }> }): void;
}

interface ToolRow extends ContainerLike {
	toolName?: string;
	args?: unknown;
	expanded?: boolean;
	isPartial?: boolean;
	result?: { isError?: boolean };
	callRendererComponent?: ComponentLike;
	contentBox?: ContainerLike;
}

type Constructor<T> = {
	new (...args: any[]): T;
	prototype: T;
};

type Runtime = {
	AssistantMessageComponent: Constructor<AssistantMessageLike>;
	ToolExecutionComponent: Constructor<ToolRow>;
	Container: Constructor<ContainerLike>;
	Box: new (paddingX?: number, paddingY?: number, bgFn?: (text: string) => string) => ContainerLike;
	sliceByColumn(text: string, start: number, length: number, strict?: boolean): string;
	truncateToWidth(text: string, width: number, ellipsis?: string, pad?: boolean): string;
	visibleWidth(text: string): number;
	wrapTextWithAnsi(text: string, width: number): string[];
};

type RenderCache = {
	lines: string[];
	members: ToolRow[];
	versions: number[];
	themeSample: string;
	width: number;
};

type ToolPatchState = {
	runtime: Runtime;
	theme?: ThemeLike;
	versions: WeakMap<ToolRow, number>;
	cache: WeakMap<ToolRow, RenderCache>;
	originalRender: (width: number) => string[];
	originalUpdateDisplay: () => void;
	patchedRender?: (width: number) => string[];
	patchedUpdateDisplay?: () => void;
};

type ContainerPatchState = {
	toolPatch: ToolPatchState;
	originalRender: (width: number) => string[];
	patchedRender?: (width: number) => string[];
};

type AssistantPatchState = {
	runtime: Runtime;
	originalUpdateContent: AssistantMessageLike["updateContent"];
	patchedUpdateContent?: AssistantMessageLike["updateContent"];
};

type CallSummary = {
	label: string;
	summary: string;
};

function stripAnsi(text: string): string {
	return text.replace(ANSI_RE, "");
}

function hasVisibleContent(line: string): boolean {
	return stripAnsi(line).trim().length > 0;
}

function compactArgs(args: unknown, runtime: Runtime): string {
	if (args === undefined || args === null) return "";
	try {
		const text = JSON.stringify(args);
		if (!text || text === "{}") return "";
		return runtime.truncateToWidth(text, 240, "…", false);
	} catch {
		return runtime.truncateToWidth(String(args), 240, "…", false);
	}
}

function trimRenderedLine(text: string, runtime: Runtime): string {
	const plain = stripAnsi(text);
	const leading = plain.match(/^\s*/)?.[0] ?? "";
	const trimmed = plain.trim();
	if (!trimmed) return "";
	return runtime.sliceByColumn(text, runtime.visibleWidth(leading), runtime.visibleWidth(trimmed)).trimEnd();
}

function removeExpandHint(text: string, runtime: Runtime): string {
	const plain = stripAnsi(text).trimEnd();
	const match = plain.match(/\s+\([^)]*to expand\)$/i);
	if (match?.index === undefined) return text.trimEnd();
	return runtime.sliceByColumn(text, 0, runtime.visibleWidth(plain.slice(0, match.index))).trimEnd();
}

function renderedCallSummary(row: ToolRow, width: number, runtime: Runtime, theme: ThemeLike): CallSummary {
	let component = row.callRendererComponent;
	if (!component && Array.isArray(row.contentBox?.children)) {
		component = row.contentBox.children[0] as ComponentLike | undefined;
	}

	if (component?.render) {
		const visibleLines = component.render(Math.max(1, width)).filter(hasVisibleContent);
		const first = visibleLines[0] ? trimRenderedLine(visibleLines[0], runtime) : "";
		const plain = stripAnsi(first);
		const heading = /^(\S+)(\s*)/.exec(plain);
		const expected = row.toolName === "bash" ? "$" : row.toolName;
		const knownHeading = heading?.[1] === expected || (row.toolName === "read" && heading?.[1] === "[skill]");

		if (heading && knownHeading) {
			const start = runtime.visibleWidth((heading[1] ?? "") + (heading[2] ?? ""));
			const firstSummary = removeExpandHint(
				runtime.sliceByColumn(first, start, Math.max(0, runtime.visibleWidth(first) - start)),
				runtime,
			);
			const continuations = visibleLines
				.slice(1, 3)
				.map((line) => trimRenderedLine(line, runtime))
				.filter(hasVisibleContent);
			if (visibleLines.length > 3) continuations.push(theme.fg("muted", "…"));
			const summary = [firstSummary, ...continuations].filter(hasVisibleContent).join(theme.fg("muted", " · "));
			return {
				label: heading[1] ?? expected ?? "tool",
				summary: runtime.truncateToWidth(summary, 400, "…", false),
			};
		}
	}

	return {
		label: row.toolName === "bash" ? "$" : (row.toolName ?? "tool"),
		summary: compactArgs(row.args, runtime),
	};
}

function wrappedCallLines(call: CallSummary, width: number, runtime: Runtime, theme: ThemeLike): string[] {
	const label = theme.fg("toolTitle", theme.bold(call.label));
	if (!call.summary) {
		return [runtime.truncateToWidth(label, width, "", false)];
	}

	const prefix = `${label} `;
	const indent = runtime.visibleWidth(prefix);
	if (width <= indent) {
		return [runtime.truncateToWidth(prefix, width, "", false)];
	}

	return runtime
		.wrapTextWithAnsi(call.summary, width - indent)
		.map((line, index) =>
			runtime.truncateToWidth((index === 0 ? prefix : " ".repeat(indent)) + line, width, "", false),
		);
}

function sameMembers(left: ToolRow[], right: ToolRow[]): boolean {
	return left.length === right.length && left.every((member, index) => member === right[index]);
}

function renderCompactBlock(rows: [ToolRow, ...ToolRow[]], width: number, state: ToolPatchState): string[] {
	const theme = state.theme;
	if (!theme) return state.originalRender.call(rows[0], width);

	const themeSample = theme.fg("toolTitle", "x") + theme.fg("muted", "x") + theme.bg("toolSuccessBg", "x");
	const versions = rows.map((row) => state.versions.get(row) ?? 0);
	const cached = state.cache.get(rows[0]);
	if (
		cached &&
		cached.width === width &&
		cached.themeSample === themeSample &&
		sameMembers(cached.members, rows) &&
		cached.versions.every((version, index) => version === versions[index])
	) {
		return cached.lines;
	}

	const content: ComponentLike = {
		render(innerWidth: number): string[] {
			return rows.flatMap((row) =>
				wrappedCallLines(renderedCallSummary(row, innerWidth, state.runtime, theme), innerWidth, state.runtime, theme),
			);
		},
		invalidate() {},
	};
	const box = new state.runtime.Box(1, 1, (text) => theme.bg("toolSuccessBg", text));
	box.addChild?.(content);
	const lines = ["", ...box.render(width)];
	state.cache.set(rows[0], {
		lines,
		members: [...rows],
		versions,
		themeSample,
		width,
	});
	return lines;
}

function isSettledSuccess(row: ToolRow): boolean {
	return row.expanded === false && row.isPartial === false && !!row.result && !row.result.isError;
}

function renderContainer(container: ContainerLike, width: number, state: ContainerPatchState): string[] {
	const children = container.children;
	if (!Array.isArray(children)) {
		return state.originalRender.call(container, width);
	}

	const lines: string[] = [];
	const rendered = new Map<number, string[]>();
	const renderAt = (index: number): string[] => {
		const existing = rendered.get(index);
		if (existing) return existing;
		const child = children[index] as Partial<ComponentLike> | undefined;
		const value = child?.render ? child.render(width) : [];
		rendered.set(index, value);
		return value;
	};

	for (let index = 0; index < children.length; index++) {
		const child = children[index];
		if (!(child instanceof state.toolPatch.runtime.ToolExecutionComponent) || !isSettledSuccess(child)) {
			lines.push(...renderAt(index));
			continue;
		}

		const group: [ToolRow, ...ToolRow[]] = [child];
		let lastMember = index;
		for (let candidateIndex = index + 1; candidateIndex < children.length; candidateIndex++) {
			const candidate = children[candidateIndex];
			if (candidate instanceof state.toolPatch.runtime.ToolExecutionComponent) {
				if (!isSettledSuccess(candidate)) break;
				group.push(candidate);
				lastMember = candidateIndex;
			} else if (renderAt(candidateIndex).some(hasVisibleContent)) {
				break;
			}
		}

		lines.push(...renderCompactBlock(group, width, state.toolPatch));
		index = lastMember;
	}

	return lines;
}

function installAssistantPatch(runtime: Runtime): AssistantPatchState | undefined {
	const proto = runtime.AssistantMessageComponent?.prototype as AssistantMessageLike & {
		[ASSISTANT_PATCH]?: AssistantPatchState;
	};
	if (!proto || typeof proto.updateContent !== "function") return undefined;

	const existing = proto[ASSISTANT_PATCH];
	if (existing) return existing;

	const state: AssistantPatchState = {
		runtime,
		originalUpdateContent: proto.updateContent,
	};
	const patchedUpdateContent = function updateContentWithoutThinking(
		this: AssistantMessageLike,
		message: { content: Array<{ type: string }> },
	): void {
		state.originalUpdateContent.call(this, {
			...message,
			content: message.content.filter((content) => content.type !== "thinking"),
		});
	};

	state.patchedUpdateContent = patchedUpdateContent;
	proto.updateContent = patchedUpdateContent;
	Object.defineProperty(proto, ASSISTANT_PATCH, {
		configurable: true,
		value: state,
	});
	return state;
}

function uninstallAssistantPatch(state: AssistantPatchState | undefined): void {
	if (!state) return;
	const proto = state.runtime.AssistantMessageComponent.prototype as AssistantMessageLike & {
		[ASSISTANT_PATCH]?: AssistantPatchState;
	};
	if (proto[ASSISTANT_PATCH] !== state || proto.updateContent !== state.patchedUpdateContent) {
		return;
	}
	proto.updateContent = state.originalUpdateContent;
	delete proto[ASSISTANT_PATCH];
}

function installToolPatch(runtime: Runtime): ToolPatchState | undefined {
	const proto = runtime.ToolExecutionComponent?.prototype as ToolRow & {
		[TOOL_PATCH]?: ToolPatchState;
		updateDisplay?: () => void;
	};
	if (!proto || typeof proto.render !== "function" || typeof proto.updateDisplay !== "function") {
		return undefined;
	}

	const existing = proto[TOOL_PATCH];
	if (existing) return existing;

	const state: ToolPatchState = {
		runtime,
		versions: new WeakMap(),
		cache: new WeakMap(),
		originalRender: proto.render,
		originalUpdateDisplay: proto.updateDisplay,
	};
	const patchedUpdateDisplay = function updateDisplayWithExpandedErrors(this: ToolRow): void {
		state.versions.set(this, (state.versions.get(this) ?? 0) + 1);
		if (this.result?.isError) this.expanded = true;
		state.originalUpdateDisplay.call(this);
	};
	const patchedRender = function renderCompactSuccess(this: ToolRow, width: number): string[] {
		if (!isSettledSuccess(this)) return state.originalRender.call(this, width);
		try {
			return renderCompactBlock([this], width, state);
		} catch {
			return state.originalRender.call(this, width);
		}
	};

	state.patchedRender = patchedRender;
	state.patchedUpdateDisplay = patchedUpdateDisplay;
	proto.render = patchedRender;
	proto.updateDisplay = patchedUpdateDisplay;
	Object.defineProperty(proto, TOOL_PATCH, {
		configurable: true,
		value: state,
	});
	return state;
}

function installContainerPatch(runtime: Runtime, toolPatch: ToolPatchState): ContainerPatchState | undefined {
	const proto = runtime.Container?.prototype as ContainerLike & {
		[CONTAINER_PATCH]?: ContainerPatchState;
	};
	if (!proto || typeof proto.render !== "function") return undefined;

	const existing = proto[CONTAINER_PATCH];
	if (existing) {
		existing.toolPatch = toolPatch;
		return existing;
	}

	const state: ContainerPatchState = {
		toolPatch,
		originalRender: proto.render,
	};
	const patchedRender = function renderWithGroupedTools(this: ContainerLike, width: number): string[] {
		if (
			!Array.isArray(this.children) ||
			!this.children.some((child) => child instanceof runtime.ToolExecutionComponent)
		) {
			return state.originalRender.call(this, width);
		}
		try {
			return renderContainer(this, width, state);
		} catch {
			return state.originalRender.call(this, width);
		}
	};

	state.patchedRender = patchedRender;
	proto.render = patchedRender;
	Object.defineProperty(proto, CONTAINER_PATCH, {
		configurable: true,
		value: state,
	});
	return state;
}

function uninstallContainerPatch(state: ContainerPatchState | undefined): void {
	if (!state) return;
	const proto = state.toolPatch.runtime.Container.prototype as ContainerLike & {
		[CONTAINER_PATCH]?: ContainerPatchState;
	};
	if (proto[CONTAINER_PATCH] !== state || proto.render !== state.patchedRender) return;
	proto.render = state.originalRender;
	delete proto[CONTAINER_PATCH];
}

function uninstallToolPatch(state: ToolPatchState | undefined): void {
	if (!state) return;
	const proto = state.runtime.ToolExecutionComponent.prototype as ToolRow & {
		[TOOL_PATCH]?: ToolPatchState;
		updateDisplay?: () => void;
	};
	if (
		proto[TOOL_PATCH] !== state ||
		proto.render !== state.patchedRender ||
		proto.updateDisplay !== state.patchedUpdateDisplay
	) {
		return;
	}
	proto.render = state.originalRender;
	proto.updateDisplay = state.originalUpdateDisplay;
	delete proto[TOOL_PATCH];
}

function findAgentEntry(entry: string): string | undefined {
	let directory = dirname(entry);
	while (true) {
		try {
			const packageJson = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as {
				name?: string;
				main?: string;
			};
			if (packageJson.name === "@earendil-works/pi-coding-agent") {
				return resolve(directory, packageJson.main ?? "dist/index.js");
			}
		} catch {
			// Continue toward the filesystem root.
		}
		const parent = dirname(directory);
		if (parent === directory) return undefined;
		directory = parent;
	}
}

async function loadRuntime(): Promise<Runtime> {
	let cliEntry: string | undefined;
	if (process.argv[1]) {
		try {
			cliEntry = realpathSync(process.argv[1]);
		} catch {
			cliEntry = process.argv[1];
		}
	}

	let agentEntry = cliEntry ? findAgentEntry(cliEntry) : undefined;
	for (const candidate of [cliEntry, import.meta.url]) {
		if (agentEntry || !candidate) break;
		try {
			agentEntry = createRequire(candidate).resolve("@earendil-works/pi-coding-agent");
		} catch {
			// Try the next resolution root.
		}
	}
	if (!agentEntry) throw new Error("Unable to resolve Pi's runtime package");

	const agent = await import(pathToFileURL(agentEntry).href);
	const tuiEntry = createRequire(agentEntry).resolve("@earendil-works/pi-tui");
	const tui = await import(pathToFileURL(tuiEntry).href);
	if (!agent.AssistantMessageComponent || !agent.ToolExecutionComponent || !tui.Container || !tui.Box) {
		throw new Error("Pi's output rendering API is unavailable");
	}

	return {
		AssistantMessageComponent: agent.AssistantMessageComponent,
		ToolExecutionComponent: agent.ToolExecutionComponent,
		Container: tui.Container,
		Box: tui.Box,
		sliceByColumn: tui.sliceByColumn,
		truncateToWidth: tui.truncateToWidth,
		visibleWidth: tui.visibleWidth,
		wrapTextWithAnsi: tui.wrapTextWithAnsi,
	} as Runtime;
}

export default async function (pi: ExtensionAPI) {
	let runtime: Runtime;
	try {
		runtime = await loadRuntime();
	} catch {
		return;
	}

	const assistantPatch = installAssistantPatch(runtime);
	const toolPatch = installToolPatch(runtime);
	const containerPatch = toolPatch ? installContainerPatch(runtime, toolPatch) : undefined;

	pi.on("session_start", (_event, ctx) => {
		if (toolPatch) {
			toolPatch.theme = ctx.ui.theme;
			toolPatch.cache = new WeakMap();
		}
		ctx.ui.setToolsExpanded(false);
	});

	pi.on("session_shutdown", () => {
		uninstallContainerPatch(containerPatch);
		uninstallToolPatch(toolPatch);
		uninstallAssistantPatch(assistantPatch);
	});
}
