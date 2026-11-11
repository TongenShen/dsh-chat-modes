# dsh-chat-modes

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 用的**三个聊天模式打包插件**：装一个插件，新会话的预设列表里就有 Chat / Extreme Chat / Stateless Chat 三个模式；在设置页可以逐个开关，关掉的模式不会出现在新会话里。

三个模式也可以单独安装，各自是一个仓库：

- [dsh-chat-mode](https://github.com/TongenShen/dsh-chat-mode) —— Chat
- [dsh-extreme-chat-mode](https://github.com/TongenShen/dsh-extreme-chat-mode) —— Extreme Chat
- [dsh-stateless-chat-mode](https://github.com/TongenShen/dsh-stateless-chat-mode) —— Stateless Chat

**不要同时安装**：三个独立包和本插件都会注册同名的预设，`agentPresets.register()` 对重复 id 抛错。选一种装法。

## 三个模式

| | Chat | Extreme Chat | Stateless Chat |
| --- | --- | --- | --- |
| 系统提示词 | 聊天人设 | 空 | 空 |
| AGENTS.md / 技能目录 | 有 | 无 | 无 |
| 工具 | 联网搜索 | 无 | 无 |
| 历史上下文 | 保留 | 保留 | **每轮清空** |

- **Chat**：像 ChatGPT 的聊天模式，能联网搜索，记得上下文。
- **Extreme Chat**：模型每次请求里只有你的输入和它自己的输出，没有任何附加信息。
- **Stateless Chat**：在极限模式之上再切断历史——你发一句它回一句，下一句它完全不记得之前说过什么。界面上的对话记录一条不少。

## 设置页开关

侧边栏「设置」→ 列表里的 **聊天模式**（`order: 21`，紧跟 Agent presets 之后），三行开关。

关掉一个模式后：

- 它**不再出现在新会话的预设列表**里
- 已经开始的会话不受影响（保留启动时的组合）
- 随时可以重新打开

实现上「关闭」不是隐藏，而是**根本不注册**：新会话的预设列表来自 `agentPresets` 注册表（`dsh-agent-preset-registry/lib/index.js:586` 的 `list()`），没注册的自然就不在列表里。

## 工作原理

### Host 半（`index.js`）

按开关把启用的模式注册进 `agentPresets`，并在承载 GUI 的 webServer 上开一个读写端点给设置页：

```text
GET  /chat-modes/switches  -> { chat, extremeChat, statelessChat }
POST /chat-modes/switches  <- { key, enabled }
```

写入走 `configEditor.edit()`，把值存进本插件这一行的配置里——这是插件保存自身配置的官方途径。改完 Loader 会重启本插件，`apply` 用新配置重新注册一遍，所以开关状态在重启后依然生效。

路径刻意**不放在 `/api` 下**：那个前缀整体归共享 RPC 通道与它的鉴权层所有，任何 `/api/*` 请求（包括根本不存在的路径）都会先被拦成 401，插件自己的 exact 路由拿不到请求，也无法从外部判断路由是否存在。挂在根路径上则命中 webServer 的 exact 表，未命中是 404，可验证。

鉴权用两条可独立验证的判据：来源必须是回环地址，且若请求带 `Origin` 必须与 Host 同源。开关只是「哪个 UI 模式可见」，不含凭据或文件内容，这个强度是相称的。

**没有导出 `Config`**：本包不依赖 schemastery（它是 harness 内部包，装进 profile 后不一定解析得到）。Cordis 的 `resolveConfig` 在没有 `Config` 时直接原样返回配置，所以由 `readSwitches()` 自己归一化——只有字面量 `true` 才算开启。

### 三个预设各自的实现

`chat-no-tools.js`、`extreme-chat-no-tools.js`、`stateless-chat.js` 是三个子插件，被预设行以 `dsh-chat-modes/<name>` 引用，跑在预设自己的 scope 里。

关键机制与独立包一致，细节见各自文件头部的注释：

- **Chat** 用 `deny: ['working_directory']` 屏蔽 Host 全局工具，保留自家的联网搜索
- **Extreme** 用 `allow: []` 清空全部继承工具，并遮蔽唯一标了 `required: true` 的 `working-directory:current` 上下文
- **Stateless** 在 `agent/pre-step` 里把历史从模型可见 surface 上遮蔽掉（替换成空 content 的 system 节点，`deriveEventMessage` 会丢弃它），界面读的是原始日志所以不受影响

## 安装

需要 DeepSeek Harness 0.2.1-rc.1 或更高版本。

```text
plugin_manager install_bundle target github:TongenShen/dsh-chat-modes
```

或本地目录：

```text
plugin_manager install_bundle target <本仓库的绝对路径>
```

安装后**重启 DSH**。新会话的预设列表里会出现三个模式，设置页会出现「聊天模式」一页。

## 注意事项

- 三个模式都只对**新建会话**生效。
- 装本插件前请先卸载三个独立包（`dsh-chat-mode` / `dsh-extreme-chat-mode` / `dsh-stateless-chat-mode`），否则预设 id 冲突。
- Chat 模式的联网搜索需要 `DEEPSEEK_API_KEY`（或使用 DeepSeek 账号登录的模型）。
- Extreme / Stateless 完全没有系统提示词，模型收不到任何角色、语言、格式约束，回答风格飘忽属预期。
- Stateless 是**真的不记得**上一轮，「接着刚才说的继续」做不到，这是设计目标。

## 卸载

```text
plugin_manager remove_bundle target dsh-chat-modes
```

然后重启 DSH。

## License

MIT
