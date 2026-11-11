/**
 * 极限模式的清零子插件。
 *
 * 两件事：
 *
 * 1. 工具清空 —— `allow: []` 的语义是「允许的继承工具集合为空」，Host 现在
 *    或将来注册什么全局工具都不可见，不需要维护名单。
 *
 * 2. 遮蔽 `working-directory:current` —— 这是 runtime context 里唯一标了
 *    `required: true` 的一条，`includeRuntimeContext: false`
 *    （`systemPrompt.suppressRuntimeContext`）只压制可选槽位，压不掉它。
 *    在同一 agent 作用域注册同名条目即可：`ScopedLayers.merge` 让最近作用域
 *    的同名条目胜出，于是这条不再是 required，随抑制一起丢掉。
 */
export const name = 'extreme-chat-no-tools'

export const inject = ['tools', 'systemPrompt']

export function apply(ctx) {
  ctx.effect(
    () => ctx.tools.restrict({ allow: [] }),
    'extreme-chat-no-tools: restrict all tools',
  )

  ctx.effect(
    () => ctx.systemPrompt.context({
      name: 'working-directory:current',
      order: ctx.systemPrompt.getContextOrder('WORKING_DIRECTORY'),
      required: false,
      interpolate: false,
      text: '',
    }),
    'extreme-chat-no-tools: shadow required context',
  )
}
