/**
 * Chat 模式下屏蔽 Host 全局工具的子插件。
 *
 * 这个人设需要联网搜索，所以用 `deny` 名单而不是 `allow: []`。名单只能写
 * Host 真正注册在 global 层的工具名；写不存在的名字会让 `restrict()` 抛
 * unknown tool，整个预设加载失败。
 */
export const name = 'chat-no-tools'

export const inject = ['tools']

const HOST_GLOBAL_TOOLS_TO_HIDE = ['working_directory']

export function apply(ctx) {
  ctx.effect(
    () => ctx.tools.restrict({ deny: HOST_GLOBAL_TOOLS_TO_HIDE }),
    'chat-no-tools: restrict host tools',
  )
}
