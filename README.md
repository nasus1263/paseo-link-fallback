# paseo-link-fallback

[한국어](README.ko.md)

A [Paseo](https://paseo.sh) plugin that makes file links in agent replies open even when the written path does not match the file exactly. Examples: paths relative to the workspace root, paths from another checkout, or file names with spaces.

## Install

```bash
paseo plugin add git:nasus1263/paseo-link-fallback
```

Plugins must be enabled on the daemon (**Settings → Plugins → Enable plugins**). Requires Paseo `>=0.15.4`.

## Usage

No setup. It works automatically on finished assistant messages. To resolve a link, it tries these in order:

1. The path as written (absolute, or relative to the agent's cwd)
2. Relative to the workspace root, then the path's trailing parts
3. A file with the same name anywhere in the workspace (the closest folder match wins, then the shortest path)

## Notes

- Rewritten messages lose some features of Paseo's built-in renderer, such as inline images.
- The name search skips folders like `node_modules` and `.git`, and stops after 200,000 files or 4 seconds.
- Everything runs on the daemon machine. Nothing is sent elsewhere.
- When paseo-doc-ask reply annotations are on, doc-ask does the link resolution instead.
