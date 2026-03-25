---
name: xhs-pro-mcp
description: >
  小红书专业版 MCP 服务 - 数据采集与飞书同步。
  用于：(1) 关键词/博主/笔记数据采集，(2) 图片视频下载，(3) 飞书多维表格同步，(4) 笔记发布与互动。
  触发词：小红书采集、小红书同步、飞书同步、xhs采集。
---

# xhs-pro-mcp - 小红书专业版 MCP 服务

> 基于 Playwright 浏览器 + MCP 协议的专业小红书数据采集服务 | v2.0.0

## 1. 启动服务

```bash
cd ~/.openclaw/skills/xhs-pro-mcp
npm run dev
```

## 2. 首次设置（引导向导）

调用 `xhs_setup` 工具，会自动检查并配置飞书凭证和表格。

```typescript
xhs_setup({
  feishu_app_id?: string,        // 飞书 App ID
  feishu_app_secret?: string,    // 飞书 App Secret
  feishu_app_token?: string,     // 多维表格 Base Token
  login_timeout?: number          // 登录超时（秒）
})
```

## 3. 全部工具（共23个）

### 系统工具（4个）
| 工具 | 功能 | 参数 |
|------|------|------|
| `xhs_login` | 打开浏览器扫码登录 | timeoutSeconds? |
| `xhs_logout` | 登出并清除会话 | - |
| `xhs_check_status` | 检查登录状态/飞书连接/存储统计 | - |
| `xhs_setup` | 首次设置引导向导 | 飞书凭证等 |

### 采集工具（8个）
| 工具 | 功能 | 参数 |
|------|------|------|
| `xhs_capture_note` | 采集单篇笔记详情 | url, syncToFeishu?, downloadMedia? |
| `xhs_search_notes` | 关键词搜索笔记 | keyword, maxResults?, sortMode?, captureDetails?, syncToFeishu? |
| `xhs_capture_blogger_notes` | 采集博主所有笔记 | profileUrl, limit?, syncToFeishu? |
| `xhs_capture_blogger_info` | 采集博主信息 | profileUrl, syncToFeishu? |
| `xhs_capture_comments` | 采集笔记评论列表 | noteId, limit?, includeReplies? |
| `xhs_batch_capture_notes` | 批量采集多篇笔记 | urls, syncToFeishu?, downloadMedia? |
| `xhs_get_feeds` | 获取首页推荐流 | limit? |
| `xhs_list_downloads` | 查看已下载文件 | subDir? |

### 编排工具（1个）
| 工具 | 功能 | 参数 |
|------|------|------|
| `xhs_capture_and_sync` | 采集+下载+同步+上传一键完成 | type, target, limit?, downloadImages?, syncToFeishu?, uploadAttachments? |

### 飞书工具（3个）
| 工具 | 功能 | 参数 |
|------|------|------|
| `xhs_test_feishu` | 测试飞书连接 | - |
| `xhs_upload_images_to_feishu` | 上传图片到飞书附件 | localFilePaths, tableId, recordId, fieldId |

### 互动工具（4个）
| 工具 | 功能 | 参数 |
|------|------|------|
| `xhs_like_note` | 点赞/取消点赞 | noteId, cancel? |
| `xhs_favorite_note` | 收藏/取消收藏 | noteId, cancel? |
| `xhs_comment_note` | 评论笔记 | noteId, content |
| `xhs_reply_comment` | 回复评论 | noteId, commentIndex?, content |

### 发布工具（2个）
| 工具 | 功能 | 参数 |
|------|------|------|
| `xhs_publish_note` | 发布图文笔记 | title, content, ImagePaths, tags?, visibility? |
| `xhs_publish_video` | 发布视频笔记 | videoPath, title, content?, tags?, visibility? |

### 媒体工具（2个）
| 工具 | 功能 | 参数 |
|------|------|------|
| `xhs_download_images` | 下载笔记图片 | imageUrls, noteId, noteTitle |
| `xhs_download_video` | 下载笔记视频 | videoUrl, noteId |

---

## 4. 目录结构

```
~/.xhs-pro-mcp/
├── chrome-profile/    # Chrome 持久化配置（自动创建）
├── cookies/           # Cookie 存储
├── downloads/          # 媒体下载目录
└── server.log         # 服务日志
```

---

*xhs-pro-mcp v2.0.0 | 2026-03-20*
