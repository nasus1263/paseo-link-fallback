import type { PluginClientContext } from "@getpaseo/plugin/client";
import { messageSchema, ResolvedMessage } from "./client/message";
import { extractLinkTokens } from "./shared/links";

const KIND = "link-fallback-message";

export default function contribute(client: PluginClientContext) {
  // Finished assistant messages that reference files are drawn by the plugin, which points each
  // reference at the file it found. Streaming messages and messages without references stay native.
  const removeTransformer = client.addTimelineTransformer({
    id: "assistant-file-links",
    query: { itemType: "assistant_message" },
    transform: ({ item, phase }) => {
      if (phase === "streaming" || extractLinkTokens(item.text).length === 0) return undefined;
      return { items: [{ type: "plugin", kind: KIND, version: 1, data: { text: item.text } }] };
    },
  });
  const removeRenderer = client.addTimelineRenderer({
    kind: KIND,
    version: 1,
    schema: messageSchema,
    Component: ResolvedMessage,
  });
  return () => {
    removeTransformer();
    removeRenderer();
  };
}
