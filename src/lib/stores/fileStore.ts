import { writable, get } from 'svelte/store';
import { FileService } from '../services/fileService';
import type { FileNode, Tab } from '../types/file';

// Workspace root path
export const rootPath = writable<string | null>(null);

// File tree cache
export const treeCache = writable<Map<string, FileNode[]>>(new Map());

// Expanded directory nodes
export const expandedNodes = writable<Set<string>>(new Set());

// Selected file node
export const selectedNode = writable<FileNode | null>(null);

// Open tabs
export const tabs = writable<Tab[]>([]);
export const activeTabId = writable<string | null>(null);

/**
 * Set workspace root and load initial directory
 */
export async function setRootPath(path: string) {
  rootPath.set(path);
  treeCache.set(new Map());
  expandedNodes.set(new Set());
  tabs.set([]);
  activeTabId.set(null);

  // 并行执行：加载目录、监听目录、检查 Git 状态
  await Promise.all([
    (async () => {
      const { checkGitStatus } = await import('./gitStore');
      await checkGitStatus(path);
    })(),
    loadDirectory(path),
    FileService.watchDirectory(path)
  ]);
}

/**
 * Load directory contents (with caching)
 */
export async function loadDirectory(path: string): Promise<FileNode[]> {
  let cache: Map<string, FileNode[]>;
  treeCache.subscribe(value => cache = value)();

  if (cache!.has(path)) {
    return cache!.get(path)!;
  }

  const nodes = await FileService.listDirectory(path);
  cache!.set(path, nodes);
  treeCache.set(cache!);
  return nodes;
}

/**
 * Toggle directory expansion
 */
export async function toggleNode(nodeId: string, nodePath: string) {
  let expanded: Set<string>;
  expandedNodes.subscribe(value => expanded = value)();

  if (expanded!.has(nodeId)) {
    expanded!.delete(nodeId);
  } else {
    expanded!.add(nodeId);
    // Load children if not cached
    await loadDirectory(nodePath);
  }

  expandedNodes.set(expanded!);
}

/**
 * Select a file node
 */
export function selectNode(node: FileNode) {
  selectedNode.set(node);

  if (!node.is_directory) {
    openFile(node);
  }
}

// Helper function to find node by path in a list
function findNodeInList(nodes: FileNode[], path: string): FileNode | null {
  for (const node of nodes) {
    if (node.path === path) return node;
    if (node.children) {
      const found = findNodeInList(node.children, path);
      if (found) return found;
    }
  }
  return null;
}

// Helper function to expand all directories in a path
async function expandPathToFile(filePath: string) {
  let root = get(rootPath);
  if (!root) return;

  // Build list of parent directories to expand
  const relativePath = filePath.substring(root.length + 1);
  const parts = relativePath.split('/');
  let currentPath = root;

  // Expand each parent directory in sequence
  for (let i = 0; i < parts.length - 1; i++) {
    currentPath = currentPath + '/' + parts[i];

    // Load directory if not cached
    let cache: Map<string, FileNode[]>;
    treeCache.subscribe(value => cache = value)();

    if (!cache!.has(currentPath)) {
      await loadDirectory(currentPath);
      // Re-subscribe to get updated cache
      treeCache.subscribe(value => cache = value)();
    }

    // Get the directory node to find its id
    const nodes = cache!.get(currentPath) || [];
    const dirNode = nodes.find(n => n.path === currentPath);
    if (dirNode) {
      // Expand this directory
      expandedNodes.update(set => {
        set.add(dirNode.id);
        return set;
      });
    }
  }
}

/**
 * Select a node by its file path (expanding parent directories as needed)
 */
export async function selectNodeByPath(filePath: string) {
  // First expand all parent directories so the file becomes visible
  await expandPathToFile(filePath);

  // Re-get cache after expanding directories
  let cache: Map<string, FileNode[]>;
  treeCache.subscribe(value => cache = value)();

  // Search through all cached directories
  for (const [, nodes] of cache!) {
    const found = findNodeInList(nodes, filePath);
    if (found) {
      selectedNode.set(found);
      return;
    }
  }

  // If still not found, try to load the parent directory
  const parentPath = filePath.substring(0, filePath.lastIndexOf('/'));
  if (parentPath) {
    const nodes = await loadDirectory(parentPath);
    const found = findNodeInList(nodes, filePath);
    if (found) {
      selectedNode.set(found);
    }
  }
}

/**
 * Open a file in a new tab
 */
export async function openFile(node: FileNode) {
  let currentTabs: Tab[];
  tabs.subscribe(value => currentTabs = value)();

  // Check if already open
  const existingTab = currentTabs!.find(t => t.fileId === node.path);
  if (existingTab) {
    // Update both activeTabId and tabs array to keep them in sync
    const updatedTabs = currentTabs!.map(t => ({ ...t, active: t.id === existingTab.id }));
    tabs.set(updatedTabs);
    activeTabId.set(existingTab.id);
    // Also select the node in file tree
    selectNode(node);
    return;
  }

  // Check max tabs limit
  if (currentTabs!.length >= 50) {
    alert('Maximum number of tabs reached (50). Please close some tabs.');
    return;
  }

  // Read file content
  const content = await FileService.readFile(node.path);

  const newTab: Tab = {
    id: crypto.randomUUID(),
    fileId: node.path,
    title: node.name,
    content,
    dirty: false,
    active: true,
  };

  // Deactivate other tabs
  const updatedTabs = currentTabs!.map(t => ({ ...t, active: false }));
  updatedTabs.push(newTab);

  tabs.set(updatedTabs);
  activeTabId.set(newTab.id);
}

// Recently closed tabs (for Ctrl+Shift+T restore)
let closedTabHistory: string[] = [];

/**
 * Close a tab
 */
export function closeTab(tabId: string) {
  let currentTabs: Tab[];
  tabs.subscribe(value => currentTabs = value)();
  let currentActiveId = get(activeTabId);

  const tab = currentTabs!.find(t => t.id === tabId);
  if (!tab) return;

  // Save to history before closing
  closedTabHistory.push(tabId);

  const index = currentTabs!.findIndex(t => t.id === tabId);
  const updatedTabs = currentTabs!.filter(t => t.id !== tabId);

  // Activate another tab if this was active
  let newActiveId = currentActiveId;
  if (currentActiveId === tabId) {
    if (updatedTabs.length > 0) {
      const newIndex = Math.min(index, updatedTabs.length - 1);
      updatedTabs[newIndex].active = true;
      newActiveId = updatedTabs[newIndex].id;
    } else {
      newActiveId = null;
    }
  }

  tabs.set(updatedTabs);
  activeTabId.set(newActiveId);
}

/**
 * Restore the last closed tab
 */
export function restoreClosedTab() {
  const lastId = closedTabHistory.pop();
  if (!lastId) return;
  // Reload from file system - this is a simplified restore
  // Full restore would need to store tab content
  console.info('Restore tab:', lastId);
}

/**
 * Switch to next tab
 */
export function nextTab() {
  let currentTabs: Tab[];
  tabs.subscribe(value => currentTabs = value)();
  let currentActiveId = get(activeTabId);
  if (currentTabs!.length < 2) return;
  const idx = currentTabs!.findIndex(t => t.id === currentActiveId);
  const nextIdx = (idx + 1) % currentTabs!.length;
  const updatedTabs = currentTabs!.map(t => ({ ...t, active: t.id === currentTabs![nextIdx].id }));
  tabs.set(updatedTabs);
  activeTabId.set(currentTabs![nextIdx].id);
}

/**
 * Switch to previous tab
 */
export function prevTab() {
  let currentTabs: Tab[];
  tabs.subscribe(value => currentTabs = value)();
  let currentActiveId = get(activeTabId);
  if (currentTabs!.length < 2) return;
  const idx = currentTabs!.findIndex(t => t.id === currentActiveId);
  const prevIdx = (idx - 1 + currentTabs!.length) % currentTabs!.length;
  const updatedTabs = currentTabs!.map(t => ({ ...t, active: t.id === currentTabs![prevIdx].id }));
  tabs.set(updatedTabs);
  activeTabId.set(currentTabs![prevIdx].id);
}

/**
 * Update tab content
 */
export function updateTabContent(tabId: string, content: string) {
  let currentTabs: Tab[];
  tabs.subscribe(value => currentTabs = value)();

  const updatedTabs = currentTabs!.map(t =>
    t.id === tabId ? { ...t, content, dirty: true } : t
  );

  tabs.set(updatedTabs);
}

/**
 * Save current tab
 */
export async function saveTab(tabId: string) {
  let currentTabs: Tab[];
  tabs.subscribe(value => currentTabs = value)();

  const tab = currentTabs!.find(t => t.id === tabId);
  if (!tab) return;

  await FileService.writeFile(tab.fileId, tab.content);

  const updatedTabs = currentTabs!.map(t =>
    t.id === tabId ? { ...t, dirty: false } : t
  );

  tabs.set(updatedTabs);
}

/**
 * Refresh directory (clear cache and reload)
 */
export async function refreshDirectory(path: string) {
  let cache: Map<string, FileNode[]>;
  treeCache.subscribe(value => cache = value)();

  cache!.delete(path);
  treeCache.set(cache!);
  await loadDirectory(path);
}

/**
 * Handle file system change event
 */
export async function onFileChanged(changedPath: string) {
  let cache: Map<string, FileNode[]>;
  treeCache.subscribe(value => cache = value)();

  // Find which cached directory contains this path
  for (const [dirPath] of cache!) {
    if (changedPath.startsWith(dirPath)) {
      await refreshDirectory(dirPath);
      break;
    }
  }
}
