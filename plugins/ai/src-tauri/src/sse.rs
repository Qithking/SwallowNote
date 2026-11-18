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
    /// C28：当前事件的 data 行累积——SSE 规范允许一个事件的数据分布在
    /// 多个连续 data: 行，以空行终止并按 \n 拼接派发。
    data_lines: Vec<String>,
}

impl SseParser {
    pub fn new() -> Self {
        SseParser {
            buf: Vec::new(),
            data_lines: Vec::new(),
        }
    }

    /// 喂入一个网络分块，返回本次派发的事件（空行终止时才派发）。
    pub fn feed(&mut self, chunk: &[u8]) -> Result<Vec<SseItem>, SseError> {
        self.buf.extend_from_slice(chunk);
        if self.buf.len() > MAX_BUFFER_SIZE {
            // 超限自愈：清空缓冲并报错，调用方发 error 事件后可继续接收后续数据
            self.buf.clear();
            self.data_lines.clear();
            return Err(SseError::Overflow);
        }
        let mut items = Vec::new();
        // 仅消费到最后一个完整行（\n 为界），不完整行留待下一块
        while let Some(pos) = self.buf.iter().position(|&b| b == b'\n') {
            let line_bytes: Vec<u8> = self.buf.drain(..=pos).collect();
            let line = String::from_utf8_lossy(&line_bytes).trim().to_string();
            if let Some(rest) = line.strip_prefix("data:") {
                // C28：同一事件的 data 行先累积，空行终止时统一派发
                self.data_lines.push(rest.trim().to_string());
            } else if line.is_empty() {
                // 空行 = 事件终止：累积的 data 行按 \n 拼接派发
                if !self.data_lines.is_empty() {
                    items.push(SseItem::Data(self.data_lines.join("\n")));
                    self.data_lines.clear();
                }
            }
            // 注释行（: 开头）与 event/id 等非 data 字段行跳过（不终止事件聚合）
        }
        Ok(items)
    }

    /// C28：流结束时调用——派发残余未终止的事件（SSE 规范：end of stream
    /// 时 data buffer 非空仍需派发）。可重复调用（幂等，无残余不产出）。
    pub fn finish(&mut self) -> Vec<SseItem> {
        if self.data_lines.is_empty() {
            return Vec::new();
        }
        let item = SseItem::Data(self.data_lines.join("\n"));
        self.data_lines.clear();
        vec![item]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_data_lines_from_single_chunk() {
        let mut p = SseParser::new();
        let items = p
            .feed(b"data: {\"a\":1}\n\ndata: {\"b\":2}\n\n")
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
        // 行完成但事件未空行终止，不派发；EOF 时 finish 派发残余事件
        assert!(p.feed(b).unwrap().is_empty());
        assert_eq!(p.finish(), vec![SseItem::Data("\"你好世界\"".into())]);
    }

    /// 无换行结尾的行先缓冲，补全后随事件终止（空行/EOF）派发。
    #[test]
    fn waits_for_incomplete_line_then_completes() {
        let mut p = SseParser::new();
        assert!(p.feed(b"data: partial").unwrap().is_empty());
        // 行补全但事件未终止，不派发
        assert!(p.feed(b" line\n").unwrap().is_empty());
        assert_eq!(p.finish(), vec![SseItem::Data("partial line".into())]);
    }

    /// 注释行、空行、event 行均跳过，只派发 data 事件（EOF 残余派发兜底）。
    #[test]
    fn skips_non_data_and_comment_lines() {
        let mut p = SseParser::new();
        let items = p
            .feed(b": keep-alive\n\nevent: message\ndata: x\n: ping\n")
            .unwrap();
        assert!(items.is_empty(), "未空行终止的事件不派发");
        assert_eq!(p.finish(), vec![SseItem::Data("x".into())]);
    }

    /// CRLF 行尾的 \r 被裁剪。
    #[test]
    fn trims_cr_from_crlf_lines() {
        let mut p = SseParser::new();
        assert_eq!(p.feed(b"data: x\r\n\n").unwrap(), vec![SseItem::Data("x".into())]);
    }

    /// [DONE] 终止标记原样作为 Data 产出，由上层（SSE→通知帧转换）特判。
    #[test]
    fn done_marker_passes_through_as_data() {
        let mut p = SseParser::new();
        assert_eq!(p.feed(b"data: [DONE]\n\n").unwrap(), vec![SseItem::Data("[DONE]".into())]);
    }

    /// 64KB 上限：单块超限报错且内部清空；随后继续喂入可正常解析（自愈恢复）。
    #[test]
    fn overflow_errors_then_parser_recovers() {
        let mut p = SseParser::new();
        let big = vec![b'x'; MAX_BUFFER_SIZE + 1];
        assert_eq!(p.feed(&big), Err(SseError::Overflow));
        assert_eq!(p.feed(b"data: ok\n\n").unwrap(), vec![SseItem::Data("ok".into())]);
    }

    /// C28 回归：同一事件的多个连续 data: 行按 SSE 规范以 \n 拼接为一个事件，
    /// 由空行终止派发（而非逐行独立产出）。
    #[test]
    fn joins_multi_data_lines_into_one_event() {
        let mut p = SseParser::new();
        let items = p.feed(b"data: line1\ndata: line2\n\n").unwrap();
        assert_eq!(items, vec![SseItem::Data("line1\nline2".into())]);
    }

    /// C28 回归：事件内穿插注释行/字段行不终止聚合；未空行终止的事件不派发。
    #[test]
    fn comment_lines_do_not_break_event_grouping() {
        let mut p = SseParser::new();
        let items = p
            .feed(b": ping\ndata: a\n: pong\nevent: t\ndata: b\n\ndata: c\n")
            .unwrap();
        assert_eq!(items, vec![SseItem::Data("a\nb".into())]);
    }

    /// C28 回归：事件的多 data 行分布在不同网络分块中仍正确聚合。
    #[test]
    fn multi_data_event_across_chunks() {
        let mut p = SseParser::new();
        assert!(p.feed(b"data: x\n").unwrap().is_empty());
        assert_eq!(p.feed(b"data: y\n\n").unwrap(), vec![SseItem::Data("x\ny".into())]);
    }

    /// C28 回归：EOF 时残余未终止事件仍派发（SSE 规范：end of stream 时
    /// data buffer 非空需派发），之后 parser 状态清空。
    #[test]
    fn finish_dispatches_trailing_event() {
        let mut p = SseParser::new();
        assert!(p.feed(b"data: last\n").unwrap().is_empty());
        assert_eq!(p.finish(), vec![SseItem::Data("last".into())]);
        assert!(p.finish().is_empty(), "finish 幂等，无残余不产出");
    }
}
