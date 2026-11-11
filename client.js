/**
 * 三个聊天模式的设置页（Client 半）。
 *
 * 在「设置 → Agent presets」组的同一排里加一个独立页面，三行开关。
 * 开关状态通过 `/api/chat-modes/bundle` 读写，由 Host 侧持久化到插件自己的配置行。
 *
 * 只 `require('react')`：宿主 Client 模块表提供它，不 import 任何
 * Harness Client 包，避免与宿主版本耦合。
 */
window.__ModuleLoader__.load({
  id: 'dsh-chat-modes',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'dsh-chat-modes'
    const CLS = 'dcm'
    const ENDPOINT = '/chat-modes/switches'

    /** 三行开关的定义，顺序与 Host 侧 MODES 一致。 */
    const ROWS = [
      { key: 'chat', title: 'Chat', description: '带人设、AGENTS.md 和联网搜索的日常聊天。' },
      { key: 'extremeChat', title: 'Extreme Chat', description: '零系统提示词、零工具，模型只看得到你的输入和自己的输出。' },
      { key: 'statelessChat', title: 'Stateless Chat', description: '每轮只发送你的新输入，模型不记得之前说过什么；界面仍保留完整记录。' },
    ]

    const ZH = {
      'section.title': '聊天模式',
      'section.description': '选择哪些模式会出现在新会话的预设列表里。关闭的模式不会消失，随时可以重新打开；已经开始的会话不受影响。',
      'state.loading': '正在读取…',
      'state.error': '读取失败',
      'state.retry': '重试',
      'save.failed': '保存失败',
      'row.chat.title': 'Chat',
      'row.chat.description': '带人设、AGENTS.md 和联网搜索的日常聊天。',
      'row.extremeChat.title': 'Extreme Chat',
      'row.extremeChat.description': '零系统提示词、零工具，模型只看得到你的输入和自己的输出。',
      'row.statelessChat.title': 'Stateless Chat',
      'row.statelessChat.description': '每轮只发送你的新输入，模型不记得之前说过什么；界面仍保留完整记录。',
      'nav.label': '聊天模式',
    }

    const EN = {
      'section.title': 'Chat modes',
      'section.description': 'Choose which modes appear in the new-session preset list. A disabled mode is not deleted — turn it back on anytime. Running sessions are unaffected.',
      'state.loading': 'Loading…',
      'state.error': 'Could not load',
      'state.retry': 'Retry',
      'save.failed': 'Could not save',
      'row.chat.title': 'Chat',
      'row.chat.description': 'Everyday chat with a persona, AGENTS.md, and web search.',
      'row.extremeChat.title': 'Extreme Chat',
      'row.extremeChat.description': 'No system prompt, no tools — the model sees only your input and its own replies.',
      'row.statelessChat.title': 'Stateless Chat',
      'row.statelessChat.description': 'Sends only your latest message; the model remembers nothing. The transcript still keeps every turn.',
      'nav.label': 'Chat modes',
    }

    const CSS = [
      '.' + CLS + '_page{display:flex;flex-direction:column;gap:16px;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary)}',
      '.' + CLS + '_intro{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}',
      '.' + CLS + '_list{display:flex;flex-direction:column}',
      '.' + CLS + '_row{display:flex;align-items:flex-start;gap:16px;padding:16px 0;border-top:1px solid var(--dsw-alias-border-l2)}',
      '.' + CLS + '_row:first-child{border-top:none}',
      '.' + CLS + '_text{flex:1;min-width:0}',
      '.' + CLS + '_title{font-weight:600}',
      '.' + CLS + '_desc{margin-top:2px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}',
      '.' + CLS + '_switch{flex:none;position:relative;width:40px;height:22px;border-radius:999px;border:none;padding:0;cursor:pointer;background:var(--dsw-alias-border-l3,var(--dsw-alias-border-l2));transition:background .16s ease}',
      '.' + CLS + '_switch[aria-checked="true"]{background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary))}',
      '.' + CLS + '_switch:disabled{opacity:.5;cursor:default}',
      '.' + CLS + '_switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
      '.' + CLS + '_knob{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .16s ease}',
      '.' + CLS + '_switch[aria-checked="true"] .' + CLS + '_knob{transform:translateX(18px)}',
      '.' + CLS + '_status{color:var(--dsw-alias-label-secondary);font-size:13px}',
      '.' + CLS + '_error{color:var(--dsw-alias-state-error-primary);font-size:13px}',
      '.' + CLS + '_retry{margin-left:8px;color:var(--dsw-alias-brand-primary);background:none;border:none;padding:0;font:inherit;cursor:pointer;text-decoration:underline}',
    ].join('')

    /** 一个开关行。 */
    function Row(props) {
      const { row, checked, busy, failed, onChange, t } = props
      return h('div', { className: CLS + '_row' }, [
        h('div', { key: 'text', className: CLS + '_text' }, [
          h('div', { key: 'title', className: CLS + '_title' }, t('row.' + row.key + '.title')),
          h('div', { key: 'desc', className: CLS + '_desc' }, t('row.' + row.key + '.description')),
          failed
            ? h('div', { key: 'err', className: CLS + '_error', role: 'alert' }, t('save.failed'))
            : null,
        ]),
        h('button', {
          key: 'switch',
          type: 'button',
          role: 'switch',
          className: CLS + '_switch',
          'aria-checked': checked ? 'true' : 'false',
          'aria-label': t('row.' + row.key + '.title'),
          disabled: busy,
          onClick: () => onChange(row.key, !checked),
        }, h('span', { className: CLS + '_knob' })),
      ])
    }

    /** 设置页主体。 */
    function ChatModesSection(props) {
      const t = props.t
      const [state, setState] = React.useState({ phase: 'loading', value: null })
      const [busyKey, setBusyKey] = React.useState(null)
      const [failedKey, setFailedKey] = React.useState(null)

      const load = React.useCallback(() => {
        setState({ phase: 'loading', value: null })
        fetch(ENDPOINT, { cache: 'no-store', credentials: 'same-origin' })
          .then((response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            return response.json()
          })
          .then((body) => {
            if (body && body.ok === true && body.value) {
              setState({ phase: 'ready', value: body.value })
            } else {
              setState({ phase: 'error', value: null, detail: 'unexpected payload' })
            }
          })
          .catch((error) => setState({ phase: 'error', value: null, detail: String(error && error.message ? error.message : error) }))
      }, [])

      React.useEffect(() => {
        load()
      }, [load])

      const toggle = React.useCallback((key, enabled) => {
        setFailedKey(null)
        setBusyKey(key)
        // 乐观更新：先翻 UI，失败再翻回来。
        setState((current) => current.phase === 'ready'
          ? { phase: 'ready', value: { ...current.value, [key]: enabled } }
          : current)
        fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ key, enabled }),
        })
          .then((response) => response.json())
          .then((body) => {
            if (!body || body.ok !== true) throw new Error('rejected')
            setState({ phase: 'ready', value: body.value })
          })
          .catch(() => {
            setFailedKey(key)
            // 回滚到服务端的真实值。
            load()
          })
          .finally(() => setBusyKey(null))
      }, [load])

      if (state.phase === 'loading') {
        return h('div', { className: CLS + '_page' }, h('div', { className: CLS + '_status' }, t('state.loading')))
      }
      if (state.phase === 'error') {
        return h('div', { className: CLS + '_page' }, [
          h('div', { key: 'err', className: CLS + '_error' }, t('state.error')),
          // 把真实原因露出来，否则只能看到一句「读取失败」，没法判断是路由没注册、
          // 鉴权被拒还是载荷不对。
          state.detail
            ? h('div', { key: 'detail', className: CLS + '_status' }, state.detail)
            : null,
          h('button', { key: 'retry', type: 'button', className: CLS + '_retry', onClick: load }, t('state.retry')),
        ])
      }

      const value = state.value
      return h('div', { className: CLS + '_page' }, [
        h('div', { key: 'intro', className: CLS + '_intro' }, t('section.description')),
        h('div', { key: 'list', className: CLS + '_list' },
          ROWS.map((row) => h(Row, {
            key: row.key,
            row,
            t,
            checked: value[row.key] === true,
            busy: busyKey === row.key,
            failed: failedKey === row.key,
            onChange: toggle,
          }))),
      ])
    }

    /** 插槽渲染入口：注入的 t 优先，回退到 apply 绑定的。 */
    function render(ownerProps) {
      const t = ownerProps && typeof ownerProps.t === 'function' ? ownerProps.t : render.fallbackT
      return h(ChatModesSection, { t })
    }

    const plugin = {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), NS + ': dictionaries')
        const t = ctx.locale.bind(NS)
        render.fallbackT = t

        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'chat-modes',
          order: 21,
          locale: NS,
          label: () => t('nav.label'),
          inject: () => ({ t }),
        }, render))
      },
    }

    return plugin
  },
})
