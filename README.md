# WeekCraft

Plan your week in Markdown with grouped Kanban tasks, daily and weekly entry forms, and automatic completion timestamps.

[中文使用说明](README.zh-CN.md)

## Features

- Group tasks by time range and category, with configurable colors and ordering.
- Add, edit, copy, reorder, and move tasks between open boards.
- Undo and redo board changes, including task completion.
- Add daily or weekly entries with a `schedule` code block.
- Record completion times on ordinary Markdown tasks and enhanced Kanban tasks.
- Keep your plans in Markdown files in your vault.

## Requirements and compatibility

- Obsidian **1.6.0 or newer**.
- Install and enable the [Kanban community plugin](https://github.com/mgmeyers/obsidian-kanban) for board features. The development vault uses Kanban **2.0.51**. WeekCraft integrates with Kanban's internal state manager; future Kanban changes may require a compatibility update.
- Schedule forms and ordinary task timestamps work without Kanban or Dataview.
- The current interface is primarily Chinese. No Node.js or Electron APIs are used by the runtime, but mobile and pop-out window behavior still need manual validation.

## Installation

Install **WeekCraft** from Obsidian's Community plugins browser, or open [the community listing](https://community.obsidian.md/plugins/weekcraft) and select **Install**.

For manual installation, download `main.js`, `manifest.json`, and `styles.css` from the same [GitHub release](https://github.com/heheeeeeeer/obsidian-weekcraft/releases). Put them in `<vault>/<config-folder>/plugins/weekcraft/`, restart Obsidian, and enable **WeekCraft** in Community plugins. The default config folder is `.obsidian`.

## Get started

### Weekly board

1. Install and enable Kanban.
2. Copy [the weekly board example](examples/weekly-board.md) into your vault, or create a Kanban board.
3. Add the property `weekcraft: true`, or run **WeekCraft: 启用当前看板的日程增强** from the command palette.
4. Open the note as a Kanban board. Use the task form to choose a category and time range.

```yaml
---
kanban-plugin: board
weekcraft: true
---
```

### Daily and weekly forms

Add this code block to a regular note and view it in Reading view or Live Preview:

````markdown
```schedule
mode: daily
```
````

For weekly notes, use `mode: weekly` and headings such as `### 10.26 Mon`. Each weekday heading must be level 2–4 and end with a space plus `Mon`, `Tue`, `Wed`, `Thu`, `Fri`, `Sat`, or `Sun`. You can set `day: Mon` to choose an initial day. See [the weekly note example](examples/weekly-note.md).

### Settings and note changes

Set your template folder in WeekCraft settings, using a vault-relative path such as `Templates`. Notes in that folder are excluded from schedule entry and automatic timestamps. The `schedule-template: true` property also prevents schedule form entry.

Automatic timestamps are enabled by default. Checking a task can append a completion timestamp to its Markdown text; unchecking it removes the timestamp owned by WeekCraft. Disable **日记、周记及普通任务的完成时间** to stop ordinary-note timestamps, or **看板完成时间记录** for board timestamps. Existing timestamps are not removed merely by disabling these settings.

Other settings control categories and colors, completed-task styling, task numbers, board width, and the timestamp format and time zone.

## Privacy and network use

WeekCraft runs locally. It does not make network requests, collect telemetry, display ads, or require an account or payment. The runtime reads and updates notes and its own settings inside your vault. Development scripts access only the repository and the explicitly selected vault; they are not shipped in the installed plugin. Obsidian itself handles release downloads.

## Development

Use Node.js 22 or newer. There are no third-party build dependencies.

```sh
npm ci
npm run check
npm run release:prepare
```

`src/` is the source of truth. `main.js` is generated and is attached to releases rather than committed. `dist/0.6.1/` contains the three release attachments.

Close Obsidian before installing into a development vault:

```sh
npm run install:local -- "/absolute/path/to/vault"
# Optional second argument for a non-default config folder:
npm run install:local -- "/absolute/path/to/vault" ".obsidian-dev"
```

The installer requires an explicit vault path and an existing config folder. Moving the source repository does not change the installation target. Backups are written under `<config-folder>/weekcraft-backups/`.

See [publishing instructions](docs/PUBLISHING.md) for the release workflow and community-directory submission.

## License

[MIT](LICENSE), copyright heheeeeeeer.
