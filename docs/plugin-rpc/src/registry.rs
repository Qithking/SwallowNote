//! 流式请求注册表：等价平移自 ai 插件 `src-tauri/src/registry.rs`，泛型化提炼。
//!
//! - 以 JSON-RPC 请求 id（字符串化）为键登记进行中的流，签发取消标志
//!   （stopStream 语义）
//! - 并发上限：超过即拒绝新流并返回明确错误（防资源耗尽）
//! - 生命周期：`register`（流式命令分发期）→ `cancel`（停止命令，幂等）→
//!   `unregister`（worker 收尾，无论成功/失败/停止）
//!
//! 取消的生效方式：worker 在读循环中检查 `register` 返回的 `AtomicBool`。
//! 阻塞读需要「超时唤醒」配合——流式读侧（如 ureq 的 `timeout_read`）以
//! 短超时周期性醒来检查标志即可尽快收尾（对齐 ai 插件 chat.rs 的
//! READ_WAKE_MS 模式）；注册表本身只负责标志的登记/置位/回收。

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

/// 默认同时进行的流式请求数上限（对齐 ai 插件 MAX_CONCURRENT_STREAMS）。
pub const MAX_CONCURRENT_STREAMS: usize = 4;

/// 进行中流式请求的注册表（B7：取消 + 并发上限）。
pub struct StreamRegistry {
    inner: Mutex<HashMap<String, Arc<AtomicBool>>>,
    max_concurrent: usize,
}

impl StreamRegistry {
    /// 以默认并发上限（`MAX_CONCURRENT_STREAMS`）构造。
    pub fn new() -> Self {
        Self::with_limit(MAX_CONCURRENT_STREAMS)
    }

    /// 以自定义并发上限构造（0 视为不设限的合法值由调用方自行斟酌，
    /// 本方法不做二次解释）。
    pub fn with_limit(max_concurrent: usize) -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
            max_concurrent,
        }
    }

    /// 当前配置的并发上限。
    pub fn max_concurrent(&self) -> usize {
        self.max_concurrent
    }

    /// 登记新流并返回取消标志。并发满或 id 重复时拒绝。
    ///
    /// 错误消息与 ai 插件现状一致（会进入错误响应帧的 message，
    /// 宿主原样透传前端）。
    pub fn register(&self, request_key: &str) -> Result<Arc<AtomicBool>, String> {
        let mut map = self.inner.lock().unwrap();
        if map.len() >= self.max_concurrent {
            return Err(format!(
                "并发流已达上限({}), 请等待进行中的对话完成或先停止",
                self.max_concurrent
            ));
        }
        if map.contains_key(request_key) {
            return Err("相同请求的流已在进行中".to_string());
        }
        let flag = Arc::new(AtomicBool::new(false));
        map.insert(request_key.to_string(), Arc::clone(&flag));
        Ok(flag)
    }

    /// 请求停止：置位取消标志并返回该流是否存在（幂等，重复调用无害）。
    pub fn cancel(&self, request_key: &str) -> bool {
        let map = self.inner.lock().unwrap();
        match map.get(request_key) {
            Some(flag) => {
                flag.store(true, Ordering::Relaxed);
                true
            }
            None => false,
        }
    }

    /// 流结束后注销（worker 收尾时调用，保证不泄漏名额）。
    pub fn unregister(&self, request_key: &str) {
        self.inner.lock().unwrap().remove(request_key);
    }

    /// 当前进行中的流数（诊断与测试用）。
    pub fn active_count(&self) -> usize {
        self.inner.lock().unwrap().len()
    }
}

impl Default for StreamRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 注册 → 取消置位可观测 → 注销后名额释放（平移 ai 同名测试）。
    #[test]
    fn register_cancel_unregister_lifecycle() {
        let r = StreamRegistry::new();
        let flag = r.register("1").unwrap();
        assert_eq!(r.active_count(), 1);

        assert!(r.cancel("1")); // 存在 → true
        assert!(flag.load(Ordering::Relaxed)); // 标志已置位
        assert!(r.cancel("1")); // 幂等

        r.unregister("1");
        assert_eq!(r.active_count(), 0);
        assert!(!r.cancel("1")); // 已注销 → false
    }

    /// 未知 id 取消返回 false；未取消的标志保持 false（平移 ai 同名测试）。
    #[test]
    fn cancel_unknown_is_false() {
        let r = StreamRegistry::new();
        let flag = r.register("a").unwrap();
        assert!(!r.cancel("missing"));
        assert!(!flag.load(Ordering::Relaxed));
    }

    /// 并发上限：满 4 后拒绝第 5 个；注销一个后可再注册；
    /// 相同 id 重复注册被拒绝（平移 ai 同名测试）。
    #[test]
    fn concurrent_limit() {
        let r = StreamRegistry::new();
        for i in 0..MAX_CONCURRENT_STREAMS {
            assert!(r.register(&format!("s{}", i)).is_ok());
        }
        assert!(r.register("overflow").is_err());
        assert_eq!(r.active_count(), MAX_CONCURRENT_STREAMS);

        r.unregister("s2");
        assert!(r.register("next").is_ok());
        assert!(r.register("next").is_err());
    }

    /// with_limit：上限可自定义；未满时重复 id 被拒、满员后并发错误
    /// 带明确上限值（迁移注意：该文案会原样进入错误响应帧 message）。
    #[test]
    fn custom_limit_and_error_message() {
        let r = StreamRegistry::with_limit(2);
        assert_eq!(r.max_concurrent(), 2);
        assert!(r.register("a").is_ok());
        // 未满员时：相同 id 重复注册被拒（防覆盖丢失旧标志）。
        assert_eq!(r.register("a").unwrap_err(), "相同请求的流已在进行中");
        assert!(r.register("b").is_ok());
        // 满员后：并发上限拒绝，错误消息含上限值。
        let err = r.register("c").unwrap_err();
        assert!(err.contains("并发流已达上限(2)"), "实际: {}", err);
    }
}
