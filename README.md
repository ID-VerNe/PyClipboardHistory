# PyClipboardHistory (Refactored to Electron)

这是一个重构后的剪贴板历史管理器，原本使用 Python + pywebview 开发，现在完全迁移到了 **React + Electron (Vite) + Tailwind CSS**.

## 核心特性

- **跨平台支持**：基于 Electron，支持 Windows (目前优化最好)。
- **现代 UI**：使用 React 和 Tailwind CSS 构建，支持暗色模式（跟随系统）。
- **剪贴板监控**：自动保存文本和图片。轮询使用廉价的尺寸 fast-path 跳过未变化内容，避免每秒重复分配大缓冲区。
- **全文搜索**：基于 SQLite FTS5 的内容/预览全文索引，搜索走索引而非 `LIKE` 全表扫。
- **图片预览**：自动生成 WebP 缩略图（200px），在 worker 线程处理，主线程不阻塞。通过自定义 `local-file://` 协议从磁盘流式加载，带字节上限的 LRU 缓存。
- **虚拟化列表**：使用 `@tanstack/react-virtual` 渲染历史，即使上万条也只挂载可见行。
- **全局快捷键**：`Ctrl + Alt + V` 快速唤起。
- **跟随鼠标**：窗口在鼠标位置弹出，即用即走。

## 技术栈

- **前端**: React, Tailwind CSS, Lucide Icons, @tanstack/react-virtual
- **后端 (Main Process)**: Electron, better-sqlite3 (高性能数据库，WAL 模式), sharp (极速图像处理，跑在 worker_threads)
- **构建工具**: electron-vite, pnpm (hoisted linker)

## 数据存储位置

数据**不再放在可执行文件同目录**，而是统一存到用户主目录下的 `~/.pyclipboard-history/`（即 `C:\Users\<你>\.pyclipboard-history`），dev 和 packaged 共用同一位置。

好处：重新打包 / 重装 / 升级 exe 都不会丢历史数据。首次运行新版本时，会自动把旧位置（exe 同目录的 `storage/`）的数据一次性迁移到新位置。

目录结构：
```
~/.pyclipboard-history/
└── storage/
    ├── clipboard.db          # SQLite 数据库 (WAL 模式)
    ├── clipboard.db-wal     # WAL 日志
    ├── settings.json        # (已移除 AI 设置，此文件不再生成)
    └── images/
        ├── img_*.png         # 原图 (PNG 保真)
        └── thumbnails/
            └── thumb_*.webp # 缩略图 (WebP, 200px)
```

## 性能要点

- **数据库**: `journal_mode=WAL` + `synchronous=NORMAL` + 内存临时表 + 20MB 页缓存 + 64MB mmap。预编译语句只在模块作用域 prepare 一次。查询投影所需列，不 `SELECT *`。组合索引 `(is_favorite, timestamp DESC)` / `(data_type, timestamp DESC)`。
- **主进程不抢资源**: 不再设置 `PRIORITY_HIGH`、不再禁止系统休眠、不再关闭后台节流。剪贴板管理器空闲时不该抢 CPU。
- **生命周期清理**: 退出时 `will-quit` 异步清理 setInterval、关闭 DB、销毁托盘、terminate worker，进程干净退出。单实例锁防止多开。
- **一次性优化**: 首次运行新版本时跑一次（写 `.optimized_v1` flag，不再重跑）：重建 FTS 索引、清空无用的 `preview_base64` 列、删除磁盘上无 DB 行引用的孤儿图片文件。

## 开始使用

### 开发环境

1. 确保已安装 [Node.js](https://nodejs.org/) (>=18)。
2. 安装 pnpm: `npm install -g pnpm`
3. 安装依赖: `pnpm install`
4. 运行开发服务器: `pnpm run dev`

### 生产打包

```bash
pnpm run build    # 仅构建输出 (out/)
pnpm run package  # 构建并打包为可移植可执行文件 (dist/PyClipboardHistory_Portable.exe)
```

> **关于 pnpm linker**: 本项目 `.npmrc` 设了 `node-linker=hoisted`。这是必须的——electron-builder 打包 asar 时只收扁平的真实依赖目录；如果用 pnpm 默认的符号链接隔离布局，`fs-extra` 的间接依赖（`universalify` / `jsonfile` / `graceful-fs`）会被漏掉，打包后的 app 静默无法加载主进程。如果你改了包管理器配置，务必保留 hoisted。

## 注意事项

- 首次安装可能需要拉取 `better-sqlite3` 和 `sharp` 的预编译原生二进制（postinstall 阶段）。
- `pnpm-workspace.yaml` 的 `onlyBuiltDependencies` 白名单允许这四个包执行构建脚本：`better-sqlite3`、`electron`、`esbuild`、`sharp`。首次安装时 pnpm 会提示确认。
- 关闭窗口 = 隐藏到系统托盘（不是退出）。要真正退出，用托盘右键菜单的 **Quit**，或 `Alt+F4`。

## 备份

原始的 Python 代码已移动到 `_legacy_python_version` 文件夹中。
