import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  extractLinkTokens,
  fileHref,
  parseTarget,
  rewriteMessage,
} from "../shared/links.ts";
import { resolveLinks } from "../server/resolve.ts";

test("extracts Markdown links and file-looking code spans", () => {
  const text = [
    "See [doc](<docs/251112_101010 주제.md>) and `docs/251112_101010 주제.md:12`.",
    "Not files: `console.log`, [site](https://x.dev/a.md), ![img](a.png), `npm run build`.",
    "```",
    "`inside.md`",
    "```",
  ].join("\n");
  const tokens = extractLinkTokens(text);
  assert.deepEqual(
    tokens.map((t) => [t.kind, t.target]),
    [
      ["link", { path: "docs/251112_101010 주제.md" }],
      ["code", { path: "docs/251112_101010 주제.md", lineStart: 12 }],
    ],
  );
});

test("parses encoded, file:// and line-suffixed targets", () => {
  assert.deepEqual(parseTarget("docs/a%20b.md#L3-L5", "link"), {
    path: "docs/a b.md",
    lineStart: 3,
    lineEnd: 5,
  });
  assert.deepEqual(parseTarget("file:///C:/x/y.ts", "link"), { path: "C:/x/y.ts" });
  assert.deepEqual(parseTarget(String.raw`C:\x\y.ts:7`, "code"), { path: "C:/x/y.ts", lineStart: 7 });
  assert.equal(parseTarget("mailto:a@b.md", "link"), null);
});

test("hrefs are workspace-relative and encoded inside the root", () => {
  assert.equal(
    fileHref({ path: "C:/w/docs/a b.md", lineStart: 2 }, String.raw`c:\w`),
    "docs/a%20b.md#L2",
  );
  assert.equal(fileHref({ path: "D:/o/x y.md" }, "C:/w"), "D:/o/x%20y.md");
});

test("rewrites found references and leaves missing ones", () => {
  const text = "A [x](a.md) and `b.md` and `c.md`.";
  const tokens = extractLinkTokens(text);
  const resolutions = new Map([
    ["a.md", { status: "found", path: "C:/w/docs/a.md" }],
    ["b.md", { status: "found", path: "C:/w/1/b.md" }],
    ["c.md", { status: "missing" }],
  ]);
  const markdown = rewriteMessage(text, tokens, resolutions, "C:/w");
  assert.equal(markdown, "A [x](<docs/a.md>) and [`b.md`](<1/b.md>) and `c.md`.");
});

test("resolves via cwd, workspace root, trailing segments, then file name", async () => {
  const root = mkdtempSync(join(tmpdir(), "link-fallback-")).replace(/\\/g, "/");
  for (const dir of ["sub", "docs/deep", "one", "two/deep", "node_modules/x"]) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  for (const file of [
    "sub/local.md",
    "docs/root doc.md",
    "docs/deep/only.md",
    "one/dup.md",
    "two/dup.md",
    "two/deep/dup.md",
    "node_modules/x/only.md",
  ]) {
    writeFileSync(join(root, file), "");
  }
  const { results } = await resolveLinks({
    cwd: `${root}/sub`,
    root,
    paths: [
      "local.md",
      "docs/root doc.md",
      "C:/elsewhere/checkout/docs/root doc.md",
      "only.md",
      "dup.md",
      "x/deep/dup.md",
      "nothing.md",
    ],
  });
  const at = (p) => ({ status: "found", path: `${root}/${p}` });
  assert.deepEqual(results[0], at("sub/local.md"));
  assert.deepEqual(results[1], at("docs/root doc.md"));
  assert.deepEqual(results[2], at("docs/root doc.md"));
  assert.deepEqual(results[3], at("docs/deep/only.md"));
  assert.deepEqual(results[4], at("one/dup.md"));
  assert.deepEqual(results[5], at("two/deep/dup.md"));
  assert.deepEqual(results[6], { status: "missing" });
});
