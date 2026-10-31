# Course file search

Screenshots use local fixture courses and generated PDF covers. They contain no account credentials or downloaded course materials.

Regenerate after building:

```sh
CAMPUS_SEARCH_SCREENSHOTS=docs/pr-screenshots/course-search xvfb-run -a --server-args='-screen 0 1920x1200x24' npm run test:search -- --no-sandbox --ozone-platform=x11
```

- `all-files.png`: empty search with the full course grid and keyboard shortcut hint.
- `search-results.png`: Ctrl+F search for `ktor`, with four matching files out of twelve.
- `folder-results.png`: three matching files in the Lectures folder.
- `no-results.png`: empty result state with an action to clear the query.
- `narrow-results.png`: search and view controls at a 480px window width.
