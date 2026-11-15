/**
 * 右面板开合过渡期间的编辑区锁宽协调。
 *
 * 背景：窗口 resize（OS 侧）与 DOM 渲染跨进程无法原子同步——打开面板时若
 * 不处理，窗口加宽后 webview 重排会让编辑区（flex:1）瞬时变宽、面板渲染后
 * 又缩回，形成「闪动」跳帧。
 *
 * 协议：setRightPanelType 在窗口 resize 之前**同步**派发 start 事件，监听方
 * 把编辑区锁定为当前像素宽度（显式 width + flex:none）——此后 webview 重排
 * 编辑区纹丝不动（右侧仅多出空白）；面板渲染/卸载完成后派发 end 事件解锁，
 * 恢复 flex 布局（宽度数值不变）。编辑区全程零跳动。
 */
export const RIGHT_PANEL_TRANSITION_START = 'right-panel-transition-start'
export const RIGHT_PANEL_TRANSITION_END = 'right-panel-transition-end'

/**
 * 在指定元素上挂载锁宽/解锁监听，返回清理函数（App 生命周期内常驻，
 * 卸载时移除监听并解锁）。
 */
export function attachEditorWidthLock(el: HTMLElement): () => void {
  const lock = () => {
    // 防重入：快速连续开合时第二次 start 到达，锁已生效则跳过
    if (el.style.flex === 'none') return
    const width = el.getBoundingClientRect().width
    el.style.width = `${width}px`
    el.style.flex = 'none'
  }
  const unlock = () => {
    el.style.width = ''
    el.style.flex = ''
  }
  window.addEventListener(RIGHT_PANEL_TRANSITION_START, lock)
  window.addEventListener(RIGHT_PANEL_TRANSITION_END, unlock)
  return () => {
    window.removeEventListener(RIGHT_PANEL_TRANSITION_START, lock)
    window.removeEventListener(RIGHT_PANEL_TRANSITION_END, unlock)
    unlock()
  }
}
