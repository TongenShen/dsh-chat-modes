# dsh-chat-modes

A **bundle of three chat modes** for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): install one plugin and the new-session preset list gains Chat / Extreme Chat / Stateless Chat, each switchable from a settings page. A disabled mode simply does not appear for new sessions.

Each mode is also available on its own:

- [dsh-chat-mode](https://github.com/TongenShen/dsh-chat-mode) — Chat
- [dsh-extreme-chat-mode](https://github.com/TongenShen/dsh-extreme-chat-mode) — Extreme Chat
- [dsh-stateless-chat-mode](https://github.com/TongenShen/dsh-stateless-chat-mode) — Stateless Chat

**Do not install both ways at once**: the standalone packages and this bundle register the same preset ids, and `agentPresets.register()` rejects a duplicate id. Pick one.

## The three modes

| | Chat | Extreme Chat | Stateless Chat |
| --- | --- | --- | --- |
| System prompt | chat persona | empty | empty |
| AGENTS.md / skill catalog | yes | no | no |
| Tools | web search | none | none |
| Conversation history | kept | kept | **cleared each turn** |

- **Chat** — like a chat assistant: web search available, remembers context.
- **Extreme Chat** — every request carries only your input and the model's own output; nothing else is injected.
- **Stateless Chat** — on top of that, history is severed: one message in, one answer out, no memory of the previous turn. The transcript still keeps every turn.

## Settings switches

Sidebar → Settings → **Chat modes** (`order: 21`, right after Agent presets), three rows.

Disabling a mode:

- removes it from the **new-session preset list**
- leaves running sessions untouched (they keep the composition they started with)
- can be undone anytime

Disabling is not hiding; the preset is **never registered**. The new-session list comes from the `agentPresets` registry (`dsh-agent-preset-registry/lib/index.js:586`, `list()`), so an unregistered preset simply is not there.

## How it works

### Host half (`index.js`)

Registers the enabled modes into `agentPresets` and exposes a read/write endpoint on the webServer that carries the GUI:

```text
GET  /chat-modes/switches  -> { chat, extremeChat, statelessChat }
POST /chat-modes/switches  <- { key, enabled }
```

Writes go through `configEditor.edit()`, which stores the value in this plugin's own configuration row — the supported way for a plugin to persist its configuration. The edit restarts the plugin, so `apply` re-registers with the new values and the switches survive a restart.

The path deliberately **avoids `/api`**: that prefix belongs to the shared RPC channel and its auth layer, so every `/api/*` request — including paths that do not exist — is rejected with 401 before a plugin's exact route can see it, and from outside one cannot tell whether the route exists. On the root path the request reaches webServer's exact table, and a miss is a 404, which is verifiable.

Auth uses two independently checkable conditions: the source must be a loopback address, and a request carrying `Origin` must be same-origin with its `Host`. The switches only decide which UI modes are visible — no credentials or file contents — so that strength is proportionate.

**No `Config` export**: this package does not depend on schemastery (a harness-internal package that may not resolve once the plugin is installed into a profile). Cordis's `resolveConfig` returns the raw configuration when no `Config` is present, so `readSwitches()` normalizes it itself — only a literal `true` counts as enabled.

### The three presets

`chat-no-tools.js`, `extreme-chat-no-tools.js`, and `stateless-chat.js` are sub-plugins referenced as `dsh-chat-modes/<name>`, each running in its preset's own scope.

- **Chat** masks host-global tools with `deny: ['working_directory']` while keeping its own web search
- **Extreme** clears every inherited tool with `allow: []` and shadows `working-directory:current`, the one runtime context marked `required: true`
- **Stateless** shadows history on the model-visible surface in `agent/pre-step`, replacing it with an empty-content system node that `deriveEventMessage` drops; the UI reads the raw log and is unaffected. The shadowed range must skip surface node 0: `assertSystemHeadRewrite` allows a `system/message` at node 0 to be replaced only by a `system/message` covering exactly that node, so a multi-node replace is rejected and the append throws. Node 0 is always a system node (`SystemPromptProjection` claims it on the first request), so a full-range shadow always fails on real sessions — and because the throw is caught, the symptom is simply "history is still there"

## Install

Requires DeepSeek Harness 0.2.1-rc.1 or later.

```text
plugin_manager install_bundle target github:TongenShen/dsh-chat-modes
```

Or a local directory:

```text
plugin_manager install_bundle target <absolute path to this repository>
```

Restart DSH afterwards. The three modes appear in new sessions and the **Chat modes** settings page appears.

## Notes

- All three modes apply to **new sessions** only.
- Uninstall the three standalone packages (`dsh-chat-mode` / `dsh-extreme-chat-mode` / `dsh-stateless-chat-mode`) before installing this bundle, or the preset ids collide.
- Chat's web search needs `DEEPSEEK_API_KEY` (or a signed-in DeepSeek account model).
- Extreme and Stateless send no system prompt at all, so the model receives no role, language, or formatting instruction.
- Stateless genuinely forgets the previous turn; "continue from what you just said" cannot work. That is the point.

## Uninstall

```text
plugin_manager remove_bundle target dsh-chat-modes
```

Then restart DSH.

## License

MIT
