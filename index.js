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
 * 2. 在承载 GUI 的 webServer 上注册一个读写端点，供设置页使用：
 *      GET  /chat-modes/switches  -> { chat, extremeChat, statelessChat }
 *      POST /chat-modes/switches  <- { key, enabled }
 *    写入走 `configEditor.edit()`，把值存进本插件这一行的配置里。
 *
 * ## 为什么路由在根路径而不是 /api 下
 *
 * `/api` 整个前缀归共享 RPC 通道与它的鉴权层所有：任何 `/api/*` 请求（包括
 * 根本不存在的路径）都会先被那层拦成 401，插件自己的 exact 路由拿不到请求，
 * 而且从外部无法区分「路由存在」与「路由不存在」。挂在根路径上则命中 webServer
 * 的 exact 表，未命中是 404——可验证。
 *
 * ## 为什么开关是普通配置字段
 *
 * `.volatile()` 字段能原地更新，但它是只读引用（没有 set 口），无法持久化。
 * 普通字段会被 configEditor 写进 profile 的 cordis.patch.yml，代价是编辑后
 * 插件重启一次。改开关本来就是一次性显式操作，这个代价可以接受。
 *
 * ## 为什么没有导出 Config
 *
 * 本包不依赖 schemastery（它是 harness 内部包，插件装进 profile 后不一定
 * 解析得到）。Cordis 的 `resolveConfig`（`cordis/lib/index.js:244`）在没有
 * `Config` 时直接原样返回配置，所以由 `readSwitches` 自己做归一化：只有
 * 字面量 `true` 才算开启，其余（缺失、脏值）一律按默认值。
 */
export const name = 'chat-modes'

export const inject = ['agentPresets']

/**
 * 设置页读写开关的路径。
 *
 * 刻意不放在 `/api` 下：那个前缀整体归共享 RPC 通道与它的鉴权层所有，请求先被
 * 那层拦走，插件自己的 exact 路由拿不到。挂在根路径上才能确保命中 webServer
 * 的 exact 表（未命中会是 404，与「路由不存在」可区分）。
 */
export const SWITCH_PATH = '/chat-modes/switches'

/** 开关默认值：装完三个模式都能用。 */
export const DEFAULT_SWITCHES = {
  chat: true,
  extremeChat: true,
  statelessChat: true,
}

/**
 * 三个模式的 identity、展示名与在预设列表里的位置。
 *
 * `description` 是新会话选择器里显示在模式名下方的那行简介：宿主的
 * `presetDisplayText()`（`dsh-client-ui-agent-preset/lib/client.js:1292`）直接读
 * 这个字段，缺了就整行不显示。它**不经过 i18n**——内置预设的文案才会走词典，
 * 所以这里只能给一种语言，按本插件其余面向用户的文案统一用中文。
 */
const MODES = [
  {
    key: 'chat',
    id: 'chat',
    name: 'Chat',
    description: '日常聊天：载入 AGENTS.md，只保留联网搜索，其余工具全部屏蔽。',
    order: 0,
  },
  {
    key: 'extremeChat',
    id: 'extreme-chat',
    name: 'Extreme Chat',
    description: '极限模式：零系统提示词、零工具、不加载 AGENTS.md 和技能目录，模型只看到你的输入和自己的输出。',
    order: 1,
  },
  {
    key: 'statelessChat',
    id: 'stateless-chat',
    name: 'Stateless Chat',
    description: '无上下文模式：每轮只把你的新输入发给模型，之前的对话不进入请求，界面仍保留完整记录。',
    order: 2,
  },
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
        description: mode.description,
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
 * 注册设置页用的读写端点。
 *
 * ## 为什么挂在 webServer 而不是 connection.fetch
 *
 * `connection.fetch.register` 注册的路由归共享 RPC 通道所有，由
 * `createSharedFetchHandler('/api')` 分发；它是否被挂到 GUI 那个监听器上取决于
 * 部署，实测从外部请求 `/api/*` 一律先被鉴权层拦成 401，无法区分「路由存在」
 * 与「路由不存在」。
 *
 * `webServer` 就是承载 GUI 的那个 HTTP 服务，挂在它上面的 exact 路由一定可达，
 * 且能与 SPA fallback 区分开（未命中的路径是 404）。
 *
 * ## 鉴权
 *
 * webServer 自己不做鉴权。这里不用 `connection.requestRejection()`：它要求浏览器
 * 凭据 cookie，命令行无法构造，也就无法在装好后自证可用。改用两条可独立验证的
 * 判据：
 *
 *   1. 来源必须是回环地址——本插件只服务本机页面；
 *   2. 若请求带了 `Origin`，必须与本次请求的 Host 同源——挡住别的网站发起的
 *      跨站请求。浏览器对 application/json 的跨站提交要先过预检，而预检不会
 *      带上允许的方法，所以这条实际上已经足够。
 *
 * 开关本身只是「哪个 UI 模式可见」，不含凭据或文件内容，这个强度是相称的。
 *
 * ## 持久化
 *
 * 写入走 `configEditor.edit()`，把值存进本插件这一行的配置里。这一步不需要
 * 导出 `Config`：Cordis 的 `resolveConfig` 在没有 `Config` 时原样返回配置，
 * 而 configEditor 只是把整份配置写回 profile 的 cordis.patch.yml。
 */
function installSwitchRoutes(ctx, switches) {
  ctx.inject(['webServer'], (scope) => {
    const webServer = scope.webServer
    if (typeof webServer?.register !== 'function') {
      ctx.logger.warn('chat-modes: webServer 不可用，设置页将无法读写开关')
      return
    }

    /** 回环地址判定：IPv4 回环、IPv6 回环，或 IPv4-mapped IPv6 回环。 */
    const isLoopback = (address) => {
      if (typeof address !== 'string' || address === '') return false
      const normalized = address.startsWith('::ffff:') ? address.slice(7) : address
      return normalized === '::1'
        || normalized === '127.0.0.1'
        || /^127\./.test(normalized)
    }

    /**
     * 判断这次请求能否处理。
     * @returns 拒绝的状态码，或 undefined 表示放行。
     */
    const rejectionOf = (req) => {
      if (!isLoopback(req.socket?.remoteAddress)) return 403

      const origin = req.headers.origin
      if (typeof origin === 'string' && origin !== 'null') {
        let host
        try {
          host = new URL(origin).host
        } catch {
          return 403
        }
        if (host !== req.headers.host) return 403
      }
      return undefined
    }

    /** 写回一个 JSON 响应。 */
    const sendJson = (res, body, status = 200) => {
      const text = JSON.stringify(body)
      res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(text),
        'cache-control': 'no-store',
      })
      res.end(text)
    }

    /** 读完请求体（上限很小，开关请求只有几十字节）。 */
    const readBody = (req) => new Promise((resolve, reject) => {
      const chunks = []
      let size = 0
      req.on('data', (chunk) => {
        size += chunk.length
        if (size > 8192) {
          reject(new Error('body too large'))
          req.destroy()
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      req.on('error', reject)
    })

    const handler = async (req, res) => {
      const rejection = rejectionOf(req)
      if (rejection !== undefined) {
        res.writeHead(rejection, { 'content-type': 'text/plain; charset=utf-8' })
        res.end(`rejected (${rejection})`)
        return
      }

      if (req.method === 'GET' || req.method === 'HEAD') {
        sendJson(res, { ok: true, value: readSwitches(switches) })
        return
      }
      if (req.method !== 'POST') {
        res.writeHead(405, { allow: 'GET, HEAD, POST' })
        res.end()
        return
      }

      let body
      try {
        body = JSON.parse(await readBody(req))
      } catch {
        sendJson(res, { ok: false, error: 'body must be JSON' }, 400)
        return
      }

      const key = body?.key
      const enabled = body?.enabled
      if (typeof key !== 'string' || !(key in DEFAULT_SWITCHES)) {
        sendJson(res, { ok: false, error: `unknown switch "${String(key)}"` }, 400)
        return
      }
      if (typeof enabled !== 'boolean') {
        sendJson(res, { ok: false, error: '"enabled" must be a boolean' }, 400)
        return
      }

      const configEditor = scope.get('configEditor')
      const entry = scope.fiber.entry
      if (configEditor === undefined || entry === undefined) {
        sendJson(res, {
          ok: false,
          error: 'this profile cannot persist plugin configuration (configEditor unavailable)',
        }, 500)
        return
      }

      try {
        // 写本行完整配置：摊开当前值再改这一个 key，避免丢掉另外两个。
        await configEditor.edit(entry, (current) => ({
          ...readSwitches(current),
          [key]: enabled,
        }))
      } catch (error) {
        sendJson(res, { ok: false, error: String(error?.message ?? error) }, 500)
        return
      }

      // 编辑会重启本插件，这份闭包里的 `switches` 可能已过期；
      // 返回用户期望的结果即可，下次 GET 会读到新注册的实例。
      sendJson(res, { ok: true, value: { ...readSwitches(switches), [key]: enabled } })
    }

    scope.effect(
      () => webServer.register({ kind: 'exact', path: SWITCH_PATH, handler }),
      'chat-modes: switch endpoint',
    )
  })
}
