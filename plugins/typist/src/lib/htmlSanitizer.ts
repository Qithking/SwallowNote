/**
 * HTML safety filter for paste-buffer payloads.
 *
 * The backend already inlines every style and never emits a
 * `<style>` block, but a third-party extension or a future backend
 * regression could leak `<script>` / event-handler attributes. We
 * strip the dangerous stuff here as a defense-in-depth measure
 * before writing to the clipboard.
 *
 * The filter is intentionally small and dependency-free; the WeChat
 * editor itself does further sanitization on its side, so the goal
 * is "no surprises in the dev console", not bulletproof XSS defense.
 */
const SCRIPT_RE = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi
const STYLE_RE = /<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi
const IFRAME_RE = /<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi
const OBJECT_RE = /<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi
const EMBED_RE = /<embed\b[^>]*>/gi
// Event-handler attributes like `onclick="..."` / `onload='...'` /
// `onerror=...`. The value part is constrained to a single quoted or
// bareword run so a quote in one attribute doesn't swallow the next
// attribute's content (which is what `[^\s>]+` would do).
const ON_EVENT_RE = /\son[a-z]+\s*=\s*(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s>"']+)/gi
// URL-bearing attributes that can carry executable payloads. We block
// `javascript:` (the canonical XSS vector), `vbscript:` (IE legacy but
// still appearing in scraped content) and `data:text/html` (which the
// browser will execute as a document). `data:image/...` is allowed
// because we use it legitimately for image-clipboard fallbacks.
//
// Note: the data: scheme has its own URL format — `data:<mediatype>
// [;params],<data>` — so the mediatype branch must NOT require a `:`
// after `text/html`. The actual dangerous payload looks like
// `data:text/html;base64,<encoded html>` (no second colon). Earlier
// versions of this regex required a trailing `:` and silently let
// `data:text/html;base64,...` through. The two scheme families are
// factored out so neither can poison the other's pattern.
const DANGEROUS_URL_RE = /\s(href|src|formaction)\s*=\s*(?:"\s*(?:(?:javascript|vbscript)\s*:[^"]*|data\s*:\s*text\/html[^"]*)"|'\s*(?:(?:javascript|vbscript)\s*:[^']*|data\s*:\s*text\/html[^']*)'|(?:javascript|vbscript)\s*:[^\s>]+|data\s*:\s*text\/html[^\s>]+)/gi

export function sanitizeHtmlForWeChat(html: string): string {
  return html
    .replace(SCRIPT_RE, '')
    .replace(STYLE_RE, '')
    .replace(IFRAME_RE, '')
    .replace(OBJECT_RE, '')
    .replace(EMBED_RE, '')
    .replace(ON_EVENT_RE, '')
    .replace(DANGEROUS_URL_RE, '')
}

/**
 * Strip all HTML tags and return a plain-text approximation.
 * Used as a fallback payload for the `text/plain` clipboard slot.
 */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
