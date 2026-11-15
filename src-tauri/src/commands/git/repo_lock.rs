//! F2：per-repo 互斥锁。
//! git_pull / git_push / git_force_pull / git_force_push / git_commit_and_push
//! 都会改动仓库状态并触发网络同步，并发执行会互相踩踏
//! （如 pull 进行中另一个 commit_and_push 又发起 pull/rebase）。
//! 以仓库路径为键提供互斥锁：同一仓库的此类命令串行执行，不同仓库互不影响。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};

/// 全局锁注册表：仓库路径 → 互斥锁。条目只增不减（仓库数量有限），无需清理。
static REPO_LOCKS: OnceLock<Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>> = OnceLock::new();

fn locks() -> &'static Mutex<HashMap<PathBuf, Arc<Mutex<()>>>> {
    REPO_LOCKS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 获取指定仓库的互斥锁并在 `f` 执行期间持有；`f` 返回（含提前 return / `?`）后自动释放。
/// 同一仓库路径的并发调用阻塞串行，不同路径互不阻塞。
///
/// 注意：调用方为 async 命令，但命令体内无 `.await`（run_git 为同步阻塞执行），
/// 阻塞等待锁与现有执行模型一致，不引入新的线程阻塞面。
pub fn with_repo_lock<T, F: FnOnce() -> T>(path: impl AsRef<Path>, f: F) -> T {
    // 外层锁只用于注册表查找/插入，立即释放，避免长期占用注册表。
    // 两处均做 Mutex 中毒恢复：临界区 panic 只应让本次操作失败，
    // 不能让该仓库（乃至注册表）后续所有 git 命令连锁 panic
    let lock = {
        let mut map = locks()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        Arc::clone(
            map.entry(normalize_lock_key(path.as_ref()))
                .or_insert_with(|| Arc::new(Mutex::new(()))),
        )
    };
    let _guard: MutexGuard<'_, ()> = lock
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    f()
}

/// S-17：规范化锁键——同一仓库的多种路径写法（尾斜杠 / 符号链接 / 内部重复斜杠）
/// 必须命中同一把锁，否则同仓库并发写命令互相踩踏（如 "/a/repo" 与 "/a/repo/"、
/// macOS 下 /var 与 /private/var）。
/// 优先 canonicalize（解析符号链接，要求路径存在——仓库根通常存在）；
/// 失败（如测试路径不存在）时回退到按组件归一化：丢弃 "."、"//" 折叠、去尾部斜杠。
fn normalize_lock_key(path: &Path) -> PathBuf {
    if let Ok(canon) = std::fs::canonicalize(path) {
        return canon;
    }
    let mut key = PathBuf::new();
    for comp in path.components() {
        match comp {
            std::path::Component::RootDir => key.push(std::path::MAIN_SEPARATOR.to_string()),
            std::path::Component::Prefix(p) => key.push(p.as_os_str()),
            // "." 组件在路径语义中无意义，归一化时丢弃
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => key.push(".."),
            std::path::Component::Normal(c) => key.push(c),
        }
    }
    if key.as_os_str().is_empty() {
        path.to_path_buf()
    } else {
        key
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration;

    #[test]
    fn same_repo_should_serialize() {
        // 4 个线程争抢同一仓库锁：并发进入临界区的最大值必须为 1
        let current = Arc::new(AtomicUsize::new(0));
        let max_concurrent = Arc::new(AtomicUsize::new(0));
        let completed = Arc::new(AtomicUsize::new(0));
        let mut handles = Vec::new();
        for _ in 0..4 {
            let (current, max_concurrent, completed) =
                (current.clone(), max_concurrent.clone(), completed.clone());
            handles.push(std::thread::spawn(move || {
                with_repo_lock("/tmp/swallownote-test-repo-serialize", || {
                    let now = current.fetch_add(1, Ordering::SeqCst) + 1;
                    max_concurrent.fetch_max(now, Ordering::SeqCst);
                    std::thread::sleep(Duration::from_millis(20));
                    current.fetch_sub(1, Ordering::SeqCst);
                    completed.fetch_add(1, Ordering::SeqCst);
                });
            }));
        }
        for h in handles {
            h.join().unwrap();
        }
        assert_eq!(completed.load(Ordering::SeqCst), 4);
        assert_eq!(max_concurrent.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn poisoned_lock_should_recover() {
        // 临界区 panic 毒化 per-repo 锁后，下一位调用者必须仍能获锁正常执行（中毒恢复）
        let repo = "/tmp/swallownote-test-repo-poison";
        let panic_result =
            std::panic::catch_unwind(|| with_repo_lock(repo, || panic!("simulate panic inside critical section")));
        assert!(panic_result.is_err(), "panic inside critical section should propagate");

        let completed = Arc::new(AtomicUsize::new(0));
        let completed_in_thread = completed.clone();
        let h = std::thread::spawn(move || {
            with_repo_lock(repo, || {
                completed_in_thread.fetch_add(1, Ordering::SeqCst);
            });
        });
        h.join().unwrap();
        assert_eq!(completed.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn different_repos_should_not_block() {
        // repo A 持锁期间，repo B 必须能立即进入自己的临界区
        let (tx, rx) = std::sync::mpsc::channel::<()>();
        let h1 = std::thread::spawn(|| {
            with_repo_lock("/tmp/swallownote-test-repo-a", || {
                std::thread::sleep(Duration::from_millis(300));
            });
        });
        let h2 = std::thread::spawn(move || {
            with_repo_lock("/tmp/swallownote-test-repo-b", || {
                tx.send(()).unwrap();
            });
        });
        assert!(
            rx.recv_timeout(Duration::from_millis(100)).is_ok(),
            "repo B should not be blocked by repo A"
        );
        h1.join().unwrap();
        h2.join().unwrap();
    }

    /// S-17：尾斜杠差异的同一仓库写法必须命中同一把锁（B 应被 A 阻塞）。
    #[test]
    fn trailing_slash_variants_should_share_lock() {
        // 屏障：等 h1 确认已持锁后才启动 h2，消除线程调度竞态
        let (lock_acquired_tx, lock_acquired_rx) = std::sync::mpsc::channel::<()>();
        let h1 = std::thread::spawn(move || {
            with_repo_lock("/tmp/swallownote-test-repo-trailing", || {
                lock_acquired_tx.send(()).unwrap();
                std::thread::sleep(Duration::from_millis(300));
            });
        });
        lock_acquired_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("h1 should acquire the lock first");

        let (tx, rx) = std::sync::mpsc::channel::<()>();
        let h2 = std::thread::spawn(move || {
            with_repo_lock("/tmp/swallownote-test-repo-trailing/", || {
                tx.send(()).unwrap();
            });
        });
        assert!(
            rx.recv_timeout(Duration::from_millis(100)).is_err(),
            "trailing-slash variant should be blocked by the same repo lock"
        );
        h1.join().unwrap();
        h2.join().unwrap();
    }

    /// S-17：符号链接指向同一目录的两种路径必须命中同一把锁（canonicalize 归一化）。
    #[cfg(unix)]
    #[test]
    fn symlink_variants_should_share_lock() {
        let dir = tempfile::tempdir().unwrap();
        let real = dir.path().join("real");
        std::fs::create_dir_all(&real).unwrap();
        let link = dir.path().join("link");
        std::os::unix::fs::symlink(&real, &link).unwrap();

        let (lock_acquired_tx, lock_acquired_rx) = std::sync::mpsc::channel::<()>();
        let h1 = {
            let real = real.clone();
            std::thread::spawn(move || {
                with_repo_lock(&real, || {
                    lock_acquired_tx.send(()).unwrap();
                    std::thread::sleep(Duration::from_millis(300));
                });
            })
        };
        lock_acquired_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("h1 should acquire the lock first");

        let (tx, rx) = std::sync::mpsc::channel::<()>();
        let h2 = std::thread::spawn(move || {
            with_repo_lock(&link, || tx.send(()).unwrap());
        });
        assert!(
            rx.recv_timeout(Duration::from_millis(100)).is_err(),
            "symlink variant should be blocked by the same repo lock"
        );
        h1.join().unwrap();
        h2.join().unwrap();
    }
}
