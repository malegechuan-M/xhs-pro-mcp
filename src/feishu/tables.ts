/**
 * Field name helpers — reads from config.feishu.fields so the mapping is
 * driven entirely by feishu.json without any code changes.
 *
 * Usage:
 *   f('采集库', 'noteId')  →  '笔记ID'  (or whatever the user renamed it to)
 */

import { config } from '../config/index.js';

export type TableName = keyof typeof config.feishu.tables;

/** Resolve a field's Feishu column name from the config. */
export function f(table: TableName, key: string): string {
  const map = config.feishu.fields[table] as Record<string, string> | undefined;
  return map?.[key] ?? key; // fallback: use the key itself
}

/** Shorthand getters for table IDs */
export const tableId = (name: TableName): string => config.feishu.tables[name];
export const appToken = (): string => config.feishu.appToken;
