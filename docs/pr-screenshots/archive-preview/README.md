# ZIP contents preview

Screenshots use a local fixture account and the small ZIP in `scripts/fixtures/archive-preview.zip`. No university credentials or course materials are included.

- `cards.png`: compact file trees in course cards, a damaged archive, and the existing icon for an unsupported archive format. File trees sit directly on the preview background, with no inner panel, header, footer, or entry count. A small archive icon and ZIP label identify the format in the top-right corner. Common enclosing folders are omitted, folder chains collapse, and files use their language icons.
- `narrow.png`: course cards at 480 px.
- `contents.png`: the complete archive listing and download action.
- `contents-narrow.png`: the listing at 480 px.

Reproduce after `npm run build`:

```sh
CAMPUS_ARCHIVE_SCREENSHOTS=docs/pr-screenshots/archive-preview xvfb-run -a npm run test:archives -- --ozone-platform=x11
```

Previews read central-directory metadata without extracting members. The server accepts ZIP archives up to 32 MiB and lists at most 1,000 entries. Larger or invalid archives retain a download link on their preview page. Card previews load when they approach the viewport and do not mark notifications read.
