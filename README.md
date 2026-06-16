# PyClipboardHistory (Refactored to Electron)

这是一个重构后的剪贴板历史管理器，原本使用 Python + pywebview 开发，现在完全迁移到了 **React + Electron (Vite) + Tailwind CSS**.

## 核心特性

- **跨平台支持**：基于 Electron，支持 Windows (目前优化最好)。
- **现代 UI**：使用 React 和 Tailwind CSS 构建，支持暗色模式（跟随系统）。
- **剪贴板监控**：自动保存文本和图片。
- **智能分类**：集成 OpenAI API，自动为剪贴板内容打标签。
- **图片预览**：自动生成缩略图，占用空间小。
- **全局快捷键**：`Ctrl + Alt + V` 快速唤起。
- **跟随鼠标**：窗口在鼠标位置弹出，即用即走。

## 技术栈

- **前端**: React, Tailwind CSS, Lucide Icons
- **后端 (Main Process)**: Electron, better-sqlite3 (高性能数据库), sharp (极速图像处理)
- **构建工具**: electron-vite

## 开始使用

### 开发环境

1. 确保已安装 [Node.js](https://nodejs.org/)。
2. 安装 pnpm: `npm install -g pnpm`
3. 安装依赖: `pnpm install`
4. 运行开发服务器: `pnpm run dev`

### 生产打包

生成安装包:
```bash
pnpm run build    # 仅构建输出 (out/)
pnpm run package  # 构建并打包为可移植可执行文件 (dist/)
```

## 注意事项

- 图片和数据库存储在可执行文件所在目录（而非系统 AppData）。
- 首次安装可能需要编译 `better-sqlite3` 和 `sharp` 等原生模块。

## 备份

原始的 Python 代码已移动到 `_legacy_python_version` 文件夹中。
