# Git 模块逻辑审查文档

> 生成日期：2026-10-14
> 范围：`src-tauri/src/commands/git/`（18 个文件，约 4700 行）+ 前端 git 相关组件（GitView、ConflictResolver、DetachedHeadDivergedDialog、lib/git/errors.ts、lib/tauri/git.ts、lib/tauri/conflict.ts）
> 来源：代码走读 + 执行文档（.work/执行文档.md）历史修复记录交叉验证

---

## 一、待办事项（问题与优化，按优先级）

### P1 已知问题（需决策或修复）

| # | 问题 | 位置 | 说明 | 严重度 |
|---|------|------|------|--------|
| 1 | stash pop 冲突错误被吞，可能提交含冲突标记的文件 | branch.rs `checkout_with_stash`、commit.rs/push.rs/pull.rs 分叉决策调用点 | stash pop 冲突时仅 `warn!` 不上抛，两个分叉决策命令用 `let _ =` 忽略返回值；stash pop 冲突不产生 MERGE_HEAD，现有冲突门禁检测不到，前端自动重试 `add -A && commit` 可能把 `<<<<<<<` 标记文件提交甚至推送（已实测复现；触发需 detached/分叉 + 同区域未提交改动冲突，stash 保留在 reflog 可恢复）。**用户已决定暂不修复（2026-10-13），修复方向：pop 失败时上抛错误中断自动同步** | 高 |
| 2 | merge commit message 无法自定义 | conflict_content.rs `check_and_continue_rebase`（G-12 注释处） | merge 冲突解决后 `git commit --no-edit` 保留自动生成信息，用户无法输入自定义 merge message；需前端提供输入框 | 低 |
| 3 | 非分叉场景 detached HEAD 修复失败仅 warn 继续 | commit.rs / push.rs / pull.rs 调用 `fix_detached_head` 处 | B5 只对 `DETACHED_HEAD_DIVERGED` 上抛，其余失败（如 checkout 被占用）降级为 warn 继续同步，用户无感知地处于异常 HEAD 状态下提交。属设计取舍，建议至少在 UI 提示 | 中 |
| 4 | 注释精简未完成 | pull.rs / push.rs / 前端 5 文件 | 2026-10-13 注释精简任务的前会话遗留部分 | 低 |

### P2 待真机验证（代码已完成）

| # | 验证项 | 依据 |
|---|--------|------|
| 5 | 方案 A：连续编辑同一文件后 `git log` 只保留一个 Auto-save 提交（amend 合并）；推送后新保存不再 amend；手动提交不被吞并 | commit.rs `should_amend_last_auto_save` |
| 6 | 方案 B：默认 pull 走 merge，auto-save 群只产生一次冲突；`pull.rebase=true` 显式配置仍走 rebase | branch.rs `should_use_rebase` |
| 7 | detached HEAD 分叉弹框：真实分叉仓库触发同步不再报英文错误，两个选项（以当前进度为准/保留本地提交）行为正确 | branch.rs B1-B3 + GitView 分流 |
| 8 | modify/delete 冲突修复：一侧已删除时"接受该侧"正确执行删除而非写入空文件（2026-10-14 实施，cargo check + tsc 通过） | conflict_content.rs / conflict.rs / ConflictResolver.tsx |
| 9 | Githubdoc 仓库进行中的 rebase（12/15）需用户终端手动处理：`git rebase --abort && git pull --no-rebase` | 用户侧仓库，沙箱无法代操作 |

### P3 优化建议

| # | 建议 | 位置 | 说明 |
|---|------|------|------|
| 10 | 提取"修复失败不阻塞"公共模式 | pull.rs / push.rs / commit.rs | `warn! + 继续` 的错误降级模式在三处重复出现，可提取统一 helper（带日志前缀与原因），减少不一致 |
| 11 | ConflictResolver 内容加载无缓存 | ConflictResolver.tsx `loadContent` | 每次切换 selectedFile 都重新 invoke 后端拉取两侧内容；大文件频繁切换可考虑缓存，优先级低 |
| 12 | `git_commit` 使用 `git add -A` 全量暂存 | commit.rs `git_commit` | 手动提交会暂存工作区全部变更（含用户可能不想提交的文件），建议评估是否改为跟随前端选择或至少在 UI 明示 |

---

## 二、模块架构总览

### 后端（src-tauri/src/commands/git/）

| 文件 | 行数 | 职责 |
|------|------|------|
| commit.rs | 944 | 自动保存提交（amend 合并）、手动提交、提交+推送主流程、分叉决策端到端测试 |
| branch.rs | 670 | detached HEAD 修复（B1-B3）、分叉检测、stash 系列、pull.rebase 配置判定、is_rebase_scenario |
| conflict.rs | 404 | 冲突文件列表、两侧内容展示、解决（stage）、中止 rebase/merge |
| clone.rs | 365 | 克隆流程：目录防护、并发防重、凭据 askpass、spawn_blocking 等待、失败清理 |
| pull.rs | 303 | 拉取：默认 merge、显式 rebase 配置、带凭据拉取（临时 askpass 脚本） |
| push.rs | 254 | 推送：detached HEAD 时改用 `HEAD:<branch>` 显式目标 |
| scan.rs | 236 | 递归扫描发现笔记仓库（跳过 node_modules/target/dist/build），收集 remote/分支/未提交变更 |
| paths.rs | 205 | 笔记仓库路径管理 |
| word_diff.rs | 191 | 词级 diff 计算 |
| errors.rs | 179 | 后端错误封装 |
| conflict_content.rs | 135 | 冲突两侧内容获取（rebase/merge 语义反转）、rebase/merge 自动续跑 |
| askpass.rs | 128 | 临时 askpass 脚本（Unix 0600 内嵌凭据 + Windows 环境变量，RAII 清理） |
| mod.rs | 124 | 命令注册 |
| runner.rs | 100 | git 命令执行封装：LC_ALL=C 保证错误文本可匹配、120s 超时、stdout trim |
| models.rs | 98 | 数据模型 |
| credentials.rs | 86 | 凭据管理 |
| conflict_repo_records.rs | 50 | 冲突仓库持久化记录（DB） |
| test_utils.rs | 26 | 测试 fixture |

### 前端

| 文件 | 职责 |
|------|------|
| components/Git/GitView.tsx | git 面板主视图：提交/同步主流程（L236-360），按 GitErrorCode 分流 DETACHED_HEAD_DIVERGED/DETACHED_HEAD/冲突/子模块 |
| components/Git/DetachedHeadDivergedDialog.tsx | 分叉决策弹框（不用 AlertDialogAction 避免 Radix 点击即卸载） |
| components/DiffViewer/ConflictResolver.tsx | 冲突解决面板：状态管理（L130-164）、save/resolve 顺序保证 G-09（L388-492）、解决后处理（L494-545：刷新、DB 记录清理、广播、关 tab） |
| components/DiffViewer/SplitDiffViewer.tsx | 双栏差异编辑器，暴露 getLocalContent 供取编辑内容 |
| lib/git/errors.ts | GitErrorCode 错误码定义、parseGitError 前缀映射、parseDivergedInfo |
| lib/tauri/git.ts | 后端命令 invoke 封装（commit/pull/push/clone/分叉决策等） |
| lib/tauri/conflict.ts | 冲突 API 封装（files/local/remote/resolve/save/abort + 冲突仓库记录） |

---

## 三、核心链路

### 3.1 自动保存 → 提交 → 同步主链

```
用户编辑保存
  → git_auto_commit (commit.rs L354-432)
      1. 定位 git 根目录
      2. rebase/merge 冲突状态 → 跳过（不动冲突中的仓库）
      3. detached HEAD → fix_detached_head（B1 挂分支 / B3 分叉返回 DETACHED_HEAD_DIVERGED）
      4. git add 单个文件
      5. should_amend_last_auto_save (L320-352) 全部满足 → commit --amend --no-edit 合并连续保存：
         - 普通分支（非 detached）
         - 最新提交标题恰为 Auto-save: <同一文件>
         - 暂存区只有当前文件（-c core.quotepath=false 防中文路径误判）
         - 最新提交未推送（无 upstream 视为可 amend）
      6. 否则新建提交

用户点"同步"
  → git_commit_and_push (commit.rs L56-221)
      分叉/HEAD 处理 → stage → commit → git_pull（按 should_use_rebase 分支：默认 merge）→ push
      pull 失败（如远端有新提交产生冲突）时保留冲突状态返回，UI 引导进入冲突面板
```

### 3.2 冲突处理链

```
pull 产生冲突 → 前端 ConflictResolver 加载冲突仓库列表
  → git_get_conflict_files（--diff-filter=U）
  → 两侧内容：git_get_conflict_local/remote_content
      rebase 场景语义反转：local = REBASE_HEAD/:3:（被重放的本地提交），remote = HEAD/:2:（上游）
      merge 场景：local = HEAD/:2:，remote = MERGE_HEAD/:3:
      取不到内容（该侧文件不存在，modify/delete）→ 返回空串展示
  → 解决：
      接受远端 → git_resolve_conflict_file(side='remote')：后端取权威内容写入；该侧不存在则删除工作区文件（2026-10-14 新增）
      接受本地 → 有未保存编辑：先 save 编辑内容再 side='current'（G-09 顺序保证）；无编辑：side='local'
      手动编辑 → save 写工作区（不 stage）→ mark resolved（side='current' 只 stage）
  → 全部 stage 后 check_and_continue_rebase 自动续跑：
      rebase --continue 失败 → REBASE_CONTINUE_FAILED:<err>（G-04，避免前端误报已解决）
      merge commit 失败 → MERGE_COMMIT_FAILED:<err>
      成功后 fix_detached_head 兜底清理（非致命）
```

### 3.3 detached HEAD 修复策略（branch.rs）

| 优先级 | 策略 | 行为 |
|--------|------|------|
| 前置 | 分叉检测 `detect_diverged`（L357-375） | `rev-list --left-right --count`（制表符分隔，split_whitespace 解析），双侧 >0 判分叉 → 返回 `DETACHED_HEAD_DIVERGED:<branch>:<left>:<right>` 上抛前端弹框，不再自动切换 |
| B1 | 本地分支已存在且未分叉 | `checkout -b <branch> <HEAD>` 原地挂分支指针，不动工作区（用 checkout 而非 switch 兼容旧 git） |
| B2 | checkout 失败 | 不再使用 `--force`（删除该回退），stash pop 还原工作区后返回错误，改动不丢 |
| 调用端 | B5 | 仅 DETACHED_HEAD_DIVERGED 上抛（前端弹框决策），其余失败 warn + 继续（见待办 #3） |

前端：GitView `handleCommit` 捕获错误码 → DetachedHeadDivergedDialog → 用户选"以当前进度为准"（gitAttachBranchToHead）/ "保留本地提交"（gitSwitchToLocalBranch）→ 自动重试同步。

### 3.4 克隆与仓库发现

- **clone.rs**：父目录创建 → 目标路径检查 → 并发 clone 防护 → 发开始事件 → 凭据（GIT_ASKPASS + GIT_TERMINAL_PROMPT=0）→ `child.wait()` 放 spawn_blocking → 成功返回路径 / 失败删除残留目录。
- **scan.rs**：`spawn_blocking` 包裹同步 I/O；递归发现 `.git`（含子模块），跳过 node_modules/target/dist/build；收集 remote URL、当前分支、未提交变更。

### 3.5 凭据安全（askpass.rs / credentials.rs）

- 临时 askpass 脚本：Unix 内嵌凭据 + 权限 0600；Windows 走环境变量；RAII guard 保证脚本删除。
- runner.rs 强制 LC_ALL=C/LANG=C：统一错误文本便于后端匹配（注意：中文路径需显式 `-c core.quotepath=false`，方案 A 已处理）。

---

## 四、已落地的健壮性措施（审查确认在位）

1. amend 合并四重安全条件 + core.quotepath=false（含中文文件名回归测试）
2. pull 默认 merge；显式 `pull.rebase=true/yes/on/1` 才走 rebase
3. rebase/merge 冲突状态下 auto-commit/commit/pull/push 均跳过或保留冲突，不破坏进行中的解决过程
4. 冲突解决失败必上抛（G-04），前端不会误报"已解决"
5. 路径穿越防护：conflict.rs resolve/save 双命令均校验 rel_path 不含 `..`，写入目标强制基于 repo_path 拼接（strip_prefix 失败再 canonicalize 兜底 /var vs /private/var）
6. clone 失败清理残留目录、并发 clone 防护
7. 路径含空格/中文由 run_git 参数数组传递，不经 shell 拼接，无注入面

## 五、历史修复记录索引（详见 .work/执行文档.md）

| 标记 | 含义 |
|------|------|
| G-04 | 冲突解决 continue 失败必须上抛 |
| G-05/G-06 | pull.rs 既有顺序/失败处理修复 |
| G-09 | 前端先 save 成功再 resolve 的顺序保证 |
| G-12 | merge commit 保留自动信息（--no-edit） |
| G-14 | 冲突内容获取统一公共函数 |
| G-16 | run_git_no_trim 保留文件末尾换行 |
| B1-B5 | detached HEAD 修复系列（挂分支/禁 force/分叉检测/checkout 兼容/错误上抛） |
| 方案 A/B | Auto-save amend 合并 / pull 默认 merge |
