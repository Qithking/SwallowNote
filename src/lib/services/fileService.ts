import { invoke } from '@tauri-apps/api/core';
import type { FileNode, CreateFileRequest, RenameFileRequest } from '../types/file';

export class FileService {
  /**
   * List directory contents
   */
  static async listDirectory(path: string): Promise<FileNode[]> {
    return await invoke<FileNode[]>('list_directory', { path });
  }

  /**
   * Read file content
   */
  static async readFile(path: string): Promise<string> {
    return await invoke<string>('read_file', { path });
  }

  /**
   * Write content to file (atomic write)
   */
  static async writeFile(path: string, content: string): Promise<void> {
    await invoke('write_file', { path, content });
  }

  /**
   * Create a new file or directory
   */
  static async createFile(req: CreateFileRequest): Promise<string> {
    return await invoke<string>('create_file', { req });
  }

  /**
   * Delete a file or directory
   */
  static async deleteFile(path: string): Promise<void> {
    await invoke('delete_file', { path });
  }

  /**
   * Rename a file or directory
   */
  static async renameFile(req: RenameFileRequest): Promise<void> {
    await invoke('rename_file', { req });
  }

  /**
   * Start watching a directory for changes
   */
  static async watchDirectory(path: string): Promise<void> {
    await invoke('watch_directory', { path });
  }

  /**
   * Stop watching a directory
   */
  static async unwatchDirectory(path: string): Promise<void> {
    await invoke('unwatch_directory', { path });
  }
}
