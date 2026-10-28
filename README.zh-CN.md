# WeekCraft

将每周计划保存在 Markdown 中：按时间和类别组织看板任务，使用日记／周记表单添加日程，并自动记录任务完成时间。

## 安装与依赖

需要 Obsidian 1.6.0 或更新版本。看板功能依赖 [Kanban 社区插件](https://github.com/mgmeyers/obsidian-kanban)，当前开发环境使用 2.0.51。日程表单和普通任务完成时间不需要 Kanban 或 Dataview。

当前界面以中文为主。插件运行代码没有 Node.js 或 Electron 依赖，但手机端和独立窗口仍需人工验证。看板使用 Kanban 内部接口，Kanban 升级后可能需要适配。

在 Obsidian 的社区插件市场搜索 **WeekCraft**，或打开 [社区目录页面](https://community.obsidian.md/plugins/weekcraft) 点击 **Install** 安装。

也可以从 [Releases](https://github.com/heheeeeeeer/obsidian-weekcraft/releases) 下载同一版本的 `main.js`、`manifest.json`、`styles.css`，放入仓库的 `.obsidian/plugins/weekcraft/`，重启 Obsidian 后启用 WeekCraft。自定义配置目录时，将 `.obsidian` 替换为实际配置目录。

## 使用

- **看板**：将 [周看板示例](examples/weekly-board.md) 放进仓库，以 Kanban 视图打开。已有看板可通过命令面板的“WeekCraft: 启用当前看板的日程增强”开启。
- **日记**：添加语言为 `schedule`、内容为 `mode: daily` 的代码块，在阅读视图或实时预览中操作。
- **周记**：使用 `mode: weekly`，配合 `### 10.26 Mon` 这样的二至四级标题。日期标题必须以空格及 Mon/Tue/Wed/Thu/Fri/Sat/Sun 结尾。参见 [周记示例](examples/weekly-note.md)。
- **模板**：在设置里指定相对仓库的模板文件夹，例如 `Templates`，避免向模板写入日程及完成时间。
- **完成时间**：默认开启；勾选任务会向 Markdown 写入完成时间，取消勾选会移除 WeekCraft 所添加的时间。可分别关闭普通任务与看板的完成时间功能。

## 开发与发布

使用 Node.js 22 或更新版本：

```sh
npm ci
npm run check
npm run release:prepare
```

发布附件输出到 `dist/0.6.1/`。开发代码以 `src/` 为准，安装脚本必须显式传入目标仓库，不依赖源码放在哪个文件夹。详细步骤见 [发布指南](docs/PUBLISHING.md)。

## 隐私与授权

插件本身不联网，不收集遥测，不展示广告，不要求账号或付费。笔记和设置保存在你的仓库内。Obsidian 自身负责下载更新。

[MIT 许可证](LICENSE) · heheeeeeeer
