/**
 * 三个聊天模式的打包插件（Host 半）。
 *
 * 两件事：
 *
 * 1. 按开关把启用的模式注册进 `agentPresets` 注册表。注册表就是新会话预设
 *    列表的来源（`dsh-agent-preset-registry/lib/index.js:586` 的 `list()`），
 *    所以「关掉一个模式」= 不注册它，它自然从新会话列表消失。已经开始的会话
 *    不受影响，保留它们启动时的组合。
 *
 * 2. 开两条受连接鉴权保护的 Fetch 路由，供设置页读写开关：
 *      GET  /api/chat-modes  -> { chat, extremeChat, statelessChat }
 *      POST /api/chat-modes  <- { key, enabled }
 *    写入走 `configEditor.edit()`，也就是把值存进本插件这一行的配置里 ——
 *    这是插件保存自身配置的官方途径：改完 Loader 会重启本插件，`apply`
 *    用新配置重新注册一遍预设。
 *
 * ## 为什么开关是普通配置字段
 *
 * `.volatile()` 字段能原地更新，但它是只读引用（没有 set 口），无法持久化。
 * 普通字段会被 configEditor 写进 profile 的 cordis.patch.yml，代价是编辑后
 * 插件重启一次。改开关本来就是一次性显式操作，这个代价可以接受。
 *
 * ## 为什么没有导出 Config
 *
 * 本包不依赖 schemastery（它是 harness 的内部包，插件装进 profile 后不一定
 * 解析得到）。Cordis 的 `resolveConfig`（`cordis/lib/index.js:244`）在没有
 * `Config` 时直接原样返回配置，所以改由 `readSwitches` 自己做归一化：只有
 * 字面量 `true` 才算开启，其余（缺失、脏值）一律按默认值。
 *
 * ## 三个预设共用本包
 *
 * 每个预设的 `plugins` 都引用本包的子插件（`dsh-chat-modes/...`）。它们跑在
 * 预设自己的 scope 里，与 Host 层的本行互不干扰。
 */
export const name = 'chat-modes'

export const inject = ['agentPresets']

/** 开关默认值：装完三个模式都能用。 */
export const DEFAULT_SWITCHES = {
  chat: true,
  extremeChat: true,
  statelessChat: true,
}

/** 三个模式的 identity 与在预设列表里的位置。 */
const MODES = [
  { key: 'chat', id: 'chat', name: 'Chat', order: 0 },
  { key: 'extremeChat', id: 'extreme-chat', name: 'Extreme Chat', order: 1 },
  { key: 'statelessChat', id: 'stateless-chat', name: 'Stateless Chat', order: 2 },
]

/** 新建一个压缩组，避免三个预设共用同一个对象引用。 */
function compactionGroup() {
  return {
    id: 'compaction',
    name: 'cordis:group',
    group: true,
    isolate: { compaction: true },
    config: [
      { id: 'compaction-basic', name: '@deepseek-ai/dsh-compaction-basic' },
      { id: 'command-compact', name: '@deepseek-ai/dsh-command-compact' },
    ],
  }
}

/**
 * Chat：人设 + AGENTS.md + 联网搜索，屏蔽 Host 全局工具。
 * @returns 该预设的插件行列表。
 */
function chatPlugins() {
  return [
    {
      id: 'persona',
      name: '@deepseek-ai/dsh-persona',
      config: {
        prefix: [
          '你是一个乐于助人的对话助手。像日常聊天一样自然地回答用户的问题，语气友好、简洁。',
          '需要实时信息、外部资料或用户明确要求搜索时，调用 web_search 或 web_fetch 工具，然后用工具结果回答。',
          '除此之外不执行命令、不读写文件、不做其他操作，只通过文字回复。',
        ].join('\n'),
      },
    },
    {
      id: 'agent-instructions',
      name: '@deepseek-ai/dsh-agent-instructions',
      config: { maxBytes: 65536 },
    },
    {
      id: 'tool-web',
      name: '@deepseek-ai/dsh-tool-web',
      config: { fetch: true, searchTimeoutMs: 60000 },
    },
    { id: 'chat-no-tools', name: 'dsh-chat-modes/chat-no-tools' },
    compactionGroup(),
  ]
}

/**
 * 极限：系统提示词、runtime context、AGENTS.md、技能目录、工具全部清零。
 * @returns 该预设的插件行列表。
 */
function extremePlugins() {
  return [
    {
      id: 'persona',
      name: '@deepseek-ai/dsh-persona',
      // 空前缀 + complete：唯一的 system 段，且内容为空。
      config: { prefix: '', complete: true, includeRuntimeContext: false },
    },
    { id: 'extreme-chat-no-tools', name: 'dsh-chat-modes/extreme-chat-no-tools' },
    compactionGroup(),
  ]
}

/**
 * 无上下文：在极限基础上，每轮把历史从模型可见 surface 上遮蔽掉。
 * @returns 该预设的插件行列表。
 */
function statelessPlugins() {
  return [
    {
      id: 'persona',
      name: '@deepseek-ai/dsh-persona',
      config: { prefix: '', complete: true, includeRuntimeContext: false },
    },
    { id: 'stateless-chat', name: 'dsh-chat-modes/stateless-chat' },
  ]
}

const BUILDERS = {
  chat: chatPlugins,
  extremeChat: extremePlugins,
  statelessChat: statelessPlugins,
}

/**
 * 归一化开关值：只有字面量 `true` 才算开启，缺省按默认值。
 * @param config - 本行配置，可能是 undefined 或含脏值。
 * @returns 三个 key 的布尔值。
 */
export function readSwitches(config) {
  const source = config !== null && typeof config === 'object' ? config : {}
  const state = {}
  for (const [key, fallback] of Object.entries(DEFAULT_SWITCHES)) {
    state[key] = typeof source[key] === 'boolean' ? source[key] : fallback
  }
  return state
}

/**
 * 注册当前启用的模式。
 * @param ctx - Host 行 context。
 * @param switches - 归一化后的开关。
 * @returns 已注册预设的注销函数列表。
 */
async function registerEnabled(ctx, switches) {
  const disposers = []
  for (const mode of MODES) {
    if (switches[mode.key] !== true) continue
    try {
      const dispose = await ctx.agentPresets.register({
        id: mode.id,
        name: mode.name,
        order: mode.order,
        plugins: BUILDERS[mode.key](),
      })
      disposers.push(dispose)
    } catch (error) {
      // 单个模式注册失败（例如同名预设已被别的插件占用）不应该拖垮另外两个。
      ctx.logger.error(`chat-modes: 注册预设 "${mode.id}" 失败: %o`, error)
    }
  }
  return disposers
}

/**
 * Host 入口。
 * @param ctx - 本行的 context。
 * @param config - 本行配置（三个开关）。
 */
export function apply(ctx, config) {
  const switches = readSwitches(config)
  const disposers = []

  ctx.effect(() => {
    const ready = registerEnabled(ctx, switches).then((list) => {
      disposers.push(...list)
    })
    return async () => {
      await ready
      for (const dispose of disposers.reverse()) {
        try {
          await dispose()
        } catch (error) {
          ctx.logger.warn('chat-modes: 注销预设失败: %o', error)
        }
      }
      disposers.length = 0
    }
  }, 'chat-modes: presets')

  installSwitchRoutes(ctx, switches)
}

/**
 * 注册设置页用的两条路由。
 *
 * 用 `connection.fetch.register` 而不是 `webServer.register`：前者已经内置
 * Host/Origin 与浏览器凭据校验，回调拿到的是标准 `Request`/`Response`。
 */
function installSwitchRoutes(ctx, switches) {
  ctx.inject(['connection', 'configEditor'], (scope) => {
    const { connection, configEditor } = scope
    const json = (body, status = 200) =>
      Response.json(body, { status, headers: { 'cache-control': 'no-store' } })

    scope.effect(
      () =>
        connection.fetch.register({
          path: '/api/chat-modes',
          methods: ['GET'],
          requestBody: 'buffered',
          fetch: async () => json({ ok: true, value: readSwitches(switches) }),
        }),
      'chat-modes: GET /api/chat-modes',
    )

    scope.effect(
      () =>
        connection.fetch.register({
          path: '/api/chat-modes',
          methods: ['POST'],
          requestBody: 'buffered',
          fetch: async (request) => {
            let body
            try {
              body = await request.json()
            } catch {
              return json({ ok: false, error: 'body must be JSON' }, 400)
            }

            const key = body?.key
            const enabled = body?.enabled
            if (typeof key !== 'string' || !(key in DEFAULT_SWITCHES)) {
              return json({ ok: false, error: `unknown switch "${String(key)}"` }, 400)
            }
            if (typeof enabled !== 'boolean') {
              return json({ ok: false, error: '"enabled" must be a boolean' }, 400)
            }

            const entry = scope.fiber.entry
            if (entry === undefined) {
              return json({ ok: false, error: 'this row owns no configuration entry' }, 500)
            }

            try {
              // 写本行完整配置：摊开当前值再改这一个 key，避免丢掉另外两个。
              await configEditor.edit(entry, (current) => ({
                ...readSwitches(current),
                [key]: enabled,
              }))
            } catch (error) {
              return json({ ok: false, error: String(error?.message ?? error) }, 500)
            }

            // 编辑会重启本插件，这份闭包里的 `switches` 可能已过期；
            // 返回用户期望的结果即可，下次 GET 会读到新注册的实例。
            return json({ ok: true, value: { ...readSwitches(switches), [key]: enabled } })
          },
        }),
      'chat-modes: POST /api/chat-modes',
    )
  })
}
