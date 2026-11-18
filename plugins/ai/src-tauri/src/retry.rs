//! 有限重试（设计 §5 P2.2）：
//! 连接错误 / 5xx / 429 → 最多重试 2 次，指数退避 500ms / 2s；
//! 4xx 不重试；流式开始（首块到达）后的错误由编排层归为 Fatal，不重试。
//!
//! 与 HTTP 栈解耦：尝试与睡眠均为注入参数，纯逻辑可测。

use std::time::Duration;

/// 默认最多重试次数（设计约定）。
pub const MAX_RETRIES: u32 = 2;
/// 默认退避序列：500ms / 2s。
pub const BACKOFFS: [Duration; 2] = [Duration::from_millis(500), Duration::from_secs(2)];

/// 单次尝试结果。Retryable = 连接错误 / 5xx / 429；Fatal = 4xx / 流中途错误等。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Attempt<T> {
    Success(T),
    Retryable(String),
    Fatal(String),
}

/// 有限重试执行器：按序号调用 attempt（0 起），Retryable 且未耗尽次数时
/// 以 backoffs[序号] 退避后重试；耗尽返回最后一次错误。
pub fn with_retry<T, F, S>(
    mut attempt: F,
    max_retries: u32,
    backoffs: &[Duration],
    sleep: &mut S,
) -> Result<T, String>
where
    F: FnMut(u32) -> Attempt<T>,
    S: FnMut(Duration),
{
    let mut n: u32 = 0;
    loop {
        match attempt(n) {
            Attempt::Success(v) => return Ok(v),
            // 4xx / 流中途错误等：立即失败
            Attempt::Fatal(e) => return Err(e),
            Attempt::Retryable(e) => {
                if n >= max_retries {
                    return Err(e);
                }
                // 越界防御：退避序列不足时取最后一档
                let idx = n as usize;
                sleep(backoffs[idx.min(backoffs.len() - 1)]);
                n += 1;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn success_on_first_attempt_no_retry() {
        let mut slept = Vec::new();
        let result = {
            let mut sleep = |d: Duration| slept.push(d);
            with_retry(
                |n| {
                    assert_eq!(n, 0);
                    Attempt::Success(42)
                },
                MAX_RETRIES,
                &BACKOFFS,
                &mut sleep,
            )
        };
        assert_eq!(result, Ok(42));
        assert!(slept.is_empty(), "成功不应退避");
    }

    /// 第 1 次可重试失败、第 2 次成功：退避一次（500ms）。
    #[test]
    fn retryable_then_success_retries_once() {
        let mut slept = Vec::new();
        let result = {
            let mut sleep = |d: Duration| slept.push(d);
            with_retry(
                |n| match n {
                    0 => Attempt::Retryable("conn reset".into()),
                    _ => Attempt::Success(()),
                },
                MAX_RETRIES,
                &BACKOFFS,
                &mut sleep,
            )
        };
        assert_eq!(result, Ok(()));
        assert_eq!(slept, vec![Duration::from_millis(500)]);
    }

    /// 可重试失败耗尽 2 次重试：共 3 次尝试，返回最后错误，退避恰为 500ms/2s。
    #[test]
    fn retryable_exhausted_returns_last_error() {
        let mut slept = Vec::new();
        let result: Result<(), _> = {
            let mut sleep = |d: Duration| slept.push(d);
            with_retry(
                |n| match n {
                    0 => Attempt::Retryable("e0".into()),
                    1 => Attempt::Retryable("e1".into()),
                    2 => Attempt::Retryable("e2".into()),
                    _ => unreachable!(),
                },
                MAX_RETRIES,
                &BACKOFFS,
                &mut sleep,
            )
        };
        assert_eq!(result, Err("e2".into()));
        assert_eq!(
            slept,
            vec![Duration::from_millis(500), Duration::from_secs(2)]
        );
    }

    /// 4xx 等不可重试失败：立即返回，不退避不重试。
    #[test]
    fn fatal_fails_immediately() {
        let mut slept = Vec::new();
        let result: Result<(), _> = {
            let mut sleep = |d: Duration| slept.push(d);
            with_retry(
                |_| Attempt::Fatal("401 unauthorized".into()),
                MAX_RETRIES,
                &BACKOFFS,
                &mut sleep,
            )
        };
        assert_eq!(result, Err("401 unauthorized".into()));
        assert!(slept.is_empty());
    }
}
