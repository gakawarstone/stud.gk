# Stud.GK

A minimal interface for Hochschule Flensburg Stud.IP with a Catppuccin Mocha theme, a sign-in form, course cards, and file previews.

## Getting started

Requires Node.js 22.12 or later.

```sh
npm install
make dev
```

Open http://localhost:5173 and sign in with your usual Stud.IP username and password. Select "Try demo" to see an example feed without signing in.

In development mode, the server is also accessible from other devices on your local network. Open `http://<computer IP>:5173`, for example http://192.168.178.22:5173. To restrict access to the current computer, run `HOST=127.0.0.1 npm run dev`. You can set the address and port with `HOST` and `PORT` in `.env`.

To run a production build:

```sh
npm run build
npm start
```

## Linux application

Stud.GK builds for Linux x86_64 are available in [GitHub Releases](https://github.com/gakawarstone/studip/releases). Electron and the local server are included, so you do not need to install Node.js.

To run the AppImage:

```sh
chmod +x Stud.GK-0.0.1-linux-x86_64.AppImage
./Stud.GK-0.0.1-linux-x86_64.AppImage
```

Substitute the version of the file you downloaded. If your system does not have FUSE, run `./Stud.GK-0.0.1-linux-x86_64.AppImage --appimage-extract-and-run`.

The application starts its server on `127.0.0.1` only, selects an available port, and saves it for future launches. If that port is in use, it selects a new one. The course card order is tied to the address and resets if the port changes. Normal updates preserve the order. Course data and encrypted sessions are stored in `${XDG_CONFIG_HOME:-~/.config}/Campus/data`, and the window profile is stored in the `Campus` directory. The legacy directory name is retained so that upgrading to Stud.GK preserves sessions and settings. Data from the browser version's `.data` directory is not migrated automatically. Use the sign-in form in the desktop window to sign in.

PDFs open in the existing viewer. Other formats open in a separate Stud.GK window with the same session. Downloads open the system save dialog. Closing all windows stops the application and its local server. Background checks run only while Stud.GK is open.

To run from source and create an AppImage:

```sh
npm ci
npm run desktop
npm run dist:linux
```

The AppImage is written to `release/`. Desktop checks require a graphical session or Xvfb:

```sh
npm run build
npm run test:desktop
# On a server without a display:
xvfb-run -a npm run test:desktop
```

## Releases

The project is in alpha. Versions use plain numbers such as `0.0.1` and `0.0.2`, without `alpha` suffixes or build numbers. A release tag looks like `v0.0.1`, and its application file is `Stud.GK-0.0.1-linux-x86_64.AppImage`. A larger release can use `0.1.0`.

Pushes to `master` and pull requests run checks without publishing releases. To publish a release, manually run **Linux desktop release** on `master` and enter a new version in the `version` field. With GitHub CLI:

```sh
gh workflow run linux-release.yml --ref master -f version=0.0.1
```

The workflow updates `package.json` and `package-lock.json` to the requested version in its build directory only, without committing to the repository. It runs tests, type checks, the AppImage build, and a check of the packaged application. After these checks pass, it tags the workflow's commit and publishes a GitHub Release with the AppImage and generated release notes. The new release is explicitly marked Latest, including when switching from the old `1.0.0` numbering to `0.0.1`.

Existing tags cannot be released again. Use a new version to fix a published application. The old `v1.0.0` and `v1.0.0-build.*` tags remain as a record of the previous numbering scheme.

## Authentication

Stud.GK fetches the standard Stud.IP sign-in form, retains its CSRF token and login ticket, and submits the username and password over HTTPS to the same form. A request to `/jsonapi.php/v1/users/me` confirms successful sign-in. The password is used only during sign-in and is never written to disk, the session, or localStorage.

The browser receives its own signed Stud.GK cookie with `HttpOnly` and `SameSite=Strict`. HTTPS adds `Secure`. Sessions in different browsers are independent. Each successful sign-in rotates the session ID. A Stud.GK session lasts at most seven days. If Stud.IP ends its session sooner, the application prompts you to sign in again. Automatic polling does not extend this lifetime.

Stud.IP sessions are stored on the server in `.data/sessions.enc`, encrypted with AES-256-GCM. The key in `.data/session.key` is generated automatically. The directory has permissions `0700`, and the session and key files have permissions `0600`. These files are excluded from Git. Sessions survive server restarts. Signing out deletes the session, and its previous cookie no longer grants access to private APIs.

Requests that change state accept JSON and check the request origin. Sign-in is limited to ten failed attempts per fifteen minutes from one IP address. A failure to load materials after sign-in does not undo successful authentication.

The development server listens on `0.0.0.0`, while `npm start` listens on `127.0.0.1`. The `HOST` variable overrides the address in either mode. The application runs in a single Node.js process. Public deployment and HTTPS proxy configuration are outside the current setup.

## Courses and files

A narrow icon sidebar appears on the left inside each course. Files open by default. Use the plus button to add Announcements, Schedule, and Course info. Sections disappear from the menu once added. To remove an extra tab, right-click its icon and select "Remove from sidebar". Use Shift+F10 to open the same menu from the keyboard. Removing the active tab returns you to files. Icon labels appear on hover and keyboard focus. Tabs are saved separately for each course and account.

You can also add Nextcloud through the plus button. In its tab, enter a public link without a password and select "Save link". Folders and files appear inside the application. Video cards show frames from the first few seconds. Previews load as cards enter the screen and are kept in memory. Video and audio open in the built-in player with seeking, PDFs open in the Stud.GK viewer, and images and text open in a preview window. Other formats can be downloaded. The gear button in the course header opens a menu to refresh files, edit the link, or open it in a browser.

Public links from newer and older Nextcloud installations are supported through WebDAV. Nextcloud account sign-in and password-protected links are not supported yet. Links are stored locally for each course and account and survive restarts. Removing the tab does not delete its link.

The other tabs use Stud.IP data that has already been loaded. Announcements appear as compact cards with a title, date, and text. Long posts have a "Read more" button. Links in the text open in a browser. Related changes are marked as read when the card enters the screen. The selected section is included in the page URL, so back and forward navigation work.

Use the plus button in the course sidebar to add GitLab and link several projects from GitLab.com or self-hosted servers, including projects in nested groups. The selected project name appears beside the gear button in the course header. Select it to switch projects or choose "Add project". The dropdown shows each project's group, name, and server. The selector does not add a separate row above the files. Editing a link or unlinking a project applies to the selected project. Existing single-project links are migrated to lists automatically. Select a branch above the file tree. Folders load when expanded, including every page of results, and retain their expanded state when refreshed. A compact bar above the file preview shows the selected branch's latest commit, its message, author, time, a link with the short SHA, and a button to copy the full SHA. The gear button in the course header lets you refresh files, manage GitLab access, change the link, and unlink the project.

The "History" button in the commit bar replaces the file tree on the left with a compact list of commits from that branch, grouped by day. Each row shows the commit title, author, and time. The selected commit's SHA appears in the top bar. Select "History" again to return to the tree and the previously opened file. Select a commit to see its full message and file diffs with line numbers, additions, and deletions. Diffs use the same syntax highlighting as file previews. Each side is highlighted separately, preserving multiline comments and strings within a change block. Unknown languages and diffs longer than 200,000 characters use plain text.

Selecting the commit message in the bar opens its diff directly. Selecting a commit in history updates the bar to show that commit's details. History loads 30 commits at a time, and diffs load 20 files at a time. Buttons load additional results. Renames, deletions, and permission changes are marked separately. Binary files and diffs whose content GitLab did not return have explanatory messages. [GitLab diff limits](https://docs.gitlab.com/api/commits/#retrieve-commit-diff) may restrict the number of returned files. The full commit is available through the SHA link. Scrollbars are hidden, but scrolling with a wheel, touchpad, or keyboard still works.

The selected file opens to the right of the tree. Code has line numbers and syntax highlighting for Kotlin, Java, TypeScript, JavaScript, Python, and other included languages. Highlighting is disabled for text longer than 200,000 characters. Files and configuration files have language and tool icons. The tree supports arrow keys, Enter, and Space. Escape closes the preview and returns focus to the tree. Markdown renders tables and highlighted code blocks. Images, PDFs, audio, and video open within the file preview. HTML and JavaScript from the repository are not executed. Text previews are limited to 2 MiB. Open binary files and larger text files on the GitLab website.

Public projects do not need a token. One personal access token with the `read_api` scope is used for all your projects on the same GitLab server, including projects in different courses. Enter it once through the gear menu's "GitLab access" option. If you do not have a token, "Create token in GitLab" opens the linked project's server with the name `Stud.GK` and the `read_api` scope prefilled. A connected token is applied automatically to new projects on that server for your Stud.IP account, including other application windows and sessions.

In "GitLab access", you can check the connection, replace the token, or remove it for all projects on the server. Access to individual projects depends on your GitLab account permissions. The token is tied to your Stud.IP account and the GitLab server. It survives sign-out, session expiry, signing back in, and application updates as long as the data directory is retained. To remove it, use "GitLab access" and select "Remove token for all projects". It is never returned to the browser or written to `.data/state.json`. Requests with a token require HTTPS, check that the server IP is public, and do not follow redirects. GitLab access errors do not end the Stud.IP session.

Tokens are stored separately from sessions in `.data/gitlab-tokens.enc`, encrypted with AES-256-GCM. For the desktop application, the file is in `${XDG_CONFIG_HOME:-~/.config}/Campus/data`. Its key is derived from `session.key` separately from the session encryption key. The file has permissions `0600`. Keep `session.key` when migrating data. On the first launch after an update, the application migrates tokens from older sessions, including expired records, and removes the previous copies after saving them. Sessions that have already been deleted cannot be recovered.

Project links are saved separately for each account and survive course refreshes and restarts. In demo mode, links are stored in the browser and open an example repository.

Two icon buttons inside a course switch between "All files" and "Folders". "All files" shows a thumbnail grid. "Folders" shows the original Stud.IP folder structure on the left and files on the right. The selected view survives restarts. Folders load on demand. You can expand subfolders and use back and forward navigation. The open folder is highlighted in the list on the left. Returning to "All files" shows materials from the entire course again. Browsing folders does not mark files as read or change notification history.

The home page shows cards for all courses with counts of available files and unread file changes. Drag cards with a mouse or use the handle in the bottom-right corner on a touchscreen. The handle also supports keyboard arrow keys. The order is saved in the browser, and new courses are appended at the end.

Opening a course shows its files in a grid with first-page PDF thumbnails, image thumbnails, filenames, and dates. PDF thumbnails use the same Catppuccin Mocha color adaptation as the viewer. The course title appears beside the "All courses" link. New and modified files have a green outline without text labels.

PDFs open in the application's fullscreen viewer with a Catppuccin Mocha palette. Light and dark pages adapt to Mocha backgrounds, text, and accents. Code block backgrounds remain distinct from the page. Syntax colors retain distinct hues, and comments remain readable against the new background. Text antialiasing accounts for the original paper color. The palette button restores the document's original colors. Downloads always contain the original PDF.

Pages form a continuous scroll, and the current page number updates as you scroll. You can select text, zoom, jump to a page number, and download the file. Selecting the zoom percentage fits the document to the available width. The expand button enables fullscreen mode. Pages near the visible area render as you scroll. The close button or Escape returns you to the cards. Other formats open in a separate tab. Files are sorted from newest to oldest by modification date, falling back to creation date. Files without dates appear last. "All courses" returns to the home page. Browser back and forward buttons work too. You can copy the selected course's URL from the address bar.

The file search in the course header filters filenames as you type, ignoring case and surrounding spaces. Press Ctrl+F or Cmd+F to focus it and select the current query. Escape or the clear button restores the full list. In folder view, search applies to the current folder. Changing courses, folders, views, or tabs clears the query. The result count shows how many files match.

After the first sign-in, the server saves a baseline for courses in the current semester. Existing materials are not reported as new. It then checks files, announcements, schedules, and basic course information every five minutes. The browser retrieves data every thirty seconds. If a check fails and the list is empty, you can retry it.

File preview links open a new browser tab using the Stud.IP session stored on the server. PDFs, images, audio, video, and text files are streamed for preview. HTML and SVG are shown as text. If the browser does not support a format, a page with a download button opens without downloading automatically. A completed full transfer marks related notifications as read. History remains available through the API. Snapshots and history are stored separately for each account in `.data/state.json`, retaining the latest 2,000 changes.

On the first complete load, Stud.GK streams the file and saves it to a disk cache. Thumbnails, previews, and downloads share the same copy, which survives restarts. The cache is in `.data/files` for the browser version or `data/files` in the desktop application's data directory. Cached content is limited to 512 MiB. When full, the cache evicts the least recently accessed files. Larger files are streamed without caching. Interrupted transfers and partial-file responses are not stored. If a complete file is already cached, byte-range requests are served from it.

Cached copies are separated by account and require a valid Stud.GK session. After refreshing courses, the server removes cached files that changed, disappeared, or became inaccessible. File contents are stored without encryption. Cache directories have permissions `0700`, and files have permissions `0600`. To clear the cache completely, close the application and delete the `files` directory from its data directory.

Information about inaccessible files appears on the course card and inside the course.

If Stud.IP returns 403 for a particular course section, the other sections continue to be tracked. The interface reports the restricted access. The section's last known data is retained and is not treated as deleted. When access returns, the section gets a new baseline so that changes made while access was unavailable are not reported as new. Connection errors, expired sessions, and other errors cancel the entire snapshot update.

Changes that appear and disappear between polls cannot be detected. An object disappearing from an accessible list may mean deletion or a change in access permissions. Forums, wiki, and Courseware are not connected yet.

## Reading data

The only POST request to Stud.IP submits its sign-in form. Stud.IP data is loaded through GET requests. Public Nextcloud shares use PROPFIND with depth 1 for folder listings and GET for file contents. Stud.GK sends no write requests to Nextcloud and never forwards university cookies there. It does not follow redirects, and connections to local and special-purpose IP addresses are blocked. Stud.GK does not edit Stud.IP materials or settings.

The browser loads thumbnail data for visible PDF and image tiles. PDF thumbnails show the first page. Thumbnails are kept only in browser memory and cleared when switching accounts. Loading them does not mark files as read. Selecting a file opens its full preview through the [standard sendfile.php endpoint](https://hilfe.studip.de/admin/Admins/Installationsanleitung). Pagination links and sign-in redirects are checked so that credentials and cookies are not sent to other sites.

Data routes:

```text
GET /jsonapi.php/v1/users/me
GET /jsonapi.php/v1/semesters
GET /jsonapi.php/v1/users/{id}/courses?filter[semester]={id}
GET /jsonapi.php/v1/courses/{id}/file-refs
GET /jsonapi.php/v1/courses/{id}/news
GET /jsonapi.php/v1/courses/{id}/events
```

Local API:

```text
POST /api/auth/login          { "username": "...", "password": "..." }
POST /api/auth/logout         {}
GET  /api/state
GET  /api/demo
GET  /api/courses/{id}/folders
POST /api/courses/{id}/gitlab/projects { "url": "https://gitlab.com/group/project" }
GET  /api/courses/{id}/gitlab/projects/{projectId}/branches
GET  /api/courses/{id}/gitlab/projects/{projectId}/commits?ref=main&page=1
GET  /api/courses/{id}/gitlab/projects/{projectId}/commit?sha={commit-id}&page=1
GET  /api/courses/{id}/gitlab/projects/{projectId}/readme
GET  /api/courses/{id}/gitlab/projects/{projectId}/tree?path=src&ref=main
GET  /api/courses/{id}/gitlab/projects/{projectId}/file?path=src%2Findex.ts&ref=main
GET  /api/courses/{id}/gitlab/projects/{projectId}/content?path=image.png&ref=main
GET  /api/courses/{id}/gitlab/projects/{projectId}/content?path=archive.zip&ref=main&download=1
GET  /api/courses/{id}/gitlab/projects/{projectId}/token
POST /api/courses/{id}/gitlab/projects/{projectId}/token { "token": "..." }
GET  /api/changes?since=2026-10-02T12:00:00Z
GET  /api/files/{fileRefId}/download
GET  /api/files/{fileRefId}/preview
GET  /api/files/{fileRefId}/content
POST /api/sync                {}
POST /api/changes/read        { "id": "..." }
POST /api/nextcloud/list      { "url": "https://…/s/…", "path": "" }
GET  /api/nextcloud/file/preview?share=…&path=…&backend=dav
GET  /api/nextcloud/file/download?share=…&path=…&backend=dav
```

To edit or unlink the selected GitLab project, send a new URL as `{ "url": "https://gitlab.com/group/project" }` or `{ "url": null }` to `/api/courses/{id}/gitlab/projects/{projectId}`. To remove the server's saved token for your Stud.IP account across all sessions, send `{ "token": null }` to `/api/courses/{id}/gitlab/projects/{projectId}/token`.

The `gitlabProjects` field in `/api/state` contains a list of `{ id, url }` objects for each course. Adding or editing a project returns `{ project, projects }`. Duplicate links in the same course are rejected with HTTP 409. The legacy `/api/courses/{id}/gitlab` and `/api/courses/{id}/gitlab/...` routes still operate on the course's first project.

Private routes require a valid Stud.GK cookie. Only files in the current account's snapshot can be downloaded. Stud.IP checks permissions when content is loaded from the university server. Cache access reflects the last successful course refresh. University cookies stay on the server. Download redirects to external addresses are not supported. Without sign-in, `/api/state` reports only authentication status. `/api/demo` contains only demonstration data. Manually entering a university cookie and using `STUDIP_COOKIE` are no longer supported.

The sign-in form has been checked against the current Hochschule Flensburg installation. Schemas and routes have been checked against the [Stud.IP source code](https://gitlab.studip.de/studip/studip/-/blob/main/lib/classes/JsonApi/RouteMap.php). Automated checks use a mock university server. Signing in to a real account requires entering your credentials in the interface.

## Checks

[SolidJS migration measurements](docs/solidjs-migration.md).

The GitLab interface check uses a separate temporary profile and a mock API without accessing private projects. After `npm run build`, run `xvfb-run -a npm run test:gitlab -- --no-sandbox --ozone-platform=x11`. It checks adding several projects to one course, duplicate links, switching projects, editing and unlinking the selected project, persistence after reload, token isolation between servers, the folder tree, branch switching, paginated history and diffs, retries after errors, line numbers, renames, binary and large files, highlighting, Markdown, scrolling, and a narrow window. GitLab PDFs use the shared reader, with checks for retries, text selection, page navigation, zoom, colors, download links, fullscreen mode, narrow layouts, and returning focus to the tree.

```sh
npm test
npm run build
```

The build includes `npm run typecheck`, which runs strict TypeScript checks for the interface and checks server JavaScript through `checkJs`. Shared types for API state, courses, materials, and folders are in `shared/studip.ts`. The server currently uses non-strict mode so annotations can be added gradually.

Every PR targeting `master` runs tests, type checks, a build, and five interface checks under Xvfb. After building locally, you can run them with:

```sh
xvfb-run -a npm run test:desktop -- --no-sandbox --ozone-platform=x11
xvfb-run -a npm run test:gitlab -- --no-sandbox --ozone-platform=x11
xvfb-run -a npm run test:session -- --no-sandbox --ozone-platform=x11
xvfb-run -a npm run test:ui -- --no-sandbox --ozone-platform=x11
xvfb-run -a --server-args='-screen 0 1920x1200x24' npm run test:search -- --no-sandbox --ozone-platform=x11
```

The `test:session` check uses mock API responses and controlled timers. It checks slow polling, a late response after sign-out, session expiry, and switching to demo mode. These checks do not need real credentials.

Tests cover form sign-in with CSRF, redirects and cookies, incorrect passwords, account isolation, session ID rotation, recovery after a restart, sign-out, expiry, encryption, sign-in rate limits, and change detection. Download checks cover account permissions, binary streaming, byte ranges, cancellation, and read marks. Cache checks cover file reuse, recovery after a restart, account separation, version and permission changes, eviction of old files, and cleanup of incomplete transfers. PDF color checks cover light and dark pages, mixed backgrounds, syntax colors, text antialiasing, and high pixel density.

Palette: [Catppuccin](https://catppuccin.com/palette/). Icons: Lucide. Font: Manrope with a system fallback.
