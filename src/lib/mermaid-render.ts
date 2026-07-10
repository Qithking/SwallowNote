/** mermaid 实例与渲染结果 LRU 缓存的共享模块 */
type MermaidApi = typeof import('mermaid')['default']

// 按 securityLevel 缓存独立的 mermaid 实例，避免不同安全策略互相污染
const mermaidInstances = new Map<string, MermaidApi>()
// 渲染结果 LRU 缓存：key = `${securityLevel}\0${source}`，value = svg 字符串
const svgCache = new Map<string, string>()
const SVG_CACHE_MAX = 50

// 渲染队列：mermaid 对同一实例的并发渲染不安全，串行化执行
let renderQueue = Promise.resolve()

// 离屏渲染 host 样式：保留 800x600 尺寸以便 mermaid 正确测量图表大小
const MERMAID_RENDER_HOST_STYLE = [
  'position:absolute',
  'left:-10000px',
  'top:-10000px',
  'width:800px',
  'height:600px',
  'overflow:visible',
].join(';')

let renderIdCounter = 0
function nextRenderId(): string {
  // mermaid 要求 id 仅含安全字符，递增计数器保证全局唯一
  renderIdCounter = (renderIdCounter + 1) & 0x7fffffff
  return `swallownote-mermaid-${renderIdCounter}`
}

/** 按 securityLevel 返回（必要时创建并初始化）mermaid 实例 */
async function getMermaidInstance(securityLevel: string): Promise<MermaidApi> {
  const cached = mermaidInstances.get(securityLevel)
  if (cached) return cached

  const mermaid = (await import('mermaid')).default
  const fontFamily = 'ui-sans-serif, system-ui, sans-serif'
  if (securityLevel === 'loose') {
    // loose 模式保留 HTML 标签用于控制图表大小；渲染后由调用方 DOMPurify 净化危险内容
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'loose',
      theme: 'default',
      suppressErrorRendering: false,
      themeVariables: { fontFamily },
      gantt: {
        titleTopMargin: 15,
        barHeight: 20,
        barGap: 4,
        topPadding: 50,
        rightPadding: 75,
        leftPadding: 75,
        fontSize: 11,
      },
    })
  } else {
    // strict 默认：禁用 HTML 标签，抑制错误渲染
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      htmlLabels: false,
      theme: 'default',
      suppressErrorRendering: true,
      themeVariables: { fontFamily },
    })
  }
  mermaidInstances.set(securityLevel, mermaid)
  return mermaid
}

function appendMermaidRenderHost(): HTMLDivElement {
  const host = document.createElement('div')
  host.setAttribute('data-swallownote-mermaid-render-host', '')
  host.style.cssText = MERMAID_RENDER_HOST_STYLE
  document.body.appendChild(host)
  return host
}

function removeMermaidRenderArtifacts(renderId: string, host: HTMLElement): void {
  host.remove()
  document.getElementById(renderId)?.remove()
  document.getElementById(`d${renderId}`)?.remove()
  document.getElementById(`i${renderId}`)?.remove()
}

/** 初始化指定 securityLevel 的 mermaid 实例（幂等） */
export async function initializeMermaid(securityLevel = 'strict'): Promise<void> {
  await getMermaidInstance(securityLevel)
}

/** 渲染 mermaid 为 SVG，集成 LRU 缓存（上限 50） */
export function renderMermaidDiagram(
  source: string,
  securityLevel = 'strict',
): Promise<string> {
  const cacheKey = `${securityLevel}\0${source}`
  const hit = svgCache.get(cacheKey)
  if (hit !== undefined) {
    // LRU：命中时移到末尾（最近使用），避免频繁条目被过早淘汰
    svgCache.delete(cacheKey)
    svgCache.set(cacheKey, hit)
    return Promise.resolve(hit)
  }

  const render = async () => {
    const mermaid = await getMermaidInstance(securityLevel)
    const renderId = nextRenderId()
    const renderHost = appendMermaidRenderHost()
    try {
      const result = await mermaid.render(renderId, source, renderHost)
      return result.svg
    } finally {
      removeMermaidRenderArtifacts(renderId, renderHost)
    }
  }

  // 渲染失败时：队列续链（用 .then(() => undefined, () => undefined) 保证链不断裂），
  // 但对外抛出错误（不用 catch 吞错），让调用方的 .catch 能正确触发
  const nextRender = renderQueue.then(render, render)
  renderQueue = nextRender.then(() => undefined, () => undefined)

  // 缓存写入仅在成功时执行（nextRender resolve 时）；
  // 失败时仅记录一次日志（避免与下方 catch 重复打印）
  nextRender.then((svg) => {
    if (!svg) return
    svgCache.set(cacheKey, svg)
    if (svgCache.size > SVG_CACHE_MAX) {
      const oldest = svgCache.keys().next().value
      if (oldest !== undefined) svgCache.delete(oldest)
    }
  }).catch((e) => {
    console.warn('[mermaid-render] Render failed:', e)
  })

  return nextRender
}
