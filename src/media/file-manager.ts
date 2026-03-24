import { readdirSync, statSync, unlinkSync, mkdirSync, existsSync } from 'fs';
import { resolve, extname } from 'path';
import { config } from '../config/index.js';

export interface FileInfo {
  name: string;
  path: string;
  size: number;
  ext: string;
  createdAt: Date;
}

export function listDownloads(subDir: string = ''): FileInfo[] {
  const dir = subDir
    ? resolve(config.downloadsDir, subDir)
    : config.downloadsDir;
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((f) => !f.startsWith('.'))
    .map((name) => {
      const filePath = resolve(dir, name);
      const stat = statSync(filePath);
      return {
        name,
        path: filePath,
        size: stat.size,
        ext: extname(name).toLowerCase(),
        createdAt: stat.birthtime,
      };
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export function cleanOldFiles(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): number {
  const files = listDownloads();
  const cutoff = Date.now() - maxAgeMs;
  let deleted = 0;
  for (const f of files) {
    if (f.createdAt.getTime() < cutoff) {
      unlinkSync(f.path);
      deleted++;
    }
  }
  return deleted;
}

export function ensureDownloadDir(subDir?: string): string {
  const dir = subDir
    ? resolve(config.downloadsDir, subDir)
    : config.downloadsDir;
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function getTotalSize(subDir: string = ''): number {
  return listDownloads(subDir).reduce((sum, f) => sum + f.size, 0);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
