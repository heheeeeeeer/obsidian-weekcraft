# Publishing WeekCraft

Repository: `heheeeeeeer/obsidian-weekcraft`. Plugin ID: `weekcraft`. Author: `heheeeeeeer`.

WeekCraft 0.6.1 was published to [the community directory](https://community.obsidian.md/plugins/weekcraft) on 2026-10-28. The official scan completed without errors and reproduced the release `main.js` byte-for-byte. Remaining recommendations concern artifact attestations and CSS compatibility/style warnings.

## Prepare a version

1. Update `manifest.json` and `package.json` to the same `x.y.z` version, and update the lockfile with `npm install --package-lock-only`.
2. Add that version and minimum Obsidian version to `versions.json`.
3. Update `CHANGELOG.md`, run `npm run release:prepare`, and manually check the plugin in a test vault.
4. Commit source files. Do not commit generated `main.js`, `dist/`, personal notes, or `data.json`.
5. Push a tag that exactly matches the version, for example `0.6.1`, without a `v` prefix.

The release workflow tests and builds the tagged commit, verifies the tag against the manifest, and creates a **draft** GitHub release with `main.js`, `manifest.json`, and `styles.css` attached. Review it, then publish it as a normal release (not a prerelease). The public repository's default branch manifest must also match the version you want the directory to install.

## Submit to Obsidian

The official process as checked on 2026-10-28 uses the [Obsidian Community directory](https://community.obsidian.md), rather than a new pull request to the old plugin list.

1. Publish the repository and the GitHub release.
2. Sign in to the directory with your Obsidian account and connect your GitHub account.
3. Open Plugins → New plugin and enter `https://github.com/heheeeeeeer/obsidian-weekcraft`.
4. Select the owner, review the developer policies and maintenance commitment, and submit.
5. Review automated findings. Fix errors, increment the version, and publish a new release when needed.
6. Complete the listing and publish it once the required checks pass.

Source: [Submit your plugin](https://docs.obsidian.md/plugins/releasing/submit-plugin), [Set up and claim](https://docs.obsidian.md/community-directory/set-up-and-claim), and [Manifest](https://docs.obsidian.md/Reference/Manifest).

## Manual release checks

- New vault with no saved settings: plugin loads; daily and weekly forms save entries.
- Kanban 2.0.51: enable a board, edit and move tasks, mark complete, undo/redo, reopen the note and check persisted data.
- Disable the plugin and verify that board hooks and event handlers are removed.
- Check mobile and pop-out windows before advertising verified support.

Automated tests use simulated Obsidian/Kanban APIs; they do not replace these app checks or official review.
