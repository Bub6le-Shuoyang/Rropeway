# Scriptroom Desktop

离线的游戏对话脚本编辑器，基于 Electron，面向 Windows 桌面使用。

## 启动

```powershell
npm install
npm start
```

如果 PowerShell 找不到 `node`，请先把 Node.js 加入 PATH。项目支持以下快捷键：

- `Ctrl + N`：新建项目
- `Ctrl + O`：打开 `.scriptroom` 项目
- `Ctrl + S`：保存项目

## 项目文件

`.scriptroom` 是 JSON 格式的本地项目文件。导入的图片/音频会复制到项目旁的 `assets` 目录中，编辑器不上传任何内容。