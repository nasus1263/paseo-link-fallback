import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** A file path an assistant message points at, with the lines the link names. */
export interface FileTarget {
  path: string;
  lineStart?: number;
  lineEnd?: number;
}

/** A file reference in a message: a Markdown link or an inline code span. */
export interface LinkToken {
  kind: "link" | "code";
  /** Offsets of the whole link or code span in the message text. */
  start: number;
  end: number;
  /** The link label, or the code span's content. */
  label: string;
  target: FileTarget;
}

const resolutionSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("found"), path: z.string() }),
  z.object({ status: z.literal("missing") }),
]);
export type Resolution = z.infer<typeof resolutionSchema>;

/**
 * Finds the file each path refers to: as written (absolute, or relative to the agent's cwd),
 * then relative to the workspace root, then by file name anywhere in the workspace, taking the
 * best match when several files share the name.
 */
export const resolveLinksRpc = defineRpc({
  name: "link-fallback.resolve",
  input: z.object({
    cwd: z.string(),
    root: z.string(),
    paths: z.array(z.string()).max(200),
  }),
  output: z.object({ results: z.array(resolutionSchema) }),
});

// Code spans name many things that are not files (`console.log`, `client.addTheme`); only
// spans ending in one of these extensions count as file references.
const CODE_SPAN_EXTENSIONS = new Set(
  (
    "astro bash bat c cc cfg cjs cmd conf cpp cs csv css cts cxx dart env fish go gql gradle " +
    "graphql h hpp htm html hwp ini ipynb java jpeg jpg js json jsonc jsx kt kts less lock lua " +
    "md mdx mjs mts pdf php png proto ps1 py rb rs sass scss sh sql svelte svg swift toml ts " +
    "tsx txt vue xml yaml yml zsh"
  ).split(" "),
);

const TOKEN = /(!?)\[([^\]\n]*)\]\(([^()\n]*)\)|(`+)([^`\n]+?)\4/g;

/** File references in a message, outside fenced code blocks, in order. */
export function extractLinkTokens(text: string): LinkToken[] {
  const fences = fencedRanges(text);
  const tokens: LinkToken[] = [];
  for (const match of text.matchAll(TOKEN)) {
    const start = match.index;
    const end = start + match[0].length;
    if (fences.some(([from, to]) => start < to && end > from)) continue;
    if (match[3] !== undefined) {
      if (match[1]) continue; // image
      const target = parseTarget(unwrapHref(match[3]), "link");
      if (target) tokens.push({ kind: "link", start, end, label: match[2] ?? "", target });
    } else {
      const content = match[5] ?? "";
      const target = parseTarget(content, "code");
      if (target) tokens.push({ kind: "code", start, end, label: content, target });
    }
  }
  return tokens;
}

/** Each distinct path the tokens name, in first-seen order. */
export function distinctPaths(tokens: LinkToken[]): string[] {
  return [...new Set(tokens.map((token) => token.target.path))];
}

/** Points every resolved reference at the file found for it, as a link Paseo opens in a file tab. */
export function rewriteMessage(
  text: string,
  tokens: LinkToken[],
  resolutions: ReadonlyMap<string, Resolution>,
  root: string,
): string {
  let markdown = text;
  for (const token of [...tokens].reverse()) {
    const resolution = resolutions.get(token.target.path);
    if (resolution?.status !== "found") continue;
    const href = fileHref({ ...token.target, path: resolution.path }, root);
    const label = token.kind === "link" ? token.label : text.slice(token.start, token.end);
    markdown = `${markdown.slice(0, token.start)}[${label}](<${href}>)${markdown.slice(token.end)}`;
  }
  return markdown;
}

/**
 * The link target Paseo opens. Paseo resolves a relative target against the workspace root; an
 * absolute Windows path can be taken for a URL scheme, so it is used only outside the root.
 */
export function fileHref(target: FileTarget, root: string): string {
  const path = target.path.replace(/\\/g, "/");
  const relative = relativeTo(root, path);
  const body =
    relative !== null
      ? encodePath(relative)
      : path
          .split("/")
          .map((segment) => (/^[A-Za-z]:$/.test(segment) ? segment : encodeURIComponent(segment)))
          .join("/");
  if (!target.lineStart) return body;
  const end = target.lineEnd && target.lineEnd !== target.lineStart ? `-L${target.lineEnd}` : "";
  return `${body}#L${target.lineStart}${end}`;
}

/** `path` relative to `root` with forward slashes, or null when it is outside the root. */
export function relativeTo(root: string, path: string): string | null {
  const base = root.replace(/\\/g, "/").replace(/\/+$/, "");
  const full = path.replace(/\\/g, "/");
  if (!base) return null;
  const caseless = /^[A-Za-z]:/.test(base);
  const a = caseless ? base.toLowerCase() : base;
  const b = caseless ? full.toLowerCase() : full;
  return b.startsWith(`${a}/`) ? full.slice(base.length + 1) : null;
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/** The destination of a Markdown link, without angle brackets or a title. */
function unwrapHref(inner: string): string {
  const value = inner.trim();
  if (value.startsWith("<")) {
    const close = value.indexOf(">");
    return close > 0 ? value.slice(1, close) : value.slice(1);
  }
  return value.replace(/\s+("[^"]*"|'[^']*')$/, "");
}

/** Reads a link destination or code span as a file path with optional line numbers. */
export function parseTarget(raw: string, kind: "link" | "code"): FileTarget | null {
  let value = raw.trim().replace(/^['"]/, "").replace(/['"]$/, "");
  if (!value) return null;
  let decode = kind === "link";
  if (/^file:\/\//i.test(value)) {
    value = value.replace(/^file:\/\//i, "");
    if (/^\/[A-Za-z]:/.test(value)) value = value.slice(1);
    decode = true;
  } else if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) && !/^[A-Za-z]:[\\/]/.test(value)) {
    return null; // a URL such as https: or mailto:
  }
  if (value.startsWith("#") || value.includes("?")) return null;

  let lineStart: number | undefined;
  let lineEnd: number | undefined;
  const hash = value.indexOf("#");
  if (hash >= 0) {
    const lines = /^L(\d+)(?:C\d+)?(?:-L?(\d+)(?:C\d+)?)?$/i.exec(value.slice(hash + 1));
    value = value.slice(0, hash);
    if (lines) [lineStart, lineEnd] = [Number(lines[1]), lines[2] ? Number(lines[2]) : undefined];
  }
  if (decode) value = safeDecode(value);
  const suffix = /^(.+?):(\d+)(?::\d+)?(?:-(\d+)(?::\d+)?)?$/.exec(value);
  if (suffix?.[1]) {
    value = suffix[1];
    lineStart = Number(suffix[2]);
    lineEnd = suffix[3] ? Number(suffix[3]) : undefined;
  }
  const path = value.replace(/\\/g, "/");
  if (!looksLikeFile(path, kind)) return null;
  return { path, ...(lineStart ? { lineStart } : {}), ...(lineEnd ? { lineEnd } : {}) };
}

function looksLikeFile(path: string, kind: "link" | "code"): boolean {
  if (/[\n*"<>|]/.test(path) || path.endsWith("/")) return false;
  const name = path.split("/").at(-1) ?? "";
  const dot = name.lastIndexOf(".");
  if (dot <= 0 && !name.startsWith(".")) return false;
  const extension = name.slice(dot + 1);
  if (kind === "link") return /^[A-Za-z0-9_-]{1,12}$/.test(extension);
  if (/[(){}=;,$]/.test(path) || path.startsWith("-")) return false;
  return CODE_SPAN_EXTENSIONS.has(extension.toLowerCase());
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Offsets of fenced code blocks, whose contents are not links. */
function fencedRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let open: { start: number; fence: string } | null = null;
  let offset = 0;
  for (const line of text.split("\n")) {
    const fence = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (!open) open = { start: offset, fence };
      else if (fence[0] === open.fence[0] && fence.length >= open.fence.length) {
        ranges.push([open.start, offset + line.length]);
        open = null;
      }
    }
    offset += line.length + 1;
  }
  if (open) ranges.push([open.start, text.length]);
  return ranges;
}
