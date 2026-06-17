/* eslint-disable @typescript-eslint/no-explicit-any */
declare module 'simple-mind-map' {
  interface MindMapOptions {
    el: HTMLElement
    data?: any
    readonly?: boolean
    layout?: string
    theme?: string
    fit?: boolean
    [key: string]: any
  }

  class MindMap {
    constructor(opt: MindMapOptions)
    setData(data: any): void
    getData(withConfig?: boolean): any
    setTheme(theme: string): void
    setLayout(layout: string): void
    render(): void
    destroy(): void
    resize(): void
    on(event: string, callback: (...args: any[]) => void): void
    off(event: string, callback: (...args: any[]) => void): void
    emit(event: string, ...args: any[]): void
    view: any
    renderer: any
    command: any
    svg?: SVGSVGElement
    opt?: any
    drawWatermark?: () => void

    static usePlugin(plugin: any, opt?: any): typeof MindMap
    static hasPlugin(plugin: any): number
    static defineTheme(name: string, config: any): void
    static pluginList: any[]
  }

  export default MindMap
}

// Pre-bundled ESM dist file (already includes all plugins)
declare module 'simple-mind-map/dist/simpleMindMap.esm.js' {
  export { default } from 'simple-mind-map'
}

declare module 'simple-mind-map/dist/simpleMindMap.esm.min.js' {
  export { default } from 'simple-mind-map'
}
