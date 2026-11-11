import type { PluginServerContext } from "@getpaseo/plugin/server";
import { resolveLinks } from "./server/resolve";
import { resolveLinksRpc } from "./shared/links";

export default function contribute(server: PluginServerContext) {
  server.handle(resolveLinksRpc, resolveLinks);
  return () => {};
}
