// 国际化 i18n Store
import { writable, derived } from 'svelte/store';

type Translations = Record<string, string>;

const zhCN: Record<string, Translations> = {
  welcome: {
    title: '欢迎使用 SwallowNote',
    subtitle: '一个快速、轻量的 Markdown 笔记应用',
    openFolder: '打开文件夹',
    searchFiles: '搜索文件',
    saveFile: '保存文件',
  },
  fileTree: {
    explorer: '文件浏览器',
    noWorkspace: '未打开工作区',
    emptyDir: '空目录',
    hint: '打开文件夹以开始使用',
    loading: '加载中...',
  },
  editor: {
    edit: '编辑',
    preview: '预览',
    split: '分屏',
    switch: '切换',
    emptyPreview: '打开一个 Markdown 文件查看预览',
  },
  search: {
    placeholder: '搜索文件...',
    noResults: '未找到匹配的文件',
    files: '个文件',
  },
  git: {
    title: '版本控制',
    init: '初始化 Git 仓库',
    notInit: '未初始化 Git',
    changes: '更改',
    staged: '暂存区',
    noChanges: '没有更改',
    commit: '提交',
    commitPlaceholder: '输入提交信息...',
    branch: '分支',
    initSuccess: 'Git 仓库初始化成功',
    commitSuccess: '提交成功',
    initError: '初始化仓库失败',
    commitError: '提交失败',
    statusError: '获取状态失败',
  },
  settings: {
    title: '设置',
    language: '语言',
    close: '关闭',
    editor: '编辑器',
    appearance: '外观',
  },
  tabs: {
    close: '关闭标签',
    save: '保存',
    unsavedConfirm: '文件未保存，是否关闭？',
    maxTabs: '已达到最大标签数限制（50 个），请关闭一些标签。',
  },
};

const enUS: Record<string, Translations> = {
  welcome: {
    title: 'Welcome to SwallowNote',
    subtitle: 'A fast, lightweight Markdown note-taking app',
    openFolder: 'Open Folder',
    searchFiles: 'Search files',
    saveFile: 'Save file',
  },
  fileTree: {
    explorer: 'Explorer',
    noWorkspace: 'No workspace opened',
    emptyDir: 'Empty directory',
    hint: 'Open a folder to start',
    loading: 'Loading...',
  },
  editor: {
    edit: 'Edit',
    preview: 'Preview',
    split: 'Split',
    switch: 'Switch',
    emptyPreview: 'Open a Markdown file to preview',
  },
  search: {
    placeholder: 'Search files...',
    noResults: 'No files found',
    files: 'files',
  },
  git: {
    title: 'Source Control',
    init: 'Initialize Git Repository',
    notInit: 'Not initialized',
    changes: 'Changes',
    staged: 'Staged',
    noChanges: 'No changes',
    commit: 'Commit',
    commitPlaceholder: 'Enter commit message...',
    branch: 'Branch',
    initSuccess: 'Git repository initialized',
    commitSuccess: 'Commit successful',
    initError: 'Failed to initialize repository',
    commitError: 'Commit failed',
    statusError: 'Failed to get status',
  },
  settings: {
    title: 'Settings',
    language: 'Language',
    close: 'Close',
    editor: 'Editor',
    appearance: 'Appearance',
  },
  tabs: {
    close: 'Close tab',
    save: 'Save',
    unsavedConfirm: 'File has unsaved changes. Close anyway?',
    maxTabs: 'Maximum number of tabs reached (50). Please close some tabs.',
  },
};

const translations: Record<string, Record<string, Translations>> = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

function getSavedLang(): string {
  try {
    const saved = localStorage.getItem('swallownote-lang');
    if (saved && (saved === 'zh-CN' || saved === 'en-US')) return saved;
  } catch {}
  return navigator.language.startsWith('zh') ? 'zh-CN' : 'en-US';
}

export const currentLang = writable<string>(getSavedLang());

currentLang.subscribe((lang) => {
  try {
    localStorage.setItem('swallownote-lang', lang);
  } catch {}
});

export function setLanguage(lang: string) {
  currentLang.set(lang);
}

// Lookup translation for a dot-notation key (e.g. "welcome.title")
function lookup(lang: string, key: string): string {
  const keys = key.split('.');
  let result: any = translations[lang];
  for (const k of keys) {
    if (result) result = result[k];
  }
  return typeof result === 'string' ? result : key;
}

// Derived store that returns a translation function bound to the current language
export const t = derived(currentLang, ($lang) => (key: string) => lookup($lang, key));

// Convenience: also export a createT function for components that use $state
export function createT() {
  let lang = 'zh-CN';
  currentLang.subscribe((v) => (lang = v))();
  return (key: string): string => lookup(lang, key);
}
