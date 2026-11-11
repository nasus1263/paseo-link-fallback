Makes file links in agent replies open even when the written path does not match the file exactly.

Paseo resolves a file link in an assistant message against the agent's working directory, and it ignores paths that contain spaces. When an agent writes a path relative to the workspace root, a path from another checkout, or a document name with spaces, clicking it does nothing. This plugin looks for the file on the daemon and points the link at it:

1. The path as written: absolute, or relative to the agent's working directory.
2. The path relative to the workspace root, then its trailing parts under the workspace root.
3. A file with the same name anywhere in the workspace. One match opens directly. With several matches, a list under the message shows each candidate so you can choose which one to open.

It applies to finished assistant messages that contain Markdown links or inline code naming a file. Messages without file references, and messages still streaming, keep Paseo's own rendering. Rewritten messages are drawn with Paseo's Markdown component, so they lose features specific to the built-in assistant message, such as inline images.

The name search skips dependency, VCS, and cache folders such as `node_modules` and `.git`, and stops after 200,000 files or 4 seconds. Everything stays on the daemon machine; nothing is sent elsewhere.
