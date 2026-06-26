/**
 * 远程图片下载协调器（全局单例）。
 *
 * 设计目标：
 * 1. **多文件合并进度**：所有并发下载任务共享同一个 toast，按全局总进度更新文案。
 * 2. **即时替换 URL**：每下载成功 1 张图片，后端立即通过
 *    `remote-image-download-item-done` 事件通知前端，前端立即 `editor.updateBlock`，
 *    不必等待整批 invoke 返回。
 *
 * 一次 enqueueBatch 对应一次后端 download_remote_images 调用。
 * 多文件/多次入队会启动多个 invoke 并行执行，但通过协调器合并到同一个 toast。
 */
import { listen } from '@tauri-apps/api/event'
import { toast } from 'sonner'
import { downloadRemoteImages, type RemoteImageResult } from './tauri'

interface ApplyContext {
  editor: any
  blockId: string
}

interface ItemDonePayload {
  url: string
  ok: boolean
  bytes: number
  relative_path: string | null
  file_name: string | null
  error: string | null
}

interface ProgressPayload {
  done: number
  total: number
  current_url: string | null
  phase: string
  bytes_downloaded: number
  elapsed_ms: number
}

/** 单张图片的入队信息（不含上下文）。 */
export interface BatchItem {
  url: string
  blockId: string
}

class DownloadCoordinator {
  private toastId: string | number | null = null
  /** 所有未完成任务总数。 */
  private total = 0
  /** 已完成数（成功 + 失败），累计。 */
  private done = 0
  private successCount = 0
  private failedCount = 0
  private bytesDownloaded = 0
  private startedAt = 0
  /** url → 应用回调上下文（找到 block 立即替换）。 */
  private urlMap: Map<string, ApplyContext> = new Map()
  /** 已处理过的 URL（防止 item-done + results 重复计数）。 */
  private processedUrls: Set<string> = new Set()
  private listenersRegistered = false
  /** 当前正在飞行的后端 invoke 任务数。 */
  private inFlight = 0

  constructor() {
    // 应用启动即注册全局事件监听，避免第一次点击时监听器尚未就绪导致事件丢失。
    this.ensureListeners()
  }

  /** 是否有正在飞行的下载任务（用于 Toolbar 禁用按钮）。 */
  get isBusy(): boolean {
    return this.inFlight > 0
  }

  /** 将已下载字节数与耗时格式化为速度字符串。 */
  private formatSpeed(bytes: number, elapsedMs: number): string {
    if (!elapsedMs || elapsedMs < 500) return '—'
    const bps = (bytes * 1000) / elapsedMs
    if (bps >= 1024 * 1024) return `${(bps / (1024 * 1024)).toFixed(2)} MB/s`
    if (bps >= 1024) return `${(bps / 1024).toFixed(1)} KB/s`
    return `${bps.toFixed(0)} B/s`
  }

  /** 用当前 total/done/bytes 刷新 toast 文案。 */
  private updateToast() {
    if (this.toastId === null) return
    const speedText = this.formatSpeed(
      this.bytesDownloaded,
      this.startedAt ? Date.now() - this.startedAt : 0
    )
    const text = `正在下载 ${this.done}/${this.total} 张图片… ${speedText}`
    toast.loading(text, { id: this.toastId })
  }

  /** 注册一次性的全局事件监听（应用生命周期内常驻）。 */
  private async ensureListeners() {
    if (this.listenersRegistered) return
    this.listenersRegistered = true

    // 监听单张完成事件：成功时立即替换 block URL，并即时刷新进度
    await listen<ItemDonePayload>(
      'remote-image-download-item-done',
      (e) => {
        const { url, ok, relative_path, file_name } = e.payload

        // 替换 block URL（如果仍在 urlMap 中）
        const ctx = this.urlMap.get(url)
        if (ctx && ok && relative_path) {
          try {
            ctx.editor.updateBlock(ctx.blockId, {
              type: 'image',
              props: { url: relative_path, name: file_name || '' },
            } as any)
          } catch (err) {
            console.error('Failed to apply downloaded url:', err)
          }
        }
        this.urlMap.delete(url)

        // 去重计数：item-done 与 runBatch 的结果可能重复到达
        if (!this.processedUrls.has(url)) {
          this.processedUrls.add(url)
          this.done = Math.min(this.done + 1, this.total)
          if (ok) this.successCount++
          else this.failedCount++
          this.updateToast()
        }
      }
    )

    // 监听进度事件：主要用于刷新已下载字节数
    await listen<ProgressPayload>(
      'remote-image-download-progress',
      (e) => {
        const { bytes_downloaded, phase } = e.payload
        if (phase === 'start' || phase === 'doing') {
          this.bytesDownloaded = Math.max(this.bytesDownloaded, bytes_downloaded)
          this.updateToast()
        }
      }
    )
  }

  /**
   * 排队一批图片（来自同一文件）。一次 invoke。
   * @param items 当前批次的图片项（每个含 url + blockId）
   * @param blockContexts 同一文件中所有图片 block 的 url → { editor, blockId } 映射
   * @param ctx 文件上下文：targetDir / fileDir / rootPath
   */
  enqueueBatch(
    items: BatchItem[],
    blockContexts: Map<string, ApplyContext>,
    ctx: { targetDir: string; fileDir: string; rootPath: string }
  ) {
    if (items.length === 0) return

    // 1. 第一次 enqueue 时建立 toast + 启动时间
    if (this.toastId === null) {
      this.toastId = toast.loading('正在准备下载…')
      this.startedAt = Date.now()
      this.done = 0
      this.successCount = 0
      this.failedCount = 0
      this.bytesDownloaded = 0
      this.processedUrls.clear()
    }

    // 2. 累积 urlMap
    for (const [url, c] of blockContexts) {
      this.urlMap.set(url, c)
    }

    // 3. 增加 total
    this.total += items.length
    this.updateToast()

    // 4. 启动后端调用（fire-and-forget）
    this.inFlight++
    this.runBatch(items, ctx)
  }

  /** 启动一次后端 download_remote_images 调用。 */
  private runBatch(
    items: BatchItem[],
    ctx: { targetDir: string; fileDir: string; rootPath: string }
  ) {
    ;(async () => {
      let results: RemoteImageResult[] = []
      try {
        results = await downloadRemoteImages({
          images: items.map((it) => ({
            url: it.url,
            target_dir: ctx.targetDir,
            file_dir: ctx.fileDir,
            root_path: ctx.rootPath,
          })),
        })
      } catch (err) {
        console.error('[DownloadCoordinator] invoke failed:', err)
        // invoke 整体失败：本批所有图片都算失败，并弹出可见错误提示
        const message = err instanceof Error ? err.message : String(err)
        toast.error(`远程图片下载失败：${message}`)
      }

      // 累加 done：优先使用 invoke 返回的 results，补充尚未被 item-done 处理的 URL
      if (results.length > 0) {
        for (const r of results) {
          if (!this.processedUrls.has(r.url)) {
            this.processedUrls.add(r.url)
            this.done = Math.min(this.done + 1, this.total)
            if (r.ok) this.successCount++
            else this.failedCount++
          }
        }
      } else {
        // invoke 整体失败：本批全算失败
        this.done = Math.min(this.done + items.length, this.total)
        this.failedCount += items.length
      }

      this.inFlight--
      this.updateToast()
      this.maybeFinish()
    })()
  }

  /** 全部完成后清理 toast + 显示结果。 */
  private maybeFinish() {
    if (this.inFlight > 0) return
    if (this.done < this.total) return

    const id = this.toastId
    const success = this.successCount
    const failed = this.failedCount

    this.toastId = null
    this.total = 0
    this.done = 0
    this.successCount = 0
    this.failedCount = 0
    this.bytesDownloaded = 0
    this.startedAt = 0
    this.urlMap.clear()
    this.processedUrls.clear()

    if (id !== null) toast.dismiss(id)

    setTimeout(() => {
      if (failed === 0) {
        toast.success(`已下载 ${success} 张远程图片`)
      } else if (success === 0) {
        toast.error(`下载失败：${failed} 张`)
      } else {
        toast.warning(`成功 ${success} 张，失败 ${failed} 张`)
      }
    }, 100)
  }
}

export const downloadCoordinator = new DownloadCoordinator()
