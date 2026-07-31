import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useGitStore, mapRepoInfoToRepository, mapRepoInfosToRepositories, type GitRepository, type GitRepositoryInfo, type RepoStatus } from '@/stores/git'
import { gitPull, gitCredentialGet, gitPullWithCredentials } from '@/lib/tauri'

vi.mock('@/lib/tauri', () => ({
  gitPull: vi.fn().mockResolvedValue(undefined),
  gitCredentialGet: vi.fn().mockResolvedValue(null),
  gitPullWithCredentials: vi.fn().mockResolvedValue(undefined),
  getConflictRepoRecords: vi.fn().mockResolvedValue([]),
  removeConflictRepoRecord: vi.fn().mockResolvedValue(undefined),
  syncConflictRepoRecords: vi.fn().mockResolvedValue([]),
  gitGetConflictFiles: vi.fn().mockResolvedValue([]),
}))

describe('TC-030: Git状态查看测试', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useGitStore.setState({ 
      repositories: [], 
      cachedRepositories: [], 
      activeRepository: null,
      conflictRepos: [],
      conflictFilesMap: {},
      isGitLoading: false,
      isPulling: false,
      scanProgress: null,
      syncStatus: { isSyncing: false, lastSyncTime: null, succeeded: 0, failed: 0, conflicted: 0 }
    })
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  const createTestRepo = (path: string, name: string, hasUncommitted: boolean = false): GitRepository => ({
    name,
    path,
    remoteUrl: 'https://github.com/test/repo.git',
    hasUncommittedChanges: hasUncommitted,
    uncommittedCount: hasUncommitted ? 3 : 0,
    currentBranch: 'main',
    isSubmodule: false,
    parentPath: null,
    status: 'normal',
  })

  const createTestRepoInfo = (path: string, name: string): GitRepositoryInfo => ({
    name,
    path,
    remote_url: 'https://github.com/test/repo.git',
    has_uncommitted_changes: false,
    uncommitted_count: 0,
    current_branch: 'main',
    is_submodule: false,
    parent_path: null,
  })

  it('TC-030-01: 映射仓库信息', () => {
    const info = createTestRepoInfo('/workspace/test', 'test')
    const repo = mapRepoInfoToRepository(info)
    
    expect(repo.name).toBe('test')
    expect(repo.path).toBe('/workspace/test')
    expect(repo.remoteUrl).toBe('https://github.com/test/repo.git')
    expect(repo.currentBranch).toBe('main')
    expect(repo.status).toBe('normal')
  })

  it('TC-030-02: 映射多个仓库信息去重', () => {
    const infos: GitRepositoryInfo[] = [
      createTestRepoInfo('/workspace/repo1', 'repo1'),
      createTestRepoInfo('/workspace/repo2', 'repo2'),
      createTestRepoInfo('/workspace/repo1', 'repo1'), // duplicate
    ]
    
    const repos = mapRepoInfosToRepositories(infos)
    
    expect(repos.length).toBe(2)
    expect(repos.map(r => r.name)).toEqual(['repo1', 'repo2'])
  })

  it('TC-030-03: 设置仓库列表', () => {
    const repos = [createTestRepo('/workspace/repo1', 'repo1')]
    
    useGitStore.getState().setRepositories(repos)
    
    const state = useGitStore.getState()
    expect(state.repositories.length).toBe(1)
    expect(state.repositories[0].name).toBe('repo1')
    expect(state.repositories[0].path).toBe('/workspace/repo1')
  })

  it('TC-030-04: 更新仓库状态', () => {
    const repos = [createTestRepo('/workspace/repo1', 'repo1')]
    useGitStore.getState().setRepositories(repos)
    
    expect(useGitStore.getState().repositories[0].status).toBe('normal')
    
    useGitStore.getState().updateRepository('/workspace/repo1', { status: 'conflict' })
    
    expect(useGitStore.getState().repositories[0].status).toBe('conflict')
  })

  it('TC-030-05: 选择活动仓库', () => {
    const repos = [createTestRepo('/workspace/repo1', 'repo1'), createTestRepo('/workspace/repo2', 'repo2')]
    useGitStore.getState().setRepositories(repos)
    
    expect(useGitStore.getState().activeRepository).toBeNull()
    
    useGitStore.getState().setActiveRepository('/workspace/repo1')
    
    expect(useGitStore.getState().activeRepository).toBe('/workspace/repo1')
  })

  it('TC-030-06: 检查未提交更改', () => {
    const repos = [
      createTestRepo('/workspace/repo1', 'repo1', true),
      createTestRepo('/workspace/repo2', 'repo2', false),
    ]
    useGitStore.getState().setRepositories(repos)
    
    const state = useGitStore.getState()
    expect(state.repositories[0].hasUncommittedChanges).toBe(true)
    expect(state.repositories[0].uncommittedCount).toBe(3)
    expect(state.repositories[1].hasUncommittedChanges).toBe(false)
    expect(state.repositories[1].uncommittedCount).toBe(0)
  })
})

describe('TC-031: Git提交测试', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useGitStore.setState({ 
      repositories: [], 
      cachedRepositories: [], 
      activeRepository: null,
      conflictRepos: [],
      conflictFilesMap: {},
      isGitLoading: false,
      isPulling: false,
      scanProgress: null,
      syncStatus: { isSyncing: false, lastSyncTime: null, succeeded: 0, failed: 0, conflicted: 0 }
    })
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('TC-031-01: 同步状态初始化', () => {
    const state = useGitStore.getState()
    expect(state.syncStatus.isSyncing).toBe(false)
    expect(state.syncStatus.lastSyncTime).toBeNull()
    expect(state.syncStatus.succeeded).toBe(0)
    expect(state.syncStatus.failed).toBe(0)
    expect(state.syncStatus.conflicted).toBe(0)
  })

  it('TC-031-02: 更新同步状态', () => {
    const store = useGitStore.getState()
    
    store.setSyncStatus({ isSyncing: true, succeeded: 2, failed: 1, conflicted: 0 })
    
    const state = useGitStore.getState()
    expect(state.syncStatus.isSyncing).toBe(true)
    expect(state.syncStatus.succeeded).toBe(2)
    expect(state.syncStatus.failed).toBe(1)
    expect(state.syncStatus.conflicted).toBe(0)
  })

  it('TC-031-03: 扫描进度设置', () => {
    const store = useGitStore.getState()
    
    store.setScanProgress({ current: 5, total: 10, message: 'Scanning...' })
    
    const state = useGitStore.getState()
    expect(state.scanProgress?.current).toBe(5)
    expect(state.scanProgress?.total).toBe(10)
    expect(state.scanProgress?.message).toBe('Scanning...')
  })

  it('TC-031-04: 清除扫描进度', () => {
    const store = useGitStore.getState()
    
    store.setScanProgress({ current: 5, total: 10, message: 'Scanning...' })
    expect(useGitStore.getState().scanProgress).not.toBeNull()
    
    store.clearScanProgress()
    
    expect(useGitStore.getState().scanProgress).toBeNull()
  })
})

describe('TC-032: 冲突解决测试', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useGitStore.setState({ 
      repositories: [], 
      cachedRepositories: [], 
      activeRepository: null,
      conflictRepos: [],
      conflictFilesMap: {},
      isGitLoading: false,
      isPulling: false,
      scanProgress: null,
      syncStatus: { isSyncing: false, lastSyncTime: null, succeeded: 0, failed: 0, conflicted: 0 }
    })
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('TC-032-01: 更新仓库状态（冲突）', () => {
    const repos = [{
      name: 'repo1',
      path: '/workspace/repo1',
      remoteUrl: 'https://github.com/test/repo1.git',
      hasUncommittedChanges: false,
      uncommittedCount: 0,
      currentBranch: 'main',
      isSubmodule: false,
      parentPath: null,
      status: 'normal',
    }]
    useGitStore.getState().setRepositories(repos)
    
    const pullResults = [{ path: '/workspace/repo1', name: 'repo1', success: false, error: 'REBASE_CONFLICT:', isConflict: true }]
    
    useGitStore.getState().updateRepositoryStatuses(pullResults)
    
    expect(useGitStore.getState().repositories[0].status).toBe('conflict')
  })

  it('TC-032-02: 更新仓库状态（错误）', () => {
    const repos = [{
      name: 'repo1',
      path: '/workspace/repo1',
      remoteUrl: 'https://github.com/test/repo1.git',
      hasUncommittedChanges: false,
      uncommittedCount: 0,
      currentBranch: 'main',
      isSubmodule: false,
      parentPath: null,
      status: 'normal',
    }]
    useGitStore.getState().setRepositories(repos)
    
    const pullResults = [{ path: '/workspace/repo1', name: 'repo1', success: false, error: 'Network error' }]
    
    useGitStore.getState().updateRepositoryStatuses(pullResults)
    
    expect(useGitStore.getState().repositories[0].status).toBe('error')
  })

  it('TC-032-03: 重置仓库状态', () => {
    const repos = [{
      name: 'repo1',
      path: '/workspace/repo1',
      remoteUrl: 'https://github.com/test/repo1.git',
      hasUncommittedChanges: false,
      uncommittedCount: 0,
      currentBranch: 'main',
      isSubmodule: false,
      parentPath: null,
      status: 'conflict' as RepoStatus,
    }]
    useGitStore.getState().setRepositories(repos)
    
    expect(useGitStore.getState().repositories[0].status).toBe('conflict')
    
    useGitStore.getState().resetRepositoryStatuses()
    
    expect(useGitStore.getState().repositories[0].status).toBe('normal')
  })

  it('TC-032-04: 检测冲突文件', () => {
    useGitStore.setState({
      conflictRepos: [{ repo_path: '/workspace/repo1', repo_name: 'repo1', conflict_file_count: 2 }],
      conflictFilesMap: { '/workspace/repo1': ['/workspace/repo1/file1.md', '/workspace/repo1/file2.md'] },
    })
    
    const result1 = useGitStore.getState().isConflictFile('/workspace/repo1/file1.md')
    expect(result1?.isConflict).toBe(true)
    expect(result1?.repoPath).toBe('/workspace/repo1')
    expect(result1?.repoName).toBe('repo1')
    
    const result2 = useGitStore.getState().isConflictFile('/workspace/repo1/normal.md')
    expect(result2).toBeNull()
  })
})

describe('TC-033: pullAllRepos 并发限流与防重入测试', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useGitStore.setState({
      repositories: [],
      cachedRepositories: [],
      activeRepository: null,
      conflictRepos: [],
      conflictFilesMap: {},
      isGitLoading: false,
      isPulling: false,
      scanProgress: null,
      syncStatus: { isSyncing: false, lastSyncTime: null, succeeded: 0, failed: 0, conflicted: 0 }
    })
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  const createTestRepo = (path: string, name: string): GitRepository => ({
    name,
    path,
    remoteUrl: 'https://github.com/test/repo.git',
    hasUncommittedChanges: false,
    uncommittedCount: 0,
    currentBranch: 'main',
    isSubmodule: false,
    parentPath: null,
    status: 'normal',
  })

  it('TC-033-01: pullAllRepos 并发限流（最多 4 个并发）', async () => {
    // 跟踪并发调用数和最大并发数
    let concurrentCalls = 0
    let maxConcurrent = 0
    vi.mocked(gitPull).mockImplementation(async () => {
      concurrentCalls++
      maxConcurrent = Math.max(maxConcurrent, concurrentCalls)
      // 模拟异步拉取延迟，确保批内并发可被观测
      await new Promise(resolve => setTimeout(resolve, 20))
      concurrentCalls--
    })

    // 创建 8 个仓库，验证最多 4 个并发
    const repos = Array.from({ length: 8 }, (_, i) =>
      createTestRepo(`/workspace/repo${i}`, `repo${i}`)
    )

    await useGitStore.getState().pullAllRepos(repos)

    expect(maxConcurrent).toBeLessThanOrEqual(4)
    expect(gitPull).toHaveBeenCalledTimes(8)
  })

  it('TC-033-02: pullAllRepos isPulling 防重入', async () => {
    // 预设 isPulling 为 true，模拟正在拉取中
    useGitStore.setState({ isPulling: true })

    const repos = [createTestRepo('/workspace/repo1', 'repo1')]
    const results = await useGitStore.getState().pullAllRepos(repos)

    // 应直接返回空数组，不调用 gitPull
    expect(results).toEqual([])
    expect(gitPull).not.toHaveBeenCalled()
  })
})

describe('TC-035: pullAllRepos 错误分类 characterization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useGitStore.setState({
      repositories: [],
      cachedRepositories: [],
      activeRepository: null,
      conflictRepos: [],
      conflictFilesMap: {},
      isGitLoading: false,
      isPulling: false,
      scanProgress: null,
      syncStatus: { isSyncing: false, lastSyncTime: null, succeeded: 0, failed: 0, conflicted: 0 }
    })
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  const createTestRepo = (path: string, name: string): GitRepository => ({
    name,
    path,
    remoteUrl: 'https://github.com/test/repo.git',
    hasUncommittedChanges: false,
    uncommittedCount: 0,
    currentBranch: 'main',
    isSubmodule: false,
    parentPath: null,
    status: 'normal',
  })

  it('TC-035-01: AUTH_REQUIRED 无凭证 → success:false, error 含 AUTH_REQUIRED', async () => {
    vi.mocked(gitPull).mockRejectedValueOnce('AUTH_REQUIRED:fatal: could not read Username')
    vi.mocked(gitCredentialGet).mockResolvedValue(null)

    const repos = [createTestRepo('/ws/repo1', 'repo1')]
    const results = await useGitStore.getState().pullAllRepos(repos)

    expect(results).toHaveLength(1)
    expect(results[0].success).toBe(false)
    expect(results[0].error).toContain('AUTH_REQUIRED')
    expect(results[0].isConflict).toBeUndefined()
    expect(results[0].isDetachedHead).toBeUndefined()
  })

  it('TC-035-02: AUTH_REQUIRED + 凭证成功 → success:true', async () => {
    vi.mocked(gitPull).mockRejectedValueOnce('AUTH_REQUIRED:fatal: could not read Username')
    vi.mocked(gitCredentialGet).mockResolvedValue({ username: 'u', password: 'p' } as any)
    vi.mocked(gitPullWithCredentials).mockResolvedValueOnce(undefined)

    const repos = [createTestRepo('/ws/repo1', 'repo1')]
    const results = await useGitStore.getState().pullAllRepos(repos)

    expect(results).toHaveLength(1)
    expect(results[0].success).toBe(true)
    expect(gitPullWithCredentials).toHaveBeenCalledWith('/ws/repo1', 'u', 'p')
  })

  it('TC-035-03: AUTH_REQUIRED + 凭证拉取 REBASE_CONFLICT → isConflict:true', async () => {
    vi.mocked(gitPull).mockRejectedValueOnce('AUTH_REQUIRED:fatal: could not read Username')
    vi.mocked(gitCredentialGet).mockResolvedValue({ username: 'u', password: 'p' } as any)
    vi.mocked(gitPullWithCredentials).mockRejectedValueOnce('REBASE_CONFLICT:CONFLICT in file')

    const repos = [createTestRepo('/ws/repo1', 'repo1')]
    const results = await useGitStore.getState().pullAllRepos(repos)

    expect(results).toHaveLength(1)
    expect(results[0].success).toBe(false)
    expect(results[0].isConflict).toBe(true)
    expect(results[0].error).toContain('REBASE_CONFLICT')
  })

  it('TC-035-04: REBASE_CONFLICT → isConflict:true', async () => {
    vi.mocked(gitPull).mockRejectedValueOnce('REBASE_CONFLICT:merge conflict in file.txt')

    const repos = [createTestRepo('/ws/repo1', 'repo1')]
    const results = await useGitStore.getState().pullAllRepos(repos)

    expect(results).toHaveLength(1)
    expect(results[0].success).toBe(false)
    expect(results[0].isConflict).toBe(true)
  })

  it('TC-035-05: DETACHED_HEAD → isDetachedHead:true', async () => {
    vi.mocked(gitPull).mockRejectedValueOnce('DETACHED_HEAD:HEAD is detached')

    const repos = [createTestRepo('/ws/repo1', 'repo1')]
    const results = await useGitStore.getState().pullAllRepos(repos)

    expect(results).toHaveLength(1)
    expect(results[0].success).toBe(false)
    expect(results[0].isDetachedHead).toBe(true)
  })

  it('TC-035-06: 其他错误 → success:false, 无特殊标志', async () => {
    vi.mocked(gitPull).mockRejectedValueOnce('fatal: network error')

    const repos = [createTestRepo('/ws/repo1', 'repo1')]
    const results = await useGitStore.getState().pullAllRepos(repos)

    expect(results).toHaveLength(1)
    expect(results[0].success).toBe(false)
    expect(results[0].error).toBe('fatal: network error')
    expect(results[0].isConflict).toBeUndefined()
    expect(results[0].isDetachedHead).toBeUndefined()
  })
})

describe('TC-034: isConflictFile 边界场景测试', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useGitStore.setState({
      repositories: [],
      cachedRepositories: [],
      activeRepository: null,
      conflictRepos: [],
      conflictFilesMap: {},
      isGitLoading: false,
      isPulling: false,
      scanProgress: null,
      syncStatus: { isSyncing: false, lastSyncTime: null, succeeded: 0, failed: 0, conflicted: 0 }
    })
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('TC-034-01: 多冲突仓库场景下正确匹配', () => {
    useGitStore.setState({
      conflictRepos: [
        { repo_path: '/workspace/repo1', repo_name: 'repo1', conflict_file_count: 1 },
        { repo_path: '/workspace/repo2', repo_name: 'repo2', conflict_file_count: 1 },
      ],
      conflictFilesMap: {
        '/workspace/repo1': ['/workspace/repo1/file1.md'],
        '/workspace/repo2': ['/workspace/repo2/file2.md'],
      },
    })

    // repo1 的冲突文件
    const r1 = useGitStore.getState().isConflictFile('/workspace/repo1/file1.md')
    expect(r1?.repoPath).toBe('/workspace/repo1')
    expect(r1?.repoName).toBe('repo1')

    // repo2 的冲突文件
    const r2 = useGitStore.getState().isConflictFile('/workspace/repo2/file2.md')
    expect(r2?.repoPath).toBe('/workspace/repo2')
    expect(r2?.repoName).toBe('repo2')

    // 不在任何冲突仓库中的文件
    expect(useGitStore.getState().isConflictFile('/workspace/repo3/file.md')).toBeNull()
  })

  it('TC-034-02: 空冲突映射返回 null', () => {
    useGitStore.setState({
      conflictRepos: [],
      conflictFilesMap: {},
    })

    expect(useGitStore.getState().isConflictFile('/workspace/repo1/file1.md')).toBeNull()
  })

  it('TC-034-03: 部分路径匹配不算冲突', () => {
    useGitStore.setState({
      conflictRepos: [{ repo_path: '/workspace/repo1', repo_name: 'repo1', conflict_file_count: 1 }],
      conflictFilesMap: { '/workspace/repo1': ['/workspace/repo1/file1.md'] },
    })

    // 路径前缀相似但不是完整路径匹配
    expect(useGitStore.getState().isConflictFile('/workspace/repo1/file1.md.bak')).toBeNull()
    expect(useGitStore.getState().isConflictFile('/workspace/repo1/file1')).toBeNull()
  })
})
