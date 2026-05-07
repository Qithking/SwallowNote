export interface FileNode {
  id: string;
  name: string;
  path: string;
  is_directory: boolean;
  children?: FileNode[];
}

export interface CreateFileRequest {
  path: string;
  is_directory: boolean;
}

export interface RenameFileRequest {
  old_path: string;
  new_path: string;
}

export type ViewMode = 'source' | 'preview' | 'split';

export interface Tab {
  id: string;
  fileId: string;
  title: string;
  content: string;
  dirty: boolean;
  active: boolean;
}
