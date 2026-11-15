import { readdir, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import type { RpcInput } from "@getpaseo/plugin";
import type { Resolution, resolveLinksRpc } from "../shared/links";

/** Directories the file-name search never enters: dependencies, VCS data, and caches. */
const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "__pycache__",
  ".venv",
  "venv",
  ".gradle",
  ".dart_tool",
  ".vs",
  ".idea",
  ".next",
  ".cache",
  "Pods",
  "Library",
  "Temp",
  "obj",
]);
const MAX_INDEXED_FILES = 200_000;
const MAX_INDEX_MS = 4_000;
const INDEX_TTL_MS = 30_000;

export async function resolveLinks({ cwd, root, paths }: RpcInput<typeof resolveLinksRpc>) {
  const results: Resolution[] = [];
  for (const path of paths) results.push(await resolveOne(path, cwd, root));
  return { results };
}

async function resolveOne(written: string, cwd: string, root: string): Promise<Resolution> {
  const path = written.replace(/\\/g, "/");
  // 1. As written: absolute, or relative to the agent's cwd as Paseo reads it, or to the root.
  const direct = isAbsolute(path) ? [path] : [join(cwd, path), join(root, path)];
  for (const candidate of direct) {
    if (await isFile(candidate)) return found(candidate);
  }

  // 2. The path's trailing segments under the workspace root, longest first.
  const segments = path
    .split("/")
    .filter((segment) => segment && segment !== "." && segment !== ".." && !/^[A-Za-z]:$/.test(segment));
  for (let from = 0; from < segments.length - 1; from += 1) {
    const candidate = join(root, ...segments.slice(from));
    if (await isFile(candidate)) return found(candidate);
  }

  // 3. A file of the same name anywhere in the workspace; the best match when there are several.
  const name = segments.at(-1);
  if (!name) return { status: "missing" };
  const matches = (await fileIndex(root)).get(name.toLowerCase()) ?? [];
  if (matches.length === 0) return { status: "missing" };
  // Several files share the name: the one whose folders match the written path furthest up wins,
  // then the shortest path.
  const [best] = [...matches].sort(
    (a, b) => sharedTail(b, segments) - sharedTail(a, segments) || a.length - b.length,
  );
  return found(best!);
}

function found(path: string): Resolution {
  return { status: "found", path: slashes(resolve(path)) };
}

function slashes(path: string): string {
  return path.replace(/\\/g, "/");
}

/** How many trailing path segments `path` shares with the written ones. */
function sharedTail(path: string, written: string[]): number {
  const parts = slashes(path).toLowerCase().split("/");
  let count = 0;
  while (
    count < written.length &&
    parts[parts.length - 1 - count] === written[written.length - 1 - count]?.toLowerCase()
  ) {
    count += 1;
  }
  return count;
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

type FileIndex = Map<string, string[]>;
const indexes = new Map<string, { builtAt: number; index: Promise<FileIndex> }>();

/** Files under `root` by lower-cased name, rebuilt when older than the TTL. */
function fileIndex(root: string): Promise<FileIndex> {
  const key = slashes(resolve(root)).toLowerCase();
  const cached = indexes.get(key);
  if (cached && Date.now() - cached.builtAt < INDEX_TTL_MS) return cached.index;
  const index = buildIndex(resolve(root));
  indexes.set(key, { builtAt: Date.now(), index });
  index.catch(() => indexes.delete(key));
  return index;
}

async function buildIndex(root: string): Promise<FileIndex> {
  const index: FileIndex = new Map();
  const deadline = Date.now() + MAX_INDEX_MS;
  const queue = [root];
  let files = 0;
  while (queue.length > 0 && files < MAX_INDEXED_FILES && Date.now() < deadline) {
    const directory = queue.shift()!;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) queue.push(full);
      } else if (entry.isFile()) {
        const name = entry.name.toLowerCase();
        const list = index.get(name);
        if (list) list.push(full);
        else index.set(name, [full]);
        files += 1;
      }
    }
  }
  return index;
}
