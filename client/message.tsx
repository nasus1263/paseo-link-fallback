import { type PluginTimelineItemProps, useAgent, useRpc, useWorkspace } from "@getpaseo/plugin/client";
import { Markdown } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { z } from "zod";
import {
  chooserMarkdown,
  distinctPaths,
  extractLinkTokens,
  type Resolution,
  resolveLinksRpc,
  rewriteMessage,
} from "../shared/links";

export const messageSchema = z.object({ text: z.string() });

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, Promise<Resolution[]>>();

/** An assistant message whose file references point at the files found for them. */
export function ResolvedMessage({ item, agentId, theme }: PluginTimelineItemProps<z.infer<typeof messageSchema>>) {
  const { text } = item.data;
  const cwd = useAgent(agentId, (agent) => agent.cwd);
  const workspaceId = useAgent(agentId, (agent) => agent.workspaceId);
  const directory = useWorkspace(workspaceId ?? "", (workspace) => workspace.directory);
  const root = directory || cwd || "";

  const tokens = useMemo(() => extractLinkTokens(text), [text]);
  const paths = useMemo(() => distinctPaths(tokens), [tokens]);
  const results = useResolutions(paths, cwd ?? "", root);

  const { markdown, ambiguities } = useMemo(() => {
    if (!results) return { markdown: text, ambiguities: [] };
    const byPath = new Map(paths.map((path, index) => [path, results[index]!] as const));
    return rewriteMessage(text, tokens, byPath, root);
  }, [text, tokens, paths, results, root]);

  return (
    <View>
      <Markdown>{markdown}</Markdown>
      {ambiguities.map((ambiguity) => (
        <View
          key={ambiguity.target.path}
          style={{
            marginTop: 8,
            paddingHorizontal: 12,
            paddingVertical: 4,
            borderLeftWidth: 3,
            borderLeftColor: theme.colors.border,
          }}
        >
          <Markdown>{chooserMarkdown(ambiguity, root)}</Markdown>
        </View>
      ))}
    </View>
  );
}

/** The daemon's resolution of each path, or null until it answers. */
function useResolutions(paths: string[], cwd: string, root: string): Resolution[] | null {
  const resolve = useRpc(resolveLinksRpc);
  const key = cwd && root && paths.length > 0 ? JSON.stringify([cwd, root, paths]) : null;
  const [state, setState] = useState<{ key: string; results: Resolution[] } | null>(null);

  useEffect(() => {
    if (!key) return;
    let live = true;
    let pending = cache.get(key);
    if (!pending) {
      const request = resolve({ cwd, root, paths }).then((output) => output.results);
      cache.set(key, request);
      setTimeout(() => cache.delete(key), CACHE_TTL_MS);
      request.catch(() => cache.delete(key));
      pending = request;
    }
    pending.then(
      (results) => {
        if (live) setState({ key, results });
      },
      (error: unknown) => console.warn("[link-fallback] resolve failed", error),
    );
    return () => {
      live = false;
    };
    // `key` covers cwd, root, and paths.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, resolve]);

  return state?.key === key ? state.results : null;
}
