/**
 * 无上下文模式：每轮把输入发给模型之前，先让模型看不到之前的历史。
 *
 * ## 为什么用 surface 遮蔽
 *
 * 模型看到的历史来自 `session.deriveMessages()`，它只读取 surface 上未被
 * shadow 的节点（`dsh-session/lib/index.js:1681`）。界面读的是原始事件日志
 * `snapshotEvents()`（`dsh-session/lib/index.js:1454`），完全不看 surface。
 * 所以只要在 surface 上做遮蔽，模型就看不到历史，而界面一条对话都不会少。
 *
 * 这正是 `compaction-basic` 遮蔽旧轮次的官方做法：追加一个带
 * `surfaceOp: { op: 'replace', startSeq, endSeq }` 的节点，把一段连续的
 * surface 节点整体替换成它自己。
 *
 * ## 为什么替换成空 system 消息
 *
 * `deriveEventMessage()` 对 `system/message` 有特判：`content.length === 0`
 * 时返回 `null`，不产生任何 wire message
 * （`dsh-session/lib/types/surface.js:91-97`）。所以替换成空 system 节点，
 * 等于"占住 surface 位置，但不给模型任何东西"。
 *
 * ## 为什么边界按 turn/start 切
 *
 * `agent/pre-step` 触发时，本轮用户输入**还没有**进入 surface
 * （`agent-loop.js:670` 的 claim 只发事件，append 发生在 `:860`）。
 * 因此不能用"最后一条用户消息"判定当前轮，而要用最后一个 `turn/start`：
 * 它之后新增的 surface 节点属于当前轮，之前的全部遮蔽。
 */
export const name = 'stateless-chat'

export const inject = ['tools', 'systemPrompt']

/** 唯一标了 required 的 runtime context，suppressRuntimeContext 压不掉。 */
const REQUIRED_CONTEXT_NAME = 'working-directory:current'

/**
 * 最后一个 `turn/start` 的 seq；没有则为 -1。
 * @param session - 目标会话。
 */
function lastTurnStartSeq(session) {
  const log = session.snapshotEvents()
  for (let index = log.length - 1; index >= 0; index -= 1) {
    if (log[index]?.type === 'turn/start') return log[index].seq
  }
  return -1
}

/**
 * 造一个空 content 的 system 消息。
 *
 * 字段必须满足 `assertMessageEventShape`：非空 id、role 为 system、
 * source.kind 为 system-prompt、content 是数组。content 为空数组是关键——
 * 它让这条消息被 `deriveEventMessage` 丢掉。
 */
function emptySystemMessage() {
  return {
    id: globalThis.crypto.randomUUID(),
    role: 'system',
    content: [],
    source: { kind: 'system-prompt' },
  }
}

/**
 * 把当前轮之前的全部 surface 替换成一个空 system 节点。
 * @param session - 目标会话。
 * @returns 是否真的做了遮蔽。
 */
function shadowHistory(session) {
  const nodes = session.surface.nodes
  if (nodes.length === 0) return false

  const boundary = lastTurnStartSeq(session)
  const keepFrom = nodes.findIndex((seq) => seq > boundary)
  // 整段都属于当前轮：没有历史可遮蔽。
  if (keepFrom === 0) return false

  const endIndex = keepFrom === -1 ? nodes.length - 1 : keepFrom - 1
  const startSeq = nodes[0]
  const endSeq = nodes[endIndex]
  if (startSeq === undefined || endSeq === undefined) return false

  session.append(
    'system/message',
    { message: emptySystemMessage() },
    {
      surfaceOp: { op: 'replace', startSeq, endSeq },
      // 必须覆盖被遮蔽区间里的每一个 surface 节点，否则追加会抛错。
      sourceEventSeqs: nodes.slice(0, endIndex + 1),
    },
  )
  return true
}

export function apply(ctx) {
  // 工具全部屏蔽：允许的继承工具集合为空。
  ctx.effect(
    () => ctx.tools.restrict({ allow: [] }),
    'stateless-chat: restrict all tools',
  )

  // 遮蔽唯一 required 的 runtime context（工作目录）。
  ctx.effect(
    () => ctx.systemPrompt.context({
      name: REQUIRED_CONTEXT_NAME,
      order: ctx.systemPrompt.getContextOrder('WORKING_DIRECTORY'),
      required: false,
      interpolate: false,
      text: '',
    }),
    'stateless-chat: shadow required context',
  )

  // 每轮发请求之前遮蔽历史。
  ctx.on('agent/pre-step', async (payload, next) => {
    payload.signal?.throwIfAborted?.()
    try {
      shadowHistory(payload.agent.session)
    } catch (error) {
      // 遮蔽失败不该让整轮对话失败：最坏情况是这一轮多带上一些历史。
      ctx.logger.warn('stateless-chat: 遮蔽历史失败: %o', error)
    }
    return next()
  })
}
