/**
 * 导出服务（宿主原语路线 C3）
 *
 * renderCustomBlocks(markdown, target) 渲染 mermaid/katex/markmap
 * 代码块为可嵌入导出产物的资源，返回 `{ "__{lang}_{index}__": payload }`
 * 映射（与宿主 convert.rs 的占位符约定一致，三类块按文档顺序统一编号）：
 * - target === 'docx'：mermaid/markmap → PNG base64（无 data: 前缀，宿主
 *   Pic::new 直接嵌入）；katex 不渲染 PNG —— 宿主 math.rs 的 LaTeX→OMML
 *   是 Word 原生可编辑公式的主路径，OMML 失败时宿主自动回退源码。
 * - target === 'html'：mermaid/markmap → SVG 片段、katex → HTML 片段，
 *   宿主 export_html 将对应代码块替换为内嵌渲染产物（离线可用）。
 *
 * 挂载点：main.tsx 经 `window.__snExportBridge` 暴露给导出插件（薄壳），
 * 渲染库（mermaid/katex/markmap-*）复用宿主已加载的依赖，插件 bundle
 * 不再重复打包。
 */
import { renderMermaidDiagram } from './mermaid-render'
import { logger } from './logger'

/** 扫描前端渲染类代码块（与插件原实现同约定） */
const BLOCK_PATTERN = /```(mermaid|katex|markmap)\n([\s\S]*?)```/g

interface CustomBlock {
  lang: 'mermaid' | 'katex' | 'markmap'
  index: number
  source: string
}

/** 扫描 markdown 中的自定义渲染块，剥离 markmap-meta 注释 */
function scanCustomBlocks(markdown: string): CustomBlock[] {
  const blocks: CustomBlock[] = []
  let match: RegExpExecArray | null
  let idx = 0
  BLOCK_PATTERN.lastIndex = 0
  while ((match = BLOCK_PATTERN.exec(markdown)) !== null) {
    // markmap 源码可能携带编辑器持久化的 `<!-- markmap-meta:... -->` 头
    let source = match[2].replace(/<!--\s*markmap-meta:.*?-->\s*\n?/g, '')
    // 统一去除行尾空白（正则捕获的结尾 ``` 前换行由解析方处理）
    source = source.replace(/\s+$/, '')
    blocks.push({ lang: match[1] as CustomBlock['lang'], index: idx, source })
    idx++
  }
  return blocks
}

/** 将自包含 SVG 字符串栅格化为 PNG base64（无 data: 前缀）。
 *  用浏览器原生 Image+Canvas，无需 modern-screenshot 依赖。 */
async function svgToPngBase64(svg: string, scale = 2): Promise<string | null> {
  // 尺寸：优先 width/height 属性，缺失时从 viewBox 推断
  let width = 0
  let height = 0
  const wAttr = /<svg[^>]*\bwidth="([\d.]+)"/.exec(svg)
  const hAttr = /<svg[^>]*\bheight="([\d.]+)"/.exec(svg)
  const viewBox = /<svg[^>]*\bviewBox="([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)"/.exec(svg)
  if (wAttr && hAttr) {
    width = parseFloat(wAttr[1])
    height = parseFloat(hAttr[1])
  } else if (viewBox) {
    width = parseFloat(viewBox[3])
    height = parseFloat(viewBox[4])
  }
  if (!(width > 0 && height > 0)) {
    logger.warn('export', 'svg 尺寸解析失败，跳过 PNG 栅格化')
    return null
  }

  return new Promise((resolve) => {
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(width * scale)
        canvas.height = Math.round(height * scale)
        const ctx = canvas.getContext('2d')
        if (!ctx) return resolve(null)
        // 白底，避免透明 PNG 在 Word 中显示为黑块
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        const dataUrl = canvas.toDataURL('image/png')
        resolve(dataUrl.slice('data:image/png;base64,'.length))
      } catch (e) {
        logger.warn('export', 'SVG 栅格化失败', e)
        resolve(null)
      } finally {
        URL.revokeObjectURL(url)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    img.src = url
  })
}

/** 渲染 markmap 为自包含 SVG 字符串（离屏节点，渲染后销毁） */
async function renderMarkmapSvg(source: string): Promise<string | null> {
  const [{ Transformer }, { Markmap }] = await Promise.all([
    import('markmap-lib'),
    import('markmap-view'),
  ])
  const transformer = new Transformer()
  const root = transformer.transform(source).root
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', '720')
  svg.setAttribute('height', '400')
  const mm = Markmap.create(svg)
  try {
    await mm.setData(root)
    await mm.fit()
    // 等待布局/字体稳定一帧再序列化
    await new Promise((r) => requestAnimationFrame(() => r(null)))
    return new XMLSerializer().serializeToString(svg)
  } finally {
    try { mm.destroy() } catch { /* 离屏节点随 GC 回收 */ }
  }
}

/**
 * 渲染 markdown 中的 mermaid/katex/markmap 代码块为导出资源。
 * 单块失败仅告警并跳过（宿主对缺失资源回退源码，不阻塞导出）。
 */
export async function renderCustomBlocks(
  markdown: string,
  target: 'docx' | 'html',
): Promise<Record<string, string>> {
  const blocks = scanCustomBlocks(markdown)
  if (blocks.length === 0) return {}

  const result: Record<string, string> = {}
  for (const block of blocks) {
    try {
      if (block.lang === 'mermaid') {
        // 复用宿主渲染管线（含 LRU 缓存与串行队列）
        const svg = await renderMermaidDiagram(block.source, 'loose')
        if (!svg) continue
        if (target === 'docx') {
          const png = await svgToPngBase64(svg)
          if (png) result[`__mermaid_${block.index}__`] = png
        } else {
          result[`__mermaid_${block.index}__`] = svg
        }
      } else if (block.lang === 'katex') {
        // html 目标输出 KaTeX HTML 片段；docx 目标不产 PNG，
        // 由宿主 LaTeX→OMML 主路径生成 Word 原生公式
        if (target === 'html') {
          const katex = (await import('katex')).default
          result[`__katex_${block.index}__`] = katex.renderToString(block.source, {
            displayMode: true,
            throwOnError: false,
          })
        }
      } else if (block.lang === 'markmap') {
        const svg = await renderMarkmapSvg(block.source)
        if (!svg) continue
        if (target === 'docx') {
          const png = await svgToPngBase64(svg)
          if (png) result[`__markmap_${block.index}__`] = png
        } else {
          result[`__markmap_${block.index}__`] = svg
        }
      }
    } catch (e) {
      logger.warn('export', `render ${block.lang} block ${block.index} failed`, e)
    }
  }
  return result
}
