/**
 * Custom Header Extension
 *
 * Renders the pi-startup-header gradient logo centered, with the meowing
 * cat anchored to the right side during the logo block.
 *
 * Gradient logo vendored from https://github.com/EnderLiquid/pi-startup-header (MIT)
 */

import { getAgentDir, VERSION, type ExtensionAPI, type Theme, type ThemeColor } from "@earendil-works/pi-coding-agent";
import { visibleWidth, truncateToWidth } from "@earendil-works/pi-tui";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// ─── Vendored: header-color ───────────────────────────────────────────────────

type Rgb = [number, number, number];

type HeaderColorSource = { kind: "theme"; token: ThemeColor } | { kind: "rgb"; value: Rgb };

const ANSI_RESET = "\x1b[0m";
const HEX_RGB_PATTERN = /^#[0-9a-fA-F]{6}$/;

const ANSI_16_RGB_TABLE: Rgb[] = [
	[0, 0, 0],
	[128, 0, 0],
	[0, 128, 0],
	[128, 128, 0],
	[0, 0, 128],
	[128, 0, 128],
	[0, 128, 128],
	[192, 192, 192],
	[128, 128, 128],
	[255, 0, 0],
	[0, 255, 0],
	[255, 255, 0],
	[0, 0, 255],
	[255, 0, 255],
	[0, 255, 255],
	[255, 255, 255],
];

const THEME_COLOR_VALUES = [
	"accent",
	"border",
	"borderAccent",
	"borderMuted",
	"success",
	"error",
	"warning",
	"muted",
	"dim",
	"text",
	"thinkingText",
	"userMessageText",
	"customMessageText",
	"customMessageLabel",
	"toolTitle",
	"toolOutput",
	"mdHeading",
	"mdLink",
	"mdLinkUrl",
	"mdCode",
	"mdCodeBlock",
	"mdCodeBlockBorder",
	"mdQuote",
	"mdQuoteBorder",
	"mdHr",
	"mdListBullet",
	"toolDiffAdded",
	"toolDiffRemoved",
	"toolDiffContext",
	"syntaxComment",
	"syntaxKeyword",
	"syntaxFunction",
	"syntaxVariable",
	"syntaxString",
	"syntaxNumber",
	"syntaxType",
	"syntaxOperator",
	"syntaxPunctuation",
	"thinkingOff",
	"thinkingMinimal",
	"thinkingLow",
	"thinkingMedium",
	"thinkingHigh",
	"thinkingXhigh",
	"thinkingMax",
	"bashMode",
] as const satisfies readonly ThemeColor[];

const THEME_COLOR_SET = new Set<string>(THEME_COLOR_VALUES);

function ansi16ToRgb(index: number): Rgb {
	return ANSI_16_RGB_TABLE[index] ?? [255, 255, 255];
}

function ansi256ToRgb(index: number): Rgb {
	if (index < 16) return ansi16ToRgb(index);
	if (index >= 232) {
		const g = 8 + (index - 232) * 10;
		return [g, g, g];
	}
	const i = index - 16;
	const vals = [0, 95, 135, 175, 215, 255];
	return [vals[Math.floor(i / 36)]!, vals[Math.floor((i % 36) / 6)]!, vals[i % 6]!];
}

function parseHexRgb(hex: `#${string}`): Rgb {
	return [
		Number.parseInt(hex.slice(1, 3), 16),
		Number.parseInt(hex.slice(3, 5), 16),
		Number.parseInt(hex.slice(5, 7), 16),
	];
}

function parseTruecolorAnsi(ansi: string): Rgb | undefined {
	const m = ansi.match(/38;2;(\d+);(\d+);(\d+)/);
	return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
}

function parseAnsi256Foreground(ansi: string): Rgb | undefined {
	const m = ansi.match(/38;5;(\d+)/);
	return m ? ansi256ToRgb(Number(m[1])) : undefined;
}

function parseAnsi16Foreground(ansi: string): Rgb | undefined {
	const nm = ansi.match(/(?:\[|;)(3[0-7])(?:;|m)/);
	if (nm) return ansi16ToRgb(Number(nm[1]) - 30);
	const bm = ansi.match(/(?:\[|;)(9[0-7])(?:;|m)/);
	if (bm) return ansi16ToRgb(Number(bm[1]) - 90 + 8);
	return undefined;
}

function parseForegroundRgbFromAnsi(ansi: string): Rgb | undefined {
	return parseTruecolorAnsi(ansi) ?? parseAnsi256Foreground(ansi) ?? parseAnsi16Foreground(ansi);
}

function paintRgb(rgb: Rgb, text: string): string {
	return `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m${text}${ANSI_RESET}`;
}

class HeaderColor {
	private constructor(private readonly source: HeaderColorSource) {}

	static fromThemeColor(token: ThemeColor): HeaderColor {
		return new HeaderColor({ kind: "theme", token });
	}

	static parse(value: unknown, path: string): HeaderColor {
		if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255) {
			return new HeaderColor({ kind: "rgb", value: ansi256ToRgb(value) });
		}
		if (typeof value === "string" && HEX_RGB_PATTERN.test(value)) {
			return new HeaderColor({ kind: "rgb", value: parseHexRgb(value as `#${string}`) });
		}
		if (typeof value === "string" && THEME_COLOR_SET.has(value)) {
			return HeaderColor.fromThemeColor(value as ThemeColor);
		}
		throw new Error(`${path} must be a ThemeColor, #RRGGBB value, or integer from 0 to 255`);
	}

	toRgb(theme: Theme): Rgb | undefined {
		if (this.source.kind === "rgb") return this.source.value;
		return parseForegroundRgbFromAnsi(theme.getFgAnsi(this.source.token));
	}

	paint(theme: Theme, text: string): string {
		if (this.source.kind === "theme") return theme.fg(this.source.token, text);
		return paintRgb(this.source.value, text);
	}
}

// ─── Vendored: header-config ──────────────────────────────────────────────────

const HEADER_COLOR_KEYS = ["logoGradientBase", "textBase", "textHighlight"] as const;
type HeaderColorKey = (typeof HEADER_COLOR_KEYS)[number];
type HeaderColorSettings = Partial<Record<HeaderColorKey, HeaderColor>>;
type EffectiveHeaderColorSettings = Required<HeaderColorSettings>;
type ThemeOverride = HeaderColorSettings & { theme: string };
type StartupHeaderConfig = { general?: HeaderColorSettings; themeOverrides?: ThemeOverride[] };

const DEFAULT_HEADER_COLORS: EffectiveHeaderColorSettings = {
	logoGradientBase: HeaderColor.fromThemeColor("accent"),
	textBase: HeaderColor.fromThemeColor("accent"),
	textHighlight: HeaderColor.fromThemeColor("mdLink"),
};

const EMPTY_STARTUP_HEADER_CONFIG: StartupHeaderConfig = {};
const CONFIGURATION_WARNING = "Failed to load pi-startup-header configuration. Using default colors.";
const CONFIG_FILE_NAME = "pi-startup-header.json";

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function expectRecord(v: unknown, path: string): Record<string, unknown> {
	if (!isRecord(v)) throw new Error(`${path} must be an object`);
	return v;
}

function assertKnownKeys(v: Record<string, unknown>, allowed: readonly string[], path: string) {
	for (const k of Object.keys(v)) {
		if (!allowed.includes(k)) throw new Error(`${path} contains unknown field: ${k}`);
	}
}

function parseHeaderColorSettings(v: unknown, path: string): HeaderColorSettings {
	const s = expectRecord(v, path);
	assertKnownKeys(s, HEADER_COLOR_KEYS, path);
	const result: HeaderColorSettings = {};
	for (const k of HEADER_COLOR_KEYS) {
		if (Object.hasOwn(s, k)) result[k] = HeaderColor.parse(s[k], `${path}.${k}`);
	}
	return result;
}

function parseStartupHeaderConfig(v: unknown): StartupHeaderConfig {
	const config = expectRecord(v, "configuration");
	assertKnownKeys(config, ["general", "themeOverrides"], "configuration");
	const result: StartupHeaderConfig = {};
	if (Object.hasOwn(config, "general")) {
		result.general = parseHeaderColorSettings(config.general, "general");
	}
	if (Object.hasOwn(config, "themeOverrides")) {
		if (!Array.isArray(config.themeOverrides)) throw new Error("themeOverrides must be an array");
		const seen = new Set<string>();
		result.themeOverrides = config.themeOverrides.map((o, i) => {
			const path = `themeOverrides[${i}]`;
			const rec = expectRecord(o, path);
			assertKnownKeys(rec, ["theme", ...HEADER_COLOR_KEYS], path);
			if (typeof rec.theme !== "string" || rec.theme.length === 0) {
				throw new Error(`${path}.theme must be a non-empty string`);
			}
			if (seen.has(rec.theme)) throw new Error(`themeOverrides contains duplicate theme: ${rec.theme}`);
			seen.add(rec.theme);
			const colors: HeaderColorSettings = {};
			for (const k of HEADER_COLOR_KEYS) {
				if (Object.hasOwn(rec, k)) colors[k] = HeaderColor.parse(rec[k], `${path}.${k}`);
			}
			return { theme: rec.theme, ...colors };
		});
	}
	return result;
}

async function loadStartupHeaderConfig(path: string): Promise<StartupHeaderConfig> {
	let content: string;
	try {
		content = await readFile(path, "utf8");
	} catch (e) {
		if (isRecord(e) && e["code"] === "ENOENT") return EMPTY_STARTUP_HEADER_CONFIG;
		throw e;
	}
	return parseStartupHeaderConfig(JSON.parse(content) as unknown);
}

function resolveHeaderColorSettings(
	config: StartupHeaderConfig,
	themeName: string | undefined,
): EffectiveHeaderColorSettings {
	const override = themeName ? config.themeOverrides?.find((o) => o.theme === themeName) : undefined;
	return {
		logoGradientBase:
			override?.logoGradientBase ?? config.general?.logoGradientBase ?? DEFAULT_HEADER_COLORS.logoGradientBase,
		textBase: override?.textBase ?? config.general?.textBase ?? DEFAULT_HEADER_COLORS.textBase,
		textHighlight: override?.textHighlight ?? config.general?.textHighlight ?? DEFAULT_HEADER_COLORS.textHighlight,
	};
}

// ─── Vendored: header-renderer ────────────────────────────────────────────────

const LOGO_LINES = [
	"████████████╗",
	"████████████║",
	"████╔═══████║",
	"████║   ████║",
	"████████╬═══████╗",
	"████████║   ████║",
	"████╔═══╝   ████║",
	"████║       ████║",
	"╚═══╝       ╚═══╝",
];

const TAGLINE_LINE_1 = "There are many agent harnesses,";
const TAGLINE_LINE_2_PREFIX = "but this one is ";
const TAGLINE_LINE_2_HIGHLIGHT = "yours";
const TAGLINE_LINE_2_SUFFIX = ".";

const LOGO_BLOCK_WIDTH = Math.max(...LOGO_LINES.map((l) => visibleWidth(l)));
const FALLBACK_LOGO_GRADIENT_BASE_RGB: Rgb = [80, 160, 255];

const PALETTE_STEPS = 24;
const PALETTE_MAX_DARKEN = 0.18;
const PALETTE_MAX_LIGHTEN = 0.18;
const LOGO_ROW_PHASE_STEP = 0.12;

function clampByte(v: number): number {
	return Math.max(0, Math.min(255, Math.round(v)));
}

function interpRgb(a: Rgb, b: Rgb, t: number): Rgb {
	return [
		Math.round(a[0] + (b[0] - a[0]) * t),
		Math.round(a[1] + (b[1] - a[1]) * t),
		Math.round(a[2] + (b[2] - a[2]) * t),
	];
}

function darkenRgb(rgb: Rgb, amount: number): Rgb {
	return [clampByte(rgb[0] * (1 - amount)), clampByte(rgb[1] * (1 - amount)), clampByte(rgb[2] * (1 - amount))];
}

function lightenRgb(rgb: Rgb, amount: number): Rgb {
	return [
		clampByte(rgb[0] + (255 - rgb[0]) * amount),
		clampByte(rgb[1] + (255 - rgb[1]) * amount),
		clampByte(rgb[2] + (255 - rgb[2]) * amount),
	];
}

function resolveLogoGradientBase(theme: Theme, color: HeaderColor): Rgb {
	return color.toRgb(theme) ?? FALLBACK_LOGO_GRADIENT_BASE_RGB;
}

function buildGradientPalette(base: Rgb): Rgb[] {
	return Array.from({ length: PALETTE_STEPS }, (_, i) => {
		const wave = -Math.cos((i / PALETTE_STEPS) * Math.PI * 2);
		return wave < 0 ? darkenRgb(base, PALETTE_MAX_DARKEN * -wave) : lightenRgb(base, PALETTE_MAX_LIGHTEN * wave);
	});
}

function sampleGradient(palette: Rgb[], position: number): Rgb {
	const p = ((position % 1) + 1) % 1;
	const scaled = p * palette.length;
	const base = Math.floor(scaled) % palette.length;
	return interpRgb(palette[base]!, palette[(base + 1) % palette.length]!, scaled - Math.floor(scaled));
}

function renderGradientText(text: string, palette: Rgb[], phase: number): string {
	const span = Math.max(LOGO_BLOCK_WIDTH - 1, 1);
	return [...text]
		.map((ch, i) => {
			if (ch === " ") return ch;
			return paintRgb(sampleGradient(palette, i / span + phase), ch);
		})
		.join("");
}

export function fitHeader(lines: readonly string[], width: number): string[] {
	return lines.map((line) => truncateToWidth(line, Math.max(0, width), ""));
}

function fitLineToWidth(line: string, width: number): string {
	return truncateToWidth(line, Math.max(0, width), "");
}

function renderLogoLines(width: number, theme: Theme, colors: EffectiveHeaderColorSettings): string[] {
	const palette = buildGradientPalette(resolveLogoGradientBase(theme, colors.logoGradientBase));
	return LOGO_LINES.map((line, row) => {
		const styled = renderGradientText(line, palette, row * LOGO_ROW_PHASE_STEP);
		const leftPad = Math.max(0, Math.floor((width - LOGO_BLOCK_WIDTH) / 2));
		return " ".repeat(leftPad) + styled;
	});
}

function renderTaglineLines(width: number, theme: Theme, colors: EffectiveHeaderColorSettings): string[] {
	type Part = { raw: string; styled: string };
	function center(parts: Part[]): string {
		const raw = parts.map((p) => p.raw).join("");
		const pad = Math.max(0, Math.floor((width - visibleWidth(raw)) / 2));
		return " ".repeat(pad) + parts.map((p) => p.styled).join("");
	}
	return [
		center([{ raw: TAGLINE_LINE_1, styled: colors.textBase.paint(theme, TAGLINE_LINE_1) }]),
		center([
			{ raw: TAGLINE_LINE_2_PREFIX, styled: colors.textBase.paint(theme, TAGLINE_LINE_2_PREFIX) },
			{
				raw: TAGLINE_LINE_2_HIGHLIGHT,
				styled: theme.bold(colors.textHighlight.paint(theme, TAGLINE_LINE_2_HIGHLIGHT)),
			},
			{ raw: TAGLINE_LINE_2_SUFFIX, styled: colors.textBase.paint(theme, TAGLINE_LINE_2_SUFFIX) },
		]),
	];
}

// ─── Cat ──────────────────────────────────────────────────────────────────────

const CAT = [" ╙／l、    ", "（ﾟ､ ｡７   ", "  l  ~ヽ   ", "  じしf_,)ノ"];
const BUBBLE = ["╭─────────╮", "│ meow :3 │", "╰╥────────╯"];

// Bubble stacked above the cat.
const CAT_PANEL = [...BUBBLE, ...CAT];
const CAT_PANEL_WIDTH = Math.max(...CAT_PANEL.map((l) => visibleWidth(l)));

// ─── Layout ───────────────────────────────────────────────────────────────────

function buildHeader(width: number, theme: Theme, config: StartupHeaderConfig): string[] {
	const colors = resolveHeaderColorSettings(config, theme.name);
	const muted = (t: string) => theme.fg("muted", t);

	// Logo centered in the full width.
	const logoLines = renderLogoLines(width, theme, colors);

	// Bottom-align the cat panel within the logo block.
	const catOffset = logoLines.length - CAT_PANEL.length;
	const catStart = Math.max(0, width - CAT_PANEL_WIDTH);

	const combinedLines = logoLines.map((line, i) => {
		const catIdx = i - catOffset;
		if (catIdx < 0) return line;

		// Pad logo line to catStart columns, then append the cat.
		const vis = visibleWidth(line);
		const base = vis <= catStart ? line + " ".repeat(catStart - vis) : truncateToWidth(line, catStart, "");
		return base + muted(CAT_PANEL[catIdx] ?? "");
	});

	const taglineLines = renderTaglineLines(width, theme, colors);
	const dim = (t: string) => theme.fg("dim", t);

	return ["", ...combinedLines, "", ...taglineLines, "", `  ${muted("pi")}${dim(` v${VERSION}`)}`, ""].map((line) =>
		fitLineToWidth(line, width),
	);
}

// ─── Extension ────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;

		let config = EMPTY_STARTUP_HEADER_CONFIG;
		try {
			config = await loadStartupHeaderConfig(join(getAgentDir(), CONFIG_FILE_NAME));
		} catch {
			ctx.ui.notify(CONFIGURATION_WARNING, "warning");
		}

		ctx.ui.setHeader((_tui, theme) => ({
			render: (width: number): string[] => buildHeader(width, theme, config),
			invalidate() {},
		}));
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		ctx.ui.setHeader(undefined);
	});
}
