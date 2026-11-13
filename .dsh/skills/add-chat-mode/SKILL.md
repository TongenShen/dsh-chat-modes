---
name: add-chat-mode
description: 给 dsh-chat-modes 插件新增一个聊天模式。当用户要求「加一个 XXX 模式」「自定义聊天模式」，或要修改现有模式的组成、排查新加的模式不出现等问题时使用。给出五处必改点的精确位置与可套用的代码模板。
---

# 给 dsh-chat-modes 添加一个聊天模式

改 `index.js` 和 `client.js` 共 **5 处**。全改完才能工作：Host 侧决定注册什么，Client 侧决定设置页显示什么，两边独立，漏一侧就半边失效。

先读 `index.js` 和 `client.js`（各一次读全），再按下面顺序改。**不要**改 `cordis.patch.yml`，也不要动 `registerEnabled()` / `readSwitches()` / `installSwitchRoutes()`——它们遍历声明工作，加模式不需要碰。

## 第 0 步：判断要不要新建文件

模式的本质是 builder 返回的**插件行数组**。默认假设**不新建文件**：新模式的差异通常只是「挂哪些现成的 `@deepseek-ai/dsh-*` 行 + 它们的 config」。

只有需要**运行时干预**时才新建 `<name>.js`：

- 要拦截工具/注册表 → `ctx.tools.restrict(...)`（参考 `chat-no-tools.js`）
- 要挂钩子改写请求 → `ctx.on('agent/pre-step', ...)`（参考 `stateless-chat.js`）

新建文件时，必须同时在 `package.json` 的 `exports` 加一条 `"./<name>": "./<name>.js"`，否则预设行解析不到。

可用插件行清单：读 `@deepseek-ai/dsh-agent-preset` 包 README，或看本文件末尾的常用行。**不确定某个行名或 config 字段时不猜——先查，查不到就问用户。**

## 第 1 处：`index.js` 的 `DEFAULT_SWITCHES`

加一行，key 用 camelCase：

```js
export const DEFAULT_SWITCHES = {
  chat: true,
  extremeChat: true,
  statelessChat: true,
  <newKey>: true,        // ← 新增
}
```

漏改：设置页 POST 会被 `key in DEFAULT_SWITCHES` 拦下返回 400。

## 第 2 处：`index.js` 的 `MODES`

在数组末尾加一项。`id` 用 kebab-case，`order` 接着现有最大值递增：

```js
  {
    key: '<newKey>',                    // 与 DEFAULT_SWITCHES 的 key 逐字一致
    id: '<new-mode-id>',                // 全局唯一，不能与 chat / extreme-chat / stateless-chat 或三个独立包同名
    name: 'Display Name',
    description: '一句话说明这个模式的行为差异。',   // 显示在新会话选择器里，不走 i18n，只能一种语言
    order: 3,
  },
```

漏改：模式不注册，列表里不出现，开关点了也无效。注意 `description` 是唯一不经 i18n 的用户可见文案，写中文。

## 第 3 处：`index.js` 的 builder 函数 + `BUILDERS`

先写 builder（放在现有三个 builder 之后、`BUILDERS` 之前）：

```js
/**
 * <模式名>：<一句话说明它清掉了什么、保留了什么>。
 * @returns 该预设的插件行列表。
 */
function <newKey>Plugins() {
  return [
    {
      id: 'persona',
      name: '@deepseek-ai/dsh-persona',
      config: { prefix: '<人设为空就写空字符串>', complete: false, includeRuntimeContext: true },
    },
    { id: 'agent-instructions', name: '@deepseek-ai/dsh-agent-instructions', config: { maxBytes: 65536 } },
    { id: 'tool-fs', name: '@deepseek-ai/dsh-tool-fs' },
    { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash' },
    compactionGroup(),      // 只要保留历史就必须带
  ]
}
```

再在 `BUILDERS` 里挂上（**漏这半行 → 注册时 `BUILDERS[key]()` 是 undefined，抛 TypeError，模式标 broken**）：

```js
const BUILDERS = {
  chat: chatPlugins,
  extremeChat: extremePlugins,
  statelessChat: statelessPlugins,
  <newKey>: <newKey>Plugins,           // ← 新增
}
```

`compactionGroup()` 要不要带，看这个模式是否保留历史：`statelessPlugins()` 没有带，因为它每轮都清历史，压缩插件无从下手。

## 第 4 处：`client.js` 的 `ROWS`

```js
    const ROWS = [
      { key: 'chat', title: 'Chat', description: '...' },
      { key: 'extremeChat', title: 'Extreme Chat', description: '...' },
      { key: 'statelessChat', title: 'Stateless Chat', description: '...' },
      { key: '<newKey>', title: 'Display Name', description: '设置页的一句话说明。' },   // ← 新增
    ]
```

## 第 5 处：`client.js` 的 `ZH` / `EN` 词典

两本词典**各加两行**，key 是 `'row.' + key + '.title'` 和 `.description` 的形式：

```js
    const ZH = {
      // ...existing
      'row.<newKey>.title': 'Display Name',
      'row.<newKey>.description': '设置页的一句话说明。',
    }

    const EN = {
      // ...existing
      'row.<newKey>.title': 'Display Name',
      'row.<newKey>.description': 'One-line description for the settings page.',
    }
```

漏改：界面上直接显示 `row.<newKey>.title` 字面量（`t()` 找不到就回退到 key）。

## 三个硬约束

违反任何一条都会让**整个预设加载失败**，而不是静默降级：

1. **预设 `id` 全局唯一**。重复抛 `Duplicate agent preset: <id>`。
2. **`deny` 名单只能写真实存在的工具名**。`tools.restrict()` 校验 `restrictableNames`，写不存在的名字抛 `unknown global tool`。要清掉全部且不想维护名单，用 `allow: []`。
3. **`required: true` 的 runtime context 压不掉**。`includeRuntimeContext: false` 只对可选槽位生效；`working-directory:current` 是唯一标了 required 的一条，必须在同一作用域注册同名条目遮蔽它——照抄 `extreme-chat-no-tools.js` 的 `ctx.systemPrompt.context({ name: 'working-directory:current', ..., text: '' })` 那段。

## 改完必跑

在仓库根目录执行：

```sh
node --check index.js && node --check client.js   # 有新文件时逐个加上
node .dsh/skills/add-chat-mode/scripts/check-modes.mjs
```

第二个脚本校验五处真值是否对齐，退出码 0 才算改完。它会逐条列出缺哪一处，例如：

```
FAIL
  - index.js 的 BUILDERS 缺 key: codeChat
  - client.js 词典缺 row.codeChat.title
```

`node --check` 只查语法，抓不出「`DEFAULT_SWITCHES` 加了 key 但 `ROWS` 没加」这类跨文件不同步，所以必须跑第二个。脚本本身在 `scripts/check-modes.mjs`，逻辑是解析 `DEFAULT_SWITCHES` 的实际导出值，再反向核对另外四处，包括 ROWS 里有多余 key 的情况。

装好后人工确认：新建会话 → 预设列表出现新模式 → 设置页出现对应开关行 → 关掉后新模式从列表消失（已开会话不受影响）。这三步 agent 无法代劳，请让用户确认。

## 报错对照

| 症状 | 原因 |
|---|---|
| 新模式不在新会话列表 | `MODES` 没加，或开关为 false；看日志有没有 `注册预设 "<id>" 失败` |
| 设置页没有这一行 | `ROWS` 没加 |
| 开关点了 400 `unknown switch` | `DEFAULT_SWITCHES` 没加 |
| 开关点了 500 `configEditor unavailable` | profile 不支持持久化，环境问题，不是代码错 |
| 模式出现但标 broken | 某个插件行名拼错、config 不符 schema，或 `BUILDERS` 没挂；日志里有 `agent preset <id>: <原因>` |
| 界面显示 `row.xxx.title` | 词典没加 |

## 常用插件行

按需挑选，不用的不要挂（挂了就等于给了那个能力）：

| 行名 | 作用 |
|---|---|
| `@deepseek-ai/dsh-persona` | 系统提示词。`prefix` 接文本，`complete: true` + `prefix: ''` = 零系统提示词，`includeRuntimeContext: false` 压掉可选 runtime context |
| `@deepseek-ai/dsh-agent-instructions` | 载入 AGENTS.md / CLAUDE.md |
| `@deepseek-ai/dsh-tool-web` | 联网搜索与抓取（需 `DEEPSEEK_API_KEY`） |
| `@deepseek-ai/dsh-tool-fs` | 文件读写 |
| `@deepseek-ai/dsh-tool-fs-search` | glob / grep |
| `@deepseek-ai/dsh-tool-bash` | 执行命令 |
| `@deepseek-ai/dsh-tool-todo` | 任务清单 |
| `@deepseek-ai/dsh-tool-subagent` | 派子 agent |
| `compactionGroup()` | 历史压缩，保留历史时必带 |

Host 全局工具（如 `working_directory`）会被预设继承，要屏蔽就用 `ctx.tools.restrict({ deny: [...] })`。完整包清单见 `@deepseek-ai/dsh-agent-preset` README 或 `references/packages.md`。
