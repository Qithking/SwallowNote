import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useGitStore, mapRepoInfoToRepository, mapRepoInfosToRepositories, type GitRepository, type GitRepositoryInfo, type RepoStatus } from '@/stores/git'

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
    branches: [],
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
      branches: [],
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
      branches: [],
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
      branches: [],
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
