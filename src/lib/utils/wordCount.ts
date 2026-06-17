/**
 * Word count utility - CJK-aware word counting
 * CJK characters are counted individually as words,
 * while Latin words are counted by whitespace separation.
 */

/**
 * Count words in content, properly handling CJK (Chinese, Japanese, Korean) characters.
 * CJK characters are counted individually as words, while Latin words are counted by whitespace separation.
 */
export function countWords(content: string): number {
  let count = 0
  // Match CJK ideographs (Han), Hiragana, Katakana, Hangul
  const cjkRegex = /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g
  const cjkMatches = content.match(cjkRegex)
  if (cjkMatches) {
    count += cjkMatches.length
  }
  // Remove CJK characters and count remaining words
  const withoutCjk = content.replace(cjkRegex, ' ')
  const latinWords = withoutCjk.split(/\s+/).filter(Boolean)
  count += latinWords.length
  return count
}
