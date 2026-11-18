import { writeFileSync } from 'node:fs'
import { deflateRawSync } from 'node:zlib'

/**
 * 确定性 zip 写入器（无第三方依赖）。
 *
 * 与原 package.sh 的 `zip -X -r` + `touch -d 2020-01-01` 等价的确定性保证：
 *  - 固定条目顺序（按传入数组顺序写入）；
 *  - 固定 mtime（2020-01-01T00:00:00Z → DOS 时间 0x0000/0x5021）；
 *  - 剥离全部 extra field / 文件注释 / 磁盘号等可变字段；
 *  - 压缩使用 zlib.deflateRawSync 固定级别，同机同输入字节一致。
 *
 * zip 内部结构与宿主解压期望一致（src-tauri/src/commands/plugin.rs
 * extract_zip_with_precheck）：条目平铺在 zip 根（index.js / manifest.json /
 * settings.json / backend/plugin_<id>），无外层包裹目录。
 */

/** zip 条目：data 为 null 表示目录条目（name 以 / 结尾） */
export interface ZipEntry {
  name: string
  data: Buffer | null
  /** unix 权限位（如 0o644 / 0o755），记录在 central directory 外部属性高 16 位 */
  mode: number
}

// 固定时间戳：2020-01-01T00:00:00Z → DOS date = (40<<9)|(1<<5)|1, DOS time = 0
const DOS_TIME = 0
const DOS_DATE = (40 << 9) | (1 << 5) | 1

// 通用标志位：bit11 = 文件名 UTF-8 编码
const UTF8_FLAG = 0x0800
// 压缩方法：8 = deflate（小文件 deflate 不收益时回退 0 = store）
const METHOD_DEFLATE = 8
const METHOD_STORE = 0

// CRC32 查表（无依赖实现）
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

/** deflate 后更小才压缩，否则 store（与信息熵无关，仅保证确定行为） */
function compress(data: Buffer): { method: number; payload: Buffer } {
  const deflated = deflateRawSync(data, { level: 6 })
  if (deflated.length < data.length) {
    return { method: METHOD_DEFLATE, payload: deflated }
  }
  return { method: METHOD_STORE, payload: data }
}

/**
 * 写出确定性 zip。
 * @param outPath zip 输出路径
 * @param entries 条目数组（顺序即 zip 内顺序；目录条目 name 以 / 结尾、data 为 null）
 */
export function writeDeterministicZip(outPath: string, entries: ZipEntry[]): void {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf-8')
    const isDir = entry.data === null
    const content = entry.data ?? Buffer.alloc(0)
    const crc = crc32(content)
    // 目录条目始终 store；文件条目按收益选择 deflate/store
    const { method, payload } = isDir ? { method: METHOD_STORE, payload: content } : compress(content)

    // unix 外部属性：高 16 位为权限位；目录额外带 MS-DOS 目录位 0x10
    const externalAttrs = ((entry.mode & 0xffff) << 16) | (isDir ? 0x10 : 0)

    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0) // local file header 签名
    localHeader.writeUInt16LE(20, 4) // version needed
    localHeader.writeUInt16LE(UTF8_FLAG, 6) // 通用标志：UTF-8 文件名
    localHeader.writeUInt16LE(method, 8)
    localHeader.writeUInt16LE(DOS_TIME, 10)
    localHeader.writeUInt16LE(DOS_DATE, 12)
    localHeader.writeUInt32LE(crc, 14)
    localHeader.writeUInt32LE(payload.length, 18) // compressed size
    localHeader.writeUInt32LE(content.length, 22) // uncompressed size
    localHeader.writeUInt16LE(nameBytes.length, 26)
    localHeader.writeUInt16LE(0, 28) // extra field 长度 = 0（确定性关键）
    localParts.push(localHeader, nameBytes, payload)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0) // central directory 签名
    centralHeader.writeUInt16LE((3 << 8) | 20, 4) // version made by：unix / 2.0
    centralHeader.writeUInt16LE(20, 6) // version needed
    centralHeader.writeUInt16LE(UTF8_FLAG, 8)
    centralHeader.writeUInt16LE(method, 10)
    centralHeader.writeUInt16LE(DOS_TIME, 12)
    centralHeader.writeUInt16LE(DOS_DATE, 14)
    centralHeader.writeUInt32LE(crc, 16)
    centralHeader.writeUInt32LE(payload.length, 20)
    centralHeader.writeUInt32LE(content.length, 24)
    centralHeader.writeUInt16LE(nameBytes.length, 28)
    centralHeader.writeUInt16LE(0, 30) // extra len = 0
    centralHeader.writeUInt16LE(0, 32) // comment len = 0
    centralHeader.writeUInt16LE(0, 34) // disk number start
    centralHeader.writeUInt16LE(0, 36) // internal attrs
    centralHeader.writeUInt32LE(externalAttrs, 38)
    centralHeader.writeUInt32LE(offset, 42) // local header 偏移
    centralParts.push(centralHeader, nameBytes)

    offset += localHeader.length + nameBytes.length + payload.length
  }

  const centralSize = centralParts.reduce((n, b) => n + b.length, 0)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0) // EOCD 签名
  eocd.writeUInt16LE(0, 4) // disk number
  eocd.writeUInt16LE(0, 6) // central directory 起始 disk
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralSize, 12)
  eocd.writeUInt32LE(offset, 16) // central directory 偏移
  eocd.writeUInt16LE(0, 20) // comment len = 0

  writeFileSync(outPath, Buffer.concat([...localParts, ...centralParts, eocd]))
}
