# Adam BN review

Client review site plus a private dashboard.

- `index.html` — client review page (`?p=<id>`), shared folder page (`?f=<id>`). Open `index.html?demo=1` to preview.
- `404.html` — makes custom short links like `/nike-spring/` work without adding files: it reads the name from the address and asks the backend what it points to.
- `atworld/` — the first short link, kept as a real page.
- `admin/` — the dashboard: sign in, upload from the browser straight to Google Drive, folders, rename, move, versions, delete, share links, all comments.
- `backend/Code.gs` — the Google Apps Script backend (paste into the Apps Script project and deploy a new version after changes).
