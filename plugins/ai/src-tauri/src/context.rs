//! 上下文估算与截断（设计 §6.9）。
//!
//! - 估算：`tokens ≈ ceil(CJK字符数×1.0 + 其他字符数÷4)`；
//! - 组装顺序：system（全局+角色）→ 附件 → 会话历史（由新到旧填充至预算）→ 当前消息；
//! - 预算：`context_window × 60%`，超限裁最老消息并提示「已省略 N 条早期消息」，
//!   上游仍报 context 超限时透传原始错误（在编排层处理）。
//!
//! 附件内容外置于 `attachments/`，发送前作为消息文本参与本估算（P2.3/P2.6 接入）。

/// 上下文预算占模型窗口的比例（60%）。
pub const CONTEXT_BUDGET_RATIO: u64 = 60;

#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrimResult {
    /// 保留的消息（保持原顺序）
    pub kept: Vec<ChatMessage>,
    /// 被截断省略的最老非 system 消息条数
    pub omitted: usize,
}

/// CJK 判定：汉字（含扩展A/兼容）、日文假名、谚文、CJK 标点、全角形式。
fn is_cjk(c: char) -> bool {
    matches!(c as u32,
        0x3000..=0x303F  // CJK 标点（，。「」等）
        | 0x3040..=0x30FF  // 日文假名
        | 0x3400..=0x4DBF  // CJK 扩展 A
        | 0x4E00..=0x9FFF  // CJK 统一表意文字基本区
        | 0xAC00..=0xD7AF  // 谚文音节
        | 0xF900..=0xFAFF  // CJK 兼容表意文字
        | 0xFF00..=0xFFEF  // 全角形式（！？Ａ等）
    )
}

/// 估算 token 数：`ceil(CJK字符数×1.0 + 其他字符数÷4)`。
pub fn estimate_tokens(text: &str) -> u64 {
    let mut cjk: u64 = 0;
    let mut other: u64 = 0;
    for c in text.chars() {
        if is_cjk(c) {
            cjk += 1;
        } else {
            other += 1;
        }
    }
    cjk + (other + 3) / 4
}

/// 按窗口预算截断历史：
/// system 消息（双层提示词）永不裁剪；最后一条（当前消息）永远保留；
/// 其余消息由新到旧填充至预算，装不下的更早消息全部省略并计数。
pub fn trim_messages(messages: &[ChatMessage], context_window: u64) -> TrimResult {
    // C34：context_window 来自远端模型配置，用 saturating_mul 防御异常大值乘比例溢出
    let budget = context_window.saturating_mul(CONTEXT_BUDGET_RATIO) / 100;
    // system（双层提示词）不计入截断
    let system_tokens: u64 = messages
        .iter()
        .filter(|m| m.role == "system")
        .map(|m| estimate_tokens(&m.content))
        .sum();
    let mut remaining = budget.saturating_sub(system_tokens);

    let last_idx = messages.len().saturating_sub(1);
    let mut keep = vec![false; messages.len()];
    // system（双层提示词）先全量标记保留——独立于填充循环，避免截断 break 漏标
    for (i, m) in messages.iter().enumerate() {
        if m.role == "system" {
            keep[i] = true;
        }
    }
    // 非 system 消息由新到旧填充：遇预算不足即停，更早的省略
    for i in (0..messages.len()).rev() {
        if messages[i].role == "system" {
            continue;
        }
        let t = estimate_tokens(&messages[i].content);
        // 当前消息永远保留（自身超预算也不裁，超限错误由上游透传兜底）
        if i == last_idx {
            keep[i] = true;
            remaining = remaining.saturating_sub(t);
            continue;
        }
        if t <= remaining {
            keep[i] = true;
            remaining -= t;
        } else {
            break;
        }
    }

    let mut kept = Vec::new();
    let mut omitted = 0usize;
    for (i, m) in messages.iter().enumerate() {
        if keep[i] {
            kept.push(m.clone());
        } else {
            omitted += 1;
        }
    }
    TrimResult { kept, omitted }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msg(role: &str, content: &str) -> ChatMessage {
        ChatMessage { role: role.into(), content: content.into() }
    }

    #[test]
    fn estimate_tokens_counts_cjk_and_ascii() {
        assert_eq!(estimate_tokens(""), 0);
        assert_eq!(estimate_tokens("abcd"), 1); // ceil(4/4)
        assert_eq!(estimate_tokens("abcde"), 2); // ceil(5/4)
        assert_eq!(estimate_tokens("你好"), 2); // CJK 每字 1 token
        assert_eq!(estimate_tokens("你好world"), 4); // 2 CJK + ceil(5/4)
        // 全角标点计入 CJK：你好，！(4) + world(5→2) = 6
        assert_eq!(estimate_tokens("你好，world！"), 6);
    }

    #[test]
    fn keeps_all_within_budget() {
        let msgs = vec![
            msg("system", "s"),
            msg("user", "a"),
            msg("assistant", "b"),
        ];
        // 总 tokens = 3，预算 = 100×60/100 = 60，全保留
        let r = trim_messages(&msgs, 100);
        assert_eq!(r.kept, msgs);
        assert_eq!(r.omitted, 0);
    }

    /// 预算不足：由新到旧填充，裁最老消息并计数。
    #[test]
    fn trims_oldest_and_counts_omitted() {
        let msgs = vec![
            msg("system", "s"),                 // 1
            msg("user", &"a".repeat(80)),       // 20
            msg("assistant", &"b".repeat(80)),  // 20
            msg("user", "hi"),                  // 1
        ];
        // 预算 = 50×60/100 = 30；system 1 → 余 29；hi(1)→28，中(20)→8，老(20)>8 裁
        let r = trim_messages(&msgs, 50);
        assert_eq!(r.omitted, 1);
        assert_eq!(
            r.kept,
            vec![msg("system", "s"), msg("assistant", &"b".repeat(80)), msg("user", "hi")]
        );
    }

    /// 双层 system（全局+角色）永不截断，即使合计超预算；当前消息仍保留。
    #[test]
    fn system_messages_never_trimmed() {
        let long = "x".repeat(400); // 100 tokens
        let msgs = vec![
            msg("system", "全局"), // 2
            msg("system", &long),  // 100
            msg("user", "hi"),     // 1
        ];
        // 预算 = 10×60/100 = 6 < system 合计 102 → 余量 0，仅当前消息保留
        let r = trim_messages(&msgs, 10);
        assert_eq!(r.kept, vec![msg("system", "全局"), msg("system", &long), msg("user", "hi")]);
        assert_eq!(r.omitted, 0);
    }

    /// 当前消息永远保留（哪怕自身超预算），其余全裁。
    #[test]
    fn current_message_always_kept() {
        let huge = "y".repeat(4000); // 1000 tokens
        let msgs = vec![msg("user", "old"), msg("user", &huge)];
        // 预算 = 10×60/100 = 6；最后一条永远保留，old 裁掉
        let r = trim_messages(&msgs, 10);
        assert_eq!(r.omitted, 1);
        assert_eq!(r.kept, vec![msg("user", &huge)]);
    }

    #[test]
    fn empty_input_yields_empty_result() {
        let r = trim_messages(&[], 100);
        assert_eq!(r.kept, Vec::<ChatMessage>::new());
        assert_eq!(r.omitted, 0);
    }
}
