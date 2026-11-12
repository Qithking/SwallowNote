//! SSE（Server-Sent Events）字节流增量解析。
//!
//! 自主应用 `ai_proxy/handlers.rs` 的解析段平移：
//! - 原始字节累积、不提前 UTF-8 解码（避免多字节字符被网络分块切断）；
//! - 64KB 缓冲上限，超限清空并报错（自愈，可继续接收后续数据）；
//! - 按行切割，仅消费完整行，不完整行留待下一块。

/// SSE 缓冲上限：64KB（平移自内置实现的 MAX_BUFFER_SIZE）。
pub const MAX_BUFFER_SIZE: usize = 64 * 1024;

/// 解析产出：一条 `data:` 行的载荷文本（`[DONE]` 终止标记由上层特判）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SseItem {
    Data(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SseError {
    /// 缓冲超上限；内部已清空，调用方发出 error 事件后可继续喂入。
    Overflow,
}

pub struct SseParser {
    buf: Vec<u8>,
}

impl SseParser {
    pub fn new() -> Self {
        SseParser { buf: Vec::new() }
    }

    /// 喂入一个网络分块，返回本次解析出的完整 data 行载荷。
    pub fn feed(&mut self, chunk: &[u8]) -> Result<Vec<SseItem>, SseError> {
        self.buf.extend_from_slice(chunk);
        if self.buf.len() > MAX_BUFFER_SIZE {
            // 超限自愈：清空缓冲并报错，调用方发 error 事件后可继续接收后续数据
            self.buf.clear();
            return Err(SseError::Overflow);
        }
        let mut items = Vec::new();
        // 仅消费到最后一个完整行（\n 为界），不完整行留待下一块
        while let Some(pos) = self.buf.iter().position(|&b| b == b'\n') {
            let line_bytes: Vec<u8> = self.buf.drain(..=pos).collect();
            let line = String::from_utf8_lossy(&line_bytes).trim().to_string();
            if let Some(rest) = line.strip_prefix("data:") {
                items.push(SseItem::Data(rest.trim().to_string()));
            }
            // 空行 / 注释行 / event 行等非 data 行跳过
        }
        Ok(items)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_data_lines_from_single_chunk() {
        let mut p = SseParser::new();
        let items = p
            .feed(b"data: {\"a\":1}\n\ndata: {\"b\":2}\n")
            .unwrap();
        assert_eq!(
            items,
            vec![
                SseItem::Data("{\"a\":1}".into()),
                SseItem::Data("{\"b\":2}".into()),
            ]
        );
    }

    /// 中文跨块：多字节 UTF-8 序列被网络分块切断时不得损坏，补全后正确解析。
    #[test]
    fn survives_utf8_split_across_chunks() {
        let mut p = SseParser::new();
        let bytes = format!("data: {}\n", serde_json::json!("你好世界")).into_bytes();
        // "data: \"" 为 7 字节，切在第 8 字节（"你" 的 UTF-8 首字节处）
        let (a, b) = bytes.split_at(8);
        assert!(p.feed(a).unwrap().is_empty(), "不完整行不应产出");
        assert_eq!(p.feed(b).unwrap(), vec![SseItem::Data("\"你好世界\"".into())]);
    }

    /// 无换行结尾的行先缓冲，补全后产出。
    #[test]
    fn waits_for_incomplete_line_then_completes() {
        let mut p = SseParser::new();
        assert!(p.feed(b"data: partial").unwrap().is_empty());
        assert_eq!(p.feed(b" line\n").unwrap(), vec![SseItem::Data("partial line".into())]);
    }

    /// 注释行、空行、event 行均跳过，只产出 data 行。
    #[test]
    fn skips_non_data_and_comment_lines() {
        let mut p = SseParser::new();
        let items = p
            .feed(b": keep-alive\n\nevent: message\ndata: x\n: ping\n")
            .unwrap();
        assert_eq!(items, vec![SseItem::Data("x".into())]);
    }

    /// CRLF 行尾的 \r 被裁剪。
    #[test]
    fn trims_cr_from_crlf_lines() {
        let mut p = SseParser::new();
        assert_eq!(p.feed(b"data: x\r\n").unwrap(), vec![SseItem::Data("x".into())]);
    }

    /// [DONE] 终止标记原样作为 Data 产出，由上层（SSE→通知帧转换）特判。
    #[test]
    fn done_marker_passes_through_as_data() {
        let mut p = SseParser::new();
        assert_eq!(p.feed(b"data: [DONE]\n").unwrap(), vec![SseItem::Data("[DONE]".into())]);
    }

    /// 64KB 上限：单块超限报错且内部清空；随后继续喂入可正常解析（自愈恢复）。
    #[test]
    fn overflow_errors_then_parser_recovers() {
        let mut p = SseParser::new();
        let big = vec![b'x'; MAX_BUFFER_SIZE + 1];
        assert_eq!(p.feed(&big), Err(SseError::Overflow));
        assert_eq!(p.feed(b"data: ok\n").unwrap(), vec![SseItem::Data("ok".into())]);
    }
}
