export type NoteStatus = 'draft' | 'published' | 'archived';

export interface NoteFrontmatter {
  /** 笔记标题，默认取文件名 */
  title?: string;
  /** 创建时间 (ISO 8601) */
  created?: string;
  /** 最后更新时间 (ISO 8601) */
  updated?: string;
  /** 标签列表 */
  tags?: string[];
  /** 分类路径 */
  categories?: string[];
  /** 作者 */
  author?: string;
  /** 发布状态 */
  status?: NoteStatus;
  /** 是否置顶 */
  pinned?: boolean;
  /** 自定义扩展属性 */
  [key: string]: unknown;
}

export interface FrontmatterParseResult {
  /** 解析后的 frontmatter 数据对象 */
  data: NoteFrontmatter;
  /** 去除 frontmatter 块后的 Markdown body */
  body: string;
  /** 原始 frontmatter YAML 文本（含 --- 分隔符），无 frontmatter 时为空字符串 */
  raw: string;
}

export const STANDARD_FRONTMATTER_KEYS = [
  'title', 'created', 'updated', 'tags',
  'categories', 'author', 'status', 'pinned',
] as const;

export function isStandardKey(key: string): boolean {
  return (STANDARD_FRONTMATTER_KEYS as readonly string[]).includes(key);
}
