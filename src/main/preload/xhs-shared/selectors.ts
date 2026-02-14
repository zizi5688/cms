/**
 * selectors.ts — XHS 页面选择器集中管理
 *
 * 所有与小红书页面 DOM 结构相关的选择器集中在此文件，
 * 当小红书前端改版时，只需修改此处即可。
 *
 * 使用方式：
 *   import { resolve, SELECTORS } from './xhs-shared/selectors'
 *   const el = resolve('publish.titleInput')
 */

import { isVisible, normalizeText, queryFirstVisible } from './dom-helpers'

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

export type SelectorCandidate =
  | { type: 'css'; value: string }
  | { type: 'text'; value: string; match: 'exact' | 'contains' }
  | { type: 'placeholder'; tag: string; text: string }
  | { type: 'attr'; tag: string; attr: string; pattern: string }

export type SelectorEntry = {
  label: string
  candidates: SelectorCandidate[]
}

// ---------------------------------------------------------------------------
// 选择器注册表
// ---------------------------------------------------------------------------

export const SELECTORS: Record<string, SelectorEntry> = {
  // ---- 发布页 ----
  'publish.titleInput': {
    label: '标题输入框',
    candidates: [
      { type: 'placeholder', tag: 'input', text: '填写标题' },
      { type: 'placeholder', tag: 'input', text: '标题' },
      { type: 'placeholder', tag: 'textarea', text: '标题' },
      { type: 'attr', tag: 'input', attr: 'aria-label', pattern: '标题' },
      { type: 'attr', tag: 'textarea', attr: 'aria-label', pattern: '标题' },
      { type: 'css', value: 'div.title-input input' },
      { type: 'css', value: 'div.title-input textarea' },
      { type: 'css', value: 'div.title-input [contenteditable="true"]' },
      { type: 'css', value: 'div.title-input' }
    ]
  },

  'publish.contentEditor': {
    label: '正文输入框',
    candidates: [
      { type: 'placeholder', tag: 'textarea', text: '正文' },
      { type: 'placeholder', tag: 'textarea', text: '内容' },
      { type: 'attr', tag: 'textarea', attr: 'aria-label', pattern: '正文' },
      { type: 'attr', tag: 'textarea', attr: 'aria-label', pattern: '内容' },
      { type: 'css', value: '[contenteditable="true"]' }
    ]
  },

  'publish.imageFileInput': {
    label: '图片上传 input',
    candidates: [
      { type: 'css', value: 'input[type="file"][accept*="image"]' },
      { type: 'css', value: 'input[type="file"][accept*=".jpg"]' },
      { type: 'css', value: 'input[type="file"][accept*=".png"]' }
    ]
  },

  'publish.videoFileInput': {
    label: '视频上传 input',
    candidates: [
      { type: 'css', value: 'input[type="file"][accept*="video"]' },
      { type: 'css', value: 'input[type="file"][accept*=".mp4"]' }
    ]
  },

  'publish.saveExitButton': {
    label: '暂存离开按钮',
    candidates: [
      { type: 'text', value: '暂存离开', match: 'contains' },
      { type: 'text', value: '暂存', match: 'contains' }
    ]
  },

  // ---- 草稿箱 ----
  'draft.openButton': {
    label: '草稿箱按钮',
    candidates: [
      { type: 'text', value: '草稿箱', match: 'contains' }
    ]
  },

  'draft.imageTab': {
    label: '图文笔记 Tab',
    candidates: [
      { type: 'text', value: '图文笔记', match: 'contains' }
    ]
  },

  'draft.editButton': {
    label: '编辑按钮',
    candidates: [
      { type: 'text', value: '编辑', match: 'exact' }
    ]
  },

  // ---- 商品弹窗 ----
  'product.addButton': {
    label: '添加商品按钮',
    candidates: [
      { type: 'text', value: '添加商品', match: 'contains' }
    ]
  },

  'product.searchInput': {
    label: '商品搜索框',
    candidates: [
      { type: 'css', value: 'input[placeholder*="搜索"]' },
      { type: 'css', value: 'input[placeholder*="商品"]' }
    ]
  },

  'product.idElement': {
    label: '商品ID元素',
    candidates: [
      { type: 'text', value: '商品ID:', match: 'contains' },
      { type: 'text', value: '商品ID：', match: 'contains' }
    ]
  },

  // ---- 商城爬取（预留命名空间） ----
  // 'shop.productList': { ... }
  // 'shop.productCard': { ... }
  // 'shop.pagination': { ... }
}

// ---------------------------------------------------------------------------
// 查找引擎
// ---------------------------------------------------------------------------

function matchCandidate(
  candidate: SelectorCandidate,
  scope: ParentNode
): HTMLElement | null {
  try {
    switch (candidate.type) {
      case 'css': {
        const el = queryFirstVisible<HTMLElement>(candidate.value)
        return el && scope.contains(el) ? el : null
      }

      case 'text': {
        const nodes = Array.from(scope.querySelectorAll('div, span, button, a, label'))
          .filter((el): el is HTMLElement => isVisible(el))
        for (const el of nodes) {
          const text = normalizeText(el.innerText || el.textContent || '')
          if (!text) continue
          if (candidate.match === 'exact' && text === candidate.value) return el
          if (candidate.match === 'contains' && text.includes(candidate.value)) return el
        }
        return null
      }

      case 'placeholder': {
        const nodes = Array.from(scope.querySelectorAll(candidate.tag))
          .filter((el): el is HTMLElement => isVisible(el))
        for (const el of nodes) {
          const placeholder = el.getAttribute('placeholder') || ''
          if (placeholder.includes(candidate.text)) return el
        }
        return null
      }

      case 'attr': {
        const nodes = Array.from(scope.querySelectorAll(candidate.tag))
          .filter((el): el is HTMLElement => isVisible(el))
        for (const el of nodes) {
          const attrValue = el.getAttribute(candidate.attr) || ''
          if (attrValue.includes(candidate.pattern)) return el
        }
        return null
      }

      default:
        return null
    }
  } catch {
    return null
  }
}

/**
 * 按优先级尝试所有候选策略，返回第一个命中的元素
 */
export function resolve(
  id: string,
  scope?: ParentNode | null
): HTMLElement | null {
  const entry = SELECTORS[id]
  if (!entry) return null

  const root = scope || document.body

  for (const candidate of entry.candidates) {
    const el = matchCandidate(candidate, root)
    if (el) return el
  }

  return null
}

/**
 * 返回匹配信息（用于诊断日志）
 */
export function resolveWithInfo(
  id: string,
  scope?: ParentNode | null
): { element: HTMLElement | null; matchedStrategy: string | null; label: string } {
  const entry = SELECTORS[id]
  if (!entry) return { element: null, matchedStrategy: null, label: id }

  const root = scope || document.body

  for (let i = 0; i < entry.candidates.length; i++) {
    const candidate = entry.candidates[i]
    const el = matchCandidate(candidate, root)
    if (el) {
      const strategyDesc = `${candidate.type}:${
        'value' in candidate ? candidate.value :
        'text' in candidate ? candidate.text :
        'pattern' in candidate ? candidate.pattern : '?'
      }`
      return { element: el, matchedStrategy: strategyDesc, label: entry.label }
    }
  }

  return { element: null, matchedStrategy: null, label: entry.label }
}
