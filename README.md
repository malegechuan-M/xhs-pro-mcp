# xhs-pro-mcp

基于 Playwright 浏览器 + MCP 协议的小红书数据采集服务，支持飞书多维表格同步。

## 功能

- **数据采集** — 关键词搜索、单篇/批量笔记采集、博主信息与笔记采集、首页推荐流
- **媒体下载** — 笔记图片、视频下载与管理
- **飞书同步** — 采集数据自动写入飞书多维表格，支持附件上传
- **互动操作** — 点赞、收藏、评论、回复
- **内容发布** — 发布图文/视频笔记

## 安装

```bash
git clone https://github.com/malegechuan-M/xhs-pro-mcp.git
cd xhs-pro-mcp
npm install
npx playwright install chromium
```

## 配置

复制示例配置并填入你的飞书凭证：

```bash
cp config/feishu.example.json config/feishu.json
```

编辑 `config/feishu.json`，填写：

| 字段 | 说明 |
|------|------|
| `appId` | 飞书自建应用 App ID |
| `appSecret` | 飞书自建应用 App Secret |
| `appToken` | 飞书多维表格 App Token |
| `tables` | 各数据表的 Table ID |

也可以通过环境变量配置：`FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_APP_TOKEN`。

## 启动

```bash
# 开发模式
npm run dev

# 编译后运行
npm run build
npm start
```

## 使用

启动后调用 `xhs_setup` 工具完成首次设置，然后调用 `xhs_login` 扫码登录小红书。

### 工具一览（22个）

| 分类 | 工具 | 功能 |
|------|------|------|
| 系统 | `xhs_login` | 扫码登录 |
| | `xhs_logout` | 登出 |
| | `xhs_check_status` | 检查状态 |
| | `xhs_setup` | 首次设置向导 |
| 采集 | `xhs_capture_note` | 采集单篇笔记 |
| | `xhs_search_notes` | 关键词搜索 |
| | `xhs_capture_blogger_notes` | 采集博主笔记 |
| | `xhs_capture_blogger_info` | 采集博主信息 |
| | `xhs_batch_capture_notes` | 批量采集笔记 |
| | `xhs_get_feeds` | 获取推荐流 |
| | `xhs_list_downloads` | 查看下载文件 |
| 编排 | `xhs_capture_and_sync` | 采集+下载+同步一键完成 |
| 飞书 | `xhs_test_feishu` | 测试飞书连接 |
| | `xhs_upload_images_to_feishu` | 上传图片到飞书 |
| 互动 | `xhs_like_note` | 点赞/取消 |
| | `xhs_favorite_note` | 收藏/取消 |
| | `xhs_comment_note` | 评论 |
| | `xhs_reply_comment` | 回复评论 |
| 发布 | `xhs_publish_note` | 发布图文笔记 |
| | `xhs_publish_video` | 发布视频笔记 |
| 媒体 | `xhs_download_images` | 下载图片 |
| | `xhs_download_video` | 下载视频 |

## 数据目录

运行时数据存储在 `~/.xhs-pro-mcp/`：

```
~/.xhs-pro-mcp/
├── chrome-profile/    # 浏览器持久化配置
├── downloads/         # 媒体下载目录
└── server.log         # 服务日志
```

## 技术栈

- [MCP SDK](https://github.com/modelcontextprotocol/sdk) — Model Context Protocol
- [Playwright](https://playwright.dev/) — 浏览器自动化
- TypeScript + Zod

## License

MIT
