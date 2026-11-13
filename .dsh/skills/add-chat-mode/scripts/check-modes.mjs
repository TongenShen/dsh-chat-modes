#!/usr/bin/env node
/**
 * 校验 add-chat-mode 要求的五处真值是否对齐。
 *
 * 用法：在仓库根目录跑 `node .dsh/skills/add-chat-mode/scripts/check-modes.mjs`
 * 退出码 0 = 对齐，1 = 有缺口并列出具体位置。
 *
 * `node --check` 只能查语法，查不出「DEFAULT_SWITCHES 加了 key 但 ROWS 没加」
 * 这类跨文件不同步，所以需要这段。
 */
import { readFileSync } from 'node:fs'

const root = process.cwd()
const indexUrl = new URL('index.js', `file://${root}/`).href

let module
try {
  module = await import(indexUrl)
} catch (error) {
  console.error('无法导入 index.js：', error.message)
  process.exit(1)
}

const switches = module.DEFAULT_SWITCHES
if (switches === null || typeof switches !== 'object') {
  console.error('index.js 没有导出 DEFAULT_SWITCHES')
  process.exit(1)
}

const host = readFileSync(`${root}/index.js`, 'utf8')
const client = readFileSync(`${root}/client.js`, 'utf8')

const problems = []

// 先把两段块取出来：DEFAULT_SWITCHES 里也有 `codeChat: true` 这样的行，
// 若直接在全文件上匹配 `key:` 会把开关表误判成 BUILDERS 已挂。
const buildersBlock = host.match(/const BUILDERS = \{([\s\S]*?)\n\}/)?.[1]
if (buildersBlock === undefined) {
  problems.push('index.js 里找不到 `const BUILDERS = {` 块')
}

for (const key of Object.keys(switches)) {
  // 第 1 处已有：DEFAULT_SWITCHES 本身。

  // 第 2 处：MODES 里的 key。
  if (!new RegExp(`key:\\s*'${key}'`).test(host)) {
    problems.push(`index.js 的 MODES 缺 key: ${key}`)
  }

  // 第 3 处：BUILDERS 里的 key。
  if (buildersBlock !== undefined && !new RegExp(`\\b${key}\\s*:`).test(buildersBlock)) {
    problems.push(`index.js 的 BUILDERS 缺 key: ${key}`)
  }

  // 第 4 处：client.js 的 ROWS。
  if (!client.includes(`'${key}'`)) {
    problems.push(`client.js 的 ROWS 缺 key: ${key}`)
  }

  // 第 5 处：词典的两行。
  if (!client.includes(`'row.${key}.title'`)) {
    problems.push(`client.js 词典缺 row.${key}.title`)
  }
  if (!client.includes(`'row.${key}.description'`)) {
    problems.push(`client.js 词典缺 row.${key}.description`)
  }
}

// 反向检查：ROWS 里有、DEFAULT_SWITCHES 里没有（多余的开关行）。
// 只解析 ROWS 数组那一段——client.js 里还有 React 元素的 key: 'text' 之类，全文件扫会误报。
const rowsBlock = client.match(/const ROWS = \[([\s\S]*?)\n    \]/)?.[1]
if (rowsBlock === undefined) {
  problems.push('client.js 里找不到 `const ROWS = [` 数组')
} else {
  const rowKeys = [...rowsBlock.matchAll(/key:\s*'([A-Za-z0-9_]+)'/g)].map((m) => m[1])
  for (const key of new Set(rowKeys)) {
    if (!(key in switches)) {
      problems.push(`client.js 的 ROWS 有 ${key}，但 index.js 的 DEFAULT_SWITCHES 没有`)
    }
  }
}

if (problems.length > 0) {
  console.error('FAIL')
  for (const problem of problems) console.error('  -', problem)
  process.exit(1)
}

console.log('ok:', Object.keys(switches).join(', '))
