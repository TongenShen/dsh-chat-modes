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
 *
 * ## 为什么要保住 node 0
 *
 * surface 折叠对头节点有特殊保护（`dsh-session/lib/types/surface.js` 的
 * `assertSystemHeadRewrite`）：**node 0 是 `system/message` 时，只能被一条
 * `system/message` 替换，且必须恰好只覆盖 node 0 这一节点**。一条 replace
 * 跨多个节点覆盖 node 0 会直接抛错。
 *
 * 而 node 0 恰恰总是 system/message：`SystemPromptProjection.project()`
 * 在第一次请求时必定 append 一条 system 节点占住位置，persona 配了
 * `prefix: ''` 时它就是一条空 system。所以从第二轮起，任何"整段替换"
 * 都会被这条规则拒绝——append 抛错、日志不变，遮蔽等于没发生。
 *
 * 结果是模型看到全部历史，正是本插件要消灭的行为。
 *
 * 因此：node 0 永不参与遮蔽，只遮蔽它之后的区间。本预设的 persona 前缀为空，
 * 所以留在原地的 node 0 是一条空 system 消息，不产生任何 wire message
 * （`deriveEventMessage` 对空 content 返回 null），模型依然看不到系统提示词。
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
 * 算出这一轮该遮蔽的 surface 区间。
 *
 * 区间是 surface 节点数组上连续的一段 [first, endIndex]，两个约束独立决定两端：
 *
 *   1. **终点**由最后一个 `turn/start` 决定：边界及之后属于当前轮，不能遮蔽；
 *   2. **起点**由 node 0 的类型决定：node 0 是 `system/message` 时它受
 *      `assertSystemHeadRewrite` 保护，只能被"恰好只覆盖它自己"的
 *      `system/message` 替换，所以必须从 node 1 起。
 *
 * 起点是历史起点，终点是历史终点，不能互相代入。
 *
 * @param session - 目标会话。
 * @returns 遮蔽计划，或 undefined 表示本轮无需遮蔽。
 */
function shadowPlan(session) {
  const nodes = session.surface.nodes
  if (nodes.length === 0) return undefined

  // surface 节点里存的就是该事件的 seq，可直接当日志下标读回原事件。
  const headIsSystem = session.snapshotEvents()[nodes[0]]?.type === 'system/message'
  const first = headIsSystem ? 1 : 0

  const boundary = lastTurnStartSeq(session)
  const keepFrom = nodes.findIndex((seq) => seq > boundary)
  const endIndex = (keepFrom === -1 ? nodes.length : keepFrom) - 1
  if (first > endIndex) return undefined

  return {
    startSeq: nodes[first],
    endSeq: nodes[endIndex],
    // 必须覆盖被遮蔽区间里的每一个 surface 节点，否则追加会抛错。
    sourceEventSeqs: nodes.slice(first, endIndex + 1),
  }
}

/**
 * 把当前轮之前的全部 surface 替换成一个空 system 节点。
 * @param session - 目标会话。
 * @returns 是否真的做了遮蔽。
 */
function shadowHistory(session) {
  const plan = shadowPlan(session)
  if (plan === undefined) return false

  session.append(
    'system/message',
    { message: emptySystemMessage() },
    { surfaceOp: { op: 'replace', startSeq: plan.startSeq, endSeq: plan.endSeq }, sourceEventSeqs: plan.sourceEventSeqs },
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
