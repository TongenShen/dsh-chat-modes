---
name: add-chat-mode
description: 给 dsh-chat-modes 插件新增一个聊天模式。当需要往这个仓库里加预设（比如 Code Chat、只读模式），改动现有的模式定义、或排查「新加的模式没出现在新会话列表里 / 设置页开关报 400 / 预设加载失败」这类问题时使用。
---

# 给 dsh-chat-modes 添加一个聊天模式

一个模式由**两半**描述：Host 半决定「注册什么」，Client 半决定「设置页怎么显示」。两边各自有独立的真值来源，必须同时改，漏一处就会出现模式能注册但开关不显示，或者开关能点但模式不存在。

## 先判断：要不要新建文件

模式的本质是 builder 返回的**插件行数组**。绝大多数新模式只是换一组现成的 `@deepseek-ai/dsh-*` 行加 config，**不需要新建任何 JS 文件**。

只有下面两种情况才需要新建 `xxx.js` 子插件，并在 `package.json` 的 `exports` 里加一条：

- 需要在运行时拦截某个注册表（如 `tools.restrict()` 屏蔽工具）
- 需要挂钩子改写请求（如 `agent/pre-step` 里遮蔽历史）

判断标准一句话：**能不能只靠「挂哪些插件行 + 它们的 config」表达出来？** 能，就只写数据。

## Host 半：改 `index.js` 的三处

三处都是独立的真值来源，必须同步改：

| 常量 | 作用 | 漏改的后果 |
|---|---|---|
| `DEFAULT_SWITCHES` | `readSwitches()` 据此归一化 | 设置页 POST 因 `key in DEFAULT_SWITCHES` 失败返回 400 |
| `MODES` | 决定注册哪些预设、id/名称/描述/排序 | 列表里不出现，开关怎么点都无效 |
| `BUILDERS` | 决定该模式由哪些插件行组成 | 注册时 `BUILDERS[key]()` 是 undefined，抛 TypeError |

`registerEnabled()`、`readSwitches()` 都是遍历上述声明，不用动。`cordis.patch.yml` 也不用动——它只有一个 Host 行。

现有 builder 可以直接当模板：

```js
function codeChatPlugins() {
  return [
    { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: '...' } },
    { id: 'agent-instructions', name: '@deepseek-ai/dsh-agent-instructions', config: { maxBytes: 65536 } },
    { id: 'tool-fs', name: '@deepseek-ai/dsh-tool-fs' },
    { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash' },
    compactionGroup(),   // 有历史上下文就要带，否则长会话会撑爆 context
  ]
}
```

## Client 半：改 `client.js` 的两处

- `ROWS` 数组：加一行，`key` 必须与 Host 侧 `DEFAULT_SWITCHES` 的 key 完全一致
- `ZH` / `EN` 词典：各加 `row.<key>.title` 和 `row.<key>.description`

漏了词典的症状很明确：界面上直接显示 `row.codeChat.title` 这种原始 key（`t()` 找不到就回退到 key 本身）。

注意 `client.js` 顶部的注释还写着 `/api/chat-modes/bundle`，那是改路由前的残留，实际端点是 `ENDPOINT = '/chat-modes/switches'`。

## 三个硬约束

1. **预设 `id` 必须全局唯一**。`agentPresets.register()` 对重复 id 抛 `Duplicate agent preset: <id>`（`dsh-agent-preset-registry/src/index.ts:100`），不能与 `chat` / `extreme-chat` / `stateless-chat` 或三个独立包撞车。

2. **`deny` 名单只能写真实存在的工具名**。`tools.restrict()` 会校验 `restrictableNames`，写不存在的名字抛 `unknown global tool`，整个预设加载失败（`dsh-tools/src/index.ts:179-183`）。要清掉全部且不想维护名单，用 `allow: []`。

3. **`required: true` 的 runtime context 压不掉**。`includeRuntimeContext: false` 只对可选槽位生效，`working-directory:current` 是唯一标了 required 的一条，必须在同一作用域注册一个同名条目遮蔽它（见 `extreme-chat-no-tools.js`）。

## 改完自检

```sh
cd dsh-chat-modes
node --check index.js && node --check client.js && node --check <新文件>.js
node -e "import('./index.js').then(m => {
  const sw = m.DEFAULT_SWITCHES
  const missing = Object.keys(sw).filter(k => !require('fs').readFileSync('client.js','utf8').includes(\"'\"+k+\"'\"))
  console.log('DEFAULT_SWITCHES:', Object.keys(sw))
  if (missing.length) { console.error('client.js 缺这些 key:', missing); process.exit(1) }
  console.log('ok')
})"
```

跨文件的真值一致性没法靠 `node --check` 抓出来，上面那段是唯一能自动化的校验。剩下的靠人工核一遍三张表是否对齐。

装好后在 DSH 里新建会话验证：预设列表出现新模式、设置页出现对应开关行、关掉后新模式从列表消失（已开会话不受影响）。

## 常见故障定位

| 症状 | 先查 |
|---|---|
| 模式不在新会话列表 | `MODES` 有没有加；`switches[key]` 是否为 `true`；`ctx.logger` 里有没有 `注册预设 "<id>" 失败` |
| 设置页没有这一行 | `client.js` 的 `ROWS`；`installStyles` 是否执行 |
| 开关点了 400 | `DEFAULT_SWITCHES` 有没有这个 key |
| 开关点了 500 `configEditor unavailable` | profile 不支持持久化，属环境问题 |
| 模式出现但标为 broken | 某个插件行名字拼错或 config 不符 schema，看 DSH 日志里 `agent preset <id>: <原因>` |
