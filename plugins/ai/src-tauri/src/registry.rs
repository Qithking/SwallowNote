//! B7（P2.3 顺带）：流式请求注册表。
//!
//! - 以 JSON-RPC 请求 id 为键登记进行中的流，提供取消标志（stopStream 语义）
//! - 并发上限 MAX_CONCURRENT_STREAMS：超过即拒绝新流（防资源耗尽）
//! - 生命周期：register（streamChat 分发）→ cancel（stopStream，可幂等）→
//!   unregister（worker 收尾，无论成功/失败/停止）

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

/// 同时进行的流式请求数上限。
pub const MAX_CONCURRENT_STREAMS: usize = 4;

pub struct StreamRegistry {
    inner: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl StreamRegistry {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
        }
    }

    /// 登记新流并返回取消标志。并发满或 id 重复时拒绝。
    pub fn register(&self, request_key: &str) -> Result<Arc<AtomicBool>, String> {
        let mut map = self.inner.lock().unwrap();
        if map.len() >= MAX_CONCURRENT_STREAMS {
            return Err(format!(
                "并发流已达上限({}), 请等待进行中的对话完成或先停止",
                MAX_CONCURRENT_STREAMS
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

    /// 当前进行中的流数（测试与诊断用）。
    #[cfg(test)]
    pub fn active_count(&self) -> usize {
        self.inner.lock().unwrap().len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 注册 → 取消置位可观测 → 注销后名额释放。
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

    /// 未知 id 取消返回 false；未取消的标志保持 false。
    #[test]
    fn cancel_unknown_is_false() {
        let r = StreamRegistry::new();
        let flag = r.register("a").unwrap();
        assert!(!r.cancel("missing"));
        assert!(!flag.load(Ordering::Relaxed));
    }

    /// 并发上限：满 4 后拒绝第 5 个；注销一个后可再注册。
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

        // 相同 id 重复注册被拒绝（防覆盖丢失旧标志）
        assert!(r.register("next").is_err());
    }
}
