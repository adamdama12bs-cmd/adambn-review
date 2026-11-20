/**
 * Adam Review — backend (Google Apps Script, bound to a Google Sheet)
 *
 * Stores folders, projects (videos), versions, comments and portfolio in the
 * Sheet, hosts video files in the "Adam Frame" Google Drive folder, and exposes
 * a small JSON API used by the review website, the dashboard (admin/) and the
 * DaVinci Resolve scripts.
 *
 * Setup: see SETUP.md. Run `setup()` once from the editor, then deploy as a
 * Web app (Execute as: Me, Who has access: Anyone). After pasting a new version
 * of this file: Deploy → Manage deployments → edit → Version: New version.
 */

// The Drive folder that hosts uploaded review videos ("Adam Frame").
var FOLDER_ID = '10IVTTUs2GKEbrEGw-l6eZ4t0-2-qwBtT';

// Bump when SHEETS changes; missing tabs/columns are then added automatically.
var SCHEMA_VERSION = '2';

// New columns go at the END of each list, so older Sheets upgrade in place.
var SHEETS = {
  Projects: ['id', 'title', 'client', 'createdAt', 'folderId', 'slug', 'status', 'thumb', 'updatedAt'],
  Versions: ['projectId', 'version', 'fileId', 'fileName', 'fps', 'startTC', 'durationFrames', 'width', 'height', 'createdAt', 'size'],
  Comments: ['id', 'projectId', 'version', 'frame', 'timecode', 'author', 'text', 'parentId', 'status', 'createdAt'],
  Portfolio: ['order', 'title', 'subtitle', 'url', 'thumbnail'],
  Folders: ['id', 'name', 'parentId', 'slug', 'createdAt']
};

// Short links that already exist as real pages on the site.
var RESERVED_SLUGS = ['admin', 'demo', 'backend', 'index', 'atworld'];

/* ------------------------------------------------------------------ setup */

function setup() {
  ensureSchema(true);
  var portfolio = sheet('Portfolio');
  if (portfolio.getLastRow() === 1) {
    portfolio.appendRow([1, 'Example project — replace me', 'Commercial · 2025', 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', '']);
  }
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('ADMIN_KEY')) {
    props.setProperty('ADMIN_KEY', Utilities.getUuid().replace(/-/g, ''));
  }
  DriveApp.getFolderById(FOLDER_ID); // forces Drive authorization + checks the folder exists
  Logger.log('Setup done. Your ADMIN KEY (sign in to the dashboard with it, keep it private):\n' + props.getProperty('ADMIN_KEY'));
}

/** Creates missing tabs and appends missing columns. Cheap after the first run. */
function ensureSchema(force) {
  var props = PropertiesService.getScriptProperties();
  if (!force && props.getProperty('SCHEMA') === SCHEMA_VERSION) return;
  var ss = SpreadsheetApp.getActive();
  Object.keys(SHEETS).forEach(function (name) {
    var cols = SHEETS[name];
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@'); // store everything as plain text
      sh.appendRow(cols);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, cols.length).setFontWeight('bold');
      return;
    }
    var head = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map(String);
    cols.forEach(function (c) {
      if (head.indexOf(c) >= 0) return;
      var col = head.length + 1;
      if (col > sh.getMaxColumns()) sh.insertColumnAfter(sh.getMaxColumns());
      sh.getRange(1, col, sh.getMaxRows(), 1).setNumberFormat('@');
      sh.getRange(1, col).setValue(c).setFontWeight('bold');
      head.push(c);
    });
  });
  props.setProperty('SCHEMA', SCHEMA_VERSION);
}

/* -------------------------------------------------------------- routing */

function doGet(e) {
  var p = e.parameter || {};
  try {
    ensureSchema();
    if (p.action === 'review') return json(getReview(p.p, p.key, p.s));
    if (p.action === 'folder') return json(getFolderShare(p.f, p.s));
    if (p.action === 'resolve') return json(resolveSlug(p.s));
    if (p.action === 'ping') return json({ ok: true });
    if (p.action === 'chunk') return json(getChunk(p.f, Number(p.i) || 0));
    if (p.action === 'library') { requireAdmin(p.key); return json(getLibrary()); }
    return json({ error: 'Unknown action' });
  } catch (err) {
    return json({ error: String(err.message || err) });
  }
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json({ error: 'Bad JSON' });
  }
  try {
    ensureSchema();
    if (body.action === 'comment') return json(addComment(body));
    if (body.action === 'login') return json(login(body.password));

    requireAdmin(body.key);
    switch (body.action) {
      case 'status': return json(setStatus(body.id, body.status));
      case 'delete': return json(deleteComment(body.id));
      case 'startUpload': return json(startUpload(body));
      case 'uploadStatus': return json(uploadStatus(body));
      case 'uploadChunk': return json(uploadChunk(body));
      case 'finalizeUpload': return json(finalizeUpload(body));
      case 'library': return json(getLibrary());
      case 'updateProject': return json(updateProject(body));
      case 'deleteProject': return json(deleteProject(body.id));
      case 'deleteVersion': return json(deleteVersion(body.projectId, body.version));
      case 'replaceVersionFile': return json(replaceVersionFile(body));
      case 'createFolder': return json(createFolder(body));
      case 'updateFolder': return json(updateFolder(body));
      case 'deleteFolder': return json(deleteFolder(body.id));
      case 'setPassword': return json(setPassword(body.password));
      default: return json({ error: 'Unknown action' });
    }
  } catch (err) {
    return json({ error: String(err.message || err) });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------------------------------------------------------------- auth */

function isAdmin(key) {
  var real = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  return !!key && !!real && key === real;
}

function requireAdmin(key) {
  if (!isAdmin(key)) throw new Error('Not authorized');
}

function sha256(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'adambn:' + s, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

/**
 * Dashboard sign-in. Accepts the admin key itself or the password set from the
 * dashboard, and returns the admin key (which the dashboard keeps on that device).
 * After 10 wrong tries in 15 minutes, sign-in pauses for 15 minutes.
 */
function login(password) {
  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get('loginFails') || 0);
  if (fails >= 10) throw new Error('Too many wrong tries. Wait 15 minutes and try again.');
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('ADMIN_KEY');
  var hash = props.getProperty('PASSWORD_HASH');
  password = String(password || '').trim();
  if (password && (password === key || (hash && sha256(password) === hash))) {
    return { ok: true, key: key, hasPassword: !!hash };
  }
  cache.put('loginFails', String(fails + 1), 900);
  Utilities.sleep(1000);
  throw new Error('Wrong password');
}

function setPassword(password) {
  password = String(password || '');
  if (password.length < 8) throw new Error('Use at least 8 characters');
  PropertiesService.getScriptProperties().setProperty('PASSWORD_HASH', sha256(password));
  return { ok: true };
}

/* ------------------------------------------------------------ sheet io */

function sheet(name) {
  return SpreadsheetApp.getActive().getSheetByName(name);
}

function rows(name) {
  var sh = sheet(name);
  var values = sh.getDataRange().getValues();
  var head = values.shift().map(String);
  return values.map(function (r, i) {
    var o = { _row: i + 2 };
    head.forEach(function (h, j) { if (h) o[h] = r[j]; });
    return o;
  });
}

function header(name) {
  var sh = sheet(name);
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
}

function append(name, obj) {
  sheet(name).appendRow(header(name).map(function (h) { return obj[h] === undefined ? '' : obj[h]; }));
}

function setCells(name, row, obj) {
  var head = header(name), sh = sheet(name);
  Object.keys(obj).forEach(function (k) {
    var col = head.indexOf(k);
    if (col >= 0) sh.getRange(row, col + 1).setValue(obj[k]);
  });
}

function withLock(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function clean(s, max) {
  return String(s == null ? '' : s).replace(/^[=+\-@]/, "'$&").slice(0, max || 4000);
}

function now() { return new Date().toISOString(); }

function liveProjects() {
  return rows('Projects').filter(function (r) { return r.status !== 'deleted'; });
}

/* ---------------------------------------------------------- short links */

function normSlug(s) {
  return String(s || '').toLowerCase().trim().replace(/[^a-z0-9֐-׿]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

/** Throws if `slug` is taken by anything other than the given item. */
function checkSlug(slug, selfId) {
  if (!slug) return;
  if (slug.length < 2) throw new Error('Short link must be at least 2 characters');
  if (RESERVED_SLUGS.indexOf(slug) >= 0) throw new Error('"' + slug + '" is already used by the site');
  var taken = liveProjects().concat(rows('Folders')).some(function (r) {
    return r.id !== selfId && (String(r.slug) === slug || r.id === slug);
  });
  if (taken) throw new Error('The short link "' + slug + '" is already used');
}

function resolveSlug(slug) {
  slug = normSlug(slug);
  if (!slug) throw new Error('Not found');
  var p = liveProjects().filter(function (r) { return String(r.slug) === slug || r.id === slug; })[0];
  if (p) return { type: 'project', id: p.id };
  var f = rows('Folders').filter(function (r) { return String(r.slug) === slug || r.id === slug; })[0];
  if (f) return { type: 'folder', id: f.id };
  throw new Error('This link does not exist anymore');
}

/* --------------------------------------------------------------- review */

function versionsOf(projectId, all) {
  return (all || rows('Versions'))
    .filter(function (v) { return v.projectId === projectId; })
    .map(function (v) {
      return {
        version: Number(v.version), fileId: v.fileId, fileName: v.fileName, fps: Number(v.fps),
        startTC: String(v.startTC), durationFrames: Number(v.durationFrames),
        width: Number(v.width) || 0, height: Number(v.height) || 0, size: Number(v.size) || 0, createdAt: v.createdAt
      };
    })
    .sort(function (a, b) { return a.version - b.version; });
}

function getReview(projectId, key, slug) {
  if (!projectId && slug) {
    var r = resolveSlug(slug);
    if (r.type !== 'project') return { redirectFolder: r.id };
    projectId = r.id;
  }
  if (!projectId) throw new Error('Missing project');
  var project = liveProjects().filter(function (r) { return r.id === projectId; })[0];
  if (!project) throw new Error('Project not found');

  var comments = rows('Comments')
    .filter(function (c) { return c.projectId === projectId && c.status !== 'deleted'; })
    .map(function (c) {
      return {
        id: c.id, version: Number(c.version), frame: Number(c.frame), timecode: String(c.timecode),
        author: c.author, text: c.text, parentId: c.parentId || null, status: c.status || 'open', createdAt: c.createdAt
      };
    });

  var portfolio = rows('Portfolio')
    .filter(function (p) { return p.url; })
    .sort(function (a, b) { return Number(a.order) - Number(b.order); })
    .map(function (p) { return { title: p.title, subtitle: p.subtitle, url: p.url, thumbnail: p.thumbnail }; });

  return {
    project: { id: project.id, title: project.title, client: project.client, folderId: project.folderId || '' },
    versions: versionsOf(projectId),
    comments: comments,
    portfolio: portfolio,
    admin: isAdmin(key)
  };
}

/** Public view of a shared folder: its videos and sub-folders (never the folders above it). */
function getFolderShare(folderId, slug) {
  if (!folderId && slug) {
    var r = resolveSlug(slug);
    if (r.type !== 'folder') return { redirectProject: r.id };
    folderId = r.id;
  }
  var folders = rows('Folders');
  var folder = folders.filter(function (f) { return f.id === folderId; })[0];
  if (!folder) throw new Error('Folder not found');
  var versions = rows('Versions');
  var videos = liveProjects()
    .filter(function (p) { return String(p.folderId) === folderId; })
    .map(function (p) {
      var vs = versionsOf(p.id, versions), last = vs[vs.length - 1] || {};
      return { id: p.id, slug: String(p.slug || ''), title: p.title, client: p.client, thumb: p.thumb || '', versions: vs.length,
        width: last.width || 0, height: last.height || 0, durationFrames: last.durationFrames || 0, fps: last.fps || 25,
        updatedAt: p.updatedAt || p.createdAt };
    })
    .sort(function (a, b) { return a.updatedAt < b.updatedAt ? 1 : -1; });
  var subfolders = folders
    .filter(function (f) { return String(f.parentId) === folderId; })
    .map(function (f) { return { id: f.id, slug: String(f.slug || ''), name: f.name }; });
  return {
    folder: { id: folder.id, name: folder.name, slug: String(folder.slug || '') },
    videos: videos,
    folders: subfolders
  };
}

function addComment(b) {
  if (!b.p || !b.text || !String(b.text).trim()) throw new Error('Missing comment');
  return withLock(function () {
    var exists = liveProjects().some(function (r) { return r.id === b.p; });
    if (!exists) throw new Error('Project not found');
    var c = {
      id: Utilities.getUuid().slice(0, 8),
      projectId: b.p,
      version: Number(b.version) || 1,
      frame: Math.max(0, Math.floor(Number(b.frame) || 0)),
      timecode: clean(b.timecode, 20),
      author: clean(b.author || 'Client', 80),
      text: clean(b.text, 4000),
      parentId: clean(b.parentId || '', 20),
      status: 'open',
      createdAt: now()
    };
    append('Comments', c);
    c.parentId = c.parentId || null;
    return { ok: true, comment: c };
  });
}

function findComment(id) {
  return rows('Comments').filter(function (c) { return c.id === id; })[0];
}

function setStatus(id, status) {
  if (['open', 'done'].indexOf(status) < 0) throw new Error('Bad status');
  return withLock(function () {
    var c = findComment(id);
    if (!c) throw new Error('Comment not found');
    setCells('Comments', c._row, { status: status });
    return { ok: true };
  });
}

function deleteComment(id) {
  return withLock(function () {
    var c = findComment(id);
    if (!c) throw new Error('Comment not found');
    setCells('Comments', c._row, { status: 'deleted' });
    return { ok: true };
  });
}

/* -------------------------------------------------------------- library */

/** Everything the dashboard needs in one call. */
function getLibrary() {
  var versions = rows('Versions');
  var comments = rows('Comments').filter(function (c) { return c.status !== 'deleted'; });
  var projects = liveProjects();
  var titles = {};
  projects.forEach(function (p) { titles[p.id] = p.title; });

  var list = projects.map(function (p) {
    var vs = versionsOf(p.id, versions);
    var cs = comments.filter(function (c) { return c.projectId === p.id && !c.parentId; });
    var last = vs[vs.length - 1];
    return {
      id: p.id, title: p.title, client: p.client, folderId: String(p.folderId || ''), slug: String(p.slug || ''),
      thumb: p.thumb || '', createdAt: p.createdAt, updatedAt: p.updatedAt || (last && last.createdAt) || p.createdAt,
      versions: vs,
      open: cs.filter(function (c) { return c.status !== 'done'; }).length,
      done: cs.filter(function (c) { return c.status === 'done'; }).length,
      lastCommentAt: cs.reduce(function (m, c) { return c.createdAt > m ? c.createdAt : m; }, '')
    };
  });

  var recent = comments
    .filter(function (c) { return titles[c.projectId] !== undefined; })
    .sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; })
    .slice(0, 60)
    .map(function (c) {
      return { id: c.id, projectId: c.projectId, projectTitle: titles[c.projectId], version: Number(c.version), frame: Number(c.frame),
        timecode: String(c.timecode), author: c.author, text: c.text, parentId: c.parentId || null, status: c.status || 'open', createdAt: c.createdAt };
    });

  var folders = rows('Folders').map(function (f) {
    return { id: f.id, name: f.name, parentId: String(f.parentId || ''), slug: String(f.slug || ''), createdAt: f.createdAt };
  });

  var props = PropertiesService.getScriptProperties();
  return { ok: true, projects: list, folders: folders, recent: recent, hasPassword: !!props.getProperty('PASSWORD_HASH') };
}

function findProject(id) {
  var p = liveProjects().filter(function (r) { return r.id === id; })[0];
  if (!p) throw new Error('Video not found');
  return p;
}

function folderExists(id) {
  return !id || rows('Folders').some(function (f) { return f.id === id; });
}

function updateProject(b) {
  return withLock(function () {
    var p = findProject(b.id);
    var set = { updatedAt: now() };
    if (b.title !== undefined) {
      if (!String(b.title).trim()) throw new Error('Name cannot be empty');
      set.title = clean(b.title, 200);
    }
    if (b.client !== undefined) set.client = clean(b.client, 200);
    if (b.folderId !== undefined) {
      if (!folderExists(b.folderId)) throw new Error('Folder not found');
      set.folderId = b.folderId || '';
      delete set.updatedAt; // moving is not an update to the video
    }
    if (b.slug !== undefined) {
      var slug = normSlug(b.slug);
      checkSlug(slug, p.id);
      set.slug = slug;
    }
    if (b.thumb !== undefined) set.thumb = String(b.thumb).slice(0, 49000);
    setCells('Projects', p._row, set);
    return { ok: true };
  });
}

function trashFile(fileId) {
  try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) { /* already gone */ }
}

/** Removes a video and moves its files to the Drive trash (restorable for 30 days). */
function deleteProject(id) {
  return withLock(function () {
    var p = findProject(id);
    rows('Versions').filter(function (v) { return v.projectId === id; }).forEach(function (v) { trashFile(v.fileId); });
    setCells('Projects', p._row, { status: 'deleted', slug: '', updatedAt: now() });
    return { ok: true };
  });
}

function deleteVersion(projectId, version) {
  return withLock(function () {
    findProject(projectId);
    var all = rows('Versions').filter(function (v) { return v.projectId === projectId; });
    if (all.length < 2) throw new Error('A video needs at least one version. Delete the whole video instead.');
    var v = all.filter(function (x) { return Number(x.version) === Number(version); })[0];
    if (!v) throw new Error('Version not found');
    trashFile(v.fileId);
    sheet('Versions').deleteRow(v._row);
    return { ok: true };
  });
}

/**
 * Swaps a version's video file for a lighter copy (made in the dashboard).
 * Same version number, comments and links; the old file goes to the Drive trash.
 */
function replaceVersionFile(b) {
  if (!b.fileId) throw new Error('Missing fileId');
  var file = DriveApp.getFileById(b.fileId);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return withLock(function () {
    findProject(b.projectId);
    var v = rows('Versions').filter(function (x) { return x.projectId === b.projectId && Number(x.version) === Number(b.version); })[0];
    if (!v) throw new Error('Version not found');
    var old = v.fileId;
    var set = { fileId: b.fileId, fileName: file.getName(), size: Number(b.size) || file.getSize() };
    if (Number(b.width)) set.width = Number(b.width);
    if (Number(b.height)) set.height = Number(b.height);
    setCells('Versions', v._row, set);
    if (old && old !== b.fileId) trashFile(old);
    return { ok: true };
  });
}

/* -------------------------------------------------------------- folders */

function createFolder(b) {
  var name = String(b.name || '').trim();
  if (!name) throw new Error('Folder name cannot be empty');
  return withLock(function () {
    if (!folderExists(b.parentId)) throw new Error('Parent folder not found');
    var f = { id: 'f' + Utilities.getUuid().replace(/-/g, '').slice(0, 10), name: clean(name, 120), parentId: b.parentId || '', slug: '', createdAt: now() };
    append('Folders', f);
    return { ok: true, folder: f };
  });
}

function updateFolder(b) {
  return withLock(function () {
    var all = rows('Folders');
    var f = all.filter(function (x) { return x.id === b.id; })[0];
    if (!f) throw new Error('Folder not found');
    var set = {};
    if (b.name !== undefined) {
      if (!String(b.name).trim()) throw new Error('Folder name cannot be empty');
      set.name = clean(b.name, 120);
    }
    if (b.parentId !== undefined) {
      if (!folderExists(b.parentId)) throw new Error('Folder not found');
      // a folder cannot move into itself or one of its own sub-folders
      var cur = b.parentId;
      while (cur) {
        if (cur === f.id) throw new Error('A folder cannot go inside itself');
        var up = all.filter(function (x) { return x.id === cur; })[0];
        cur = up ? String(up.parentId || '') : '';
      }
      set.parentId = b.parentId || '';
    }
    if (b.slug !== undefined) {
      var slug = normSlug(b.slug);
      checkSlug(slug, f.id);
      set.slug = slug;
    }
    setCells('Folders', f._row, set);
    return { ok: true };
  });
}

/** Deletes a folder. Its videos and sub-folders move up one level; nothing else is deleted. */
function deleteFolder(id) {
  return withLock(function () {
    var all = rows('Folders');
    var f = all.filter(function (x) { return x.id === id; })[0];
    if (!f) throw new Error('Folder not found');
    var parent = String(f.parentId || '');
    liveProjects().filter(function (p) { return String(p.folderId) === id; })
      .forEach(function (p) { setCells('Projects', p._row, { folderId: parent }); });
    all.filter(function (x) { return String(x.parentId) === id; })
      .forEach(function (x) { setCells('Folders', x._row, { parentId: parent }); });
    sheet('Folders').deleteRow(f._row);
    return { ok: true };
  });
}

/* --------------------------------------------------------------- upload */

var UPLOAD_PREFIX = 'https://www.googleapis.com/upload/drive/';

/**
 * Opens a resumable upload session on Drive, inside FOLDER_ID, and returns its
 * URL. The browser (or the Resolve script) PUTs the file there directly, so
 * large files never pass through Apps Script and no Google token leaves this
 * script. `origin` lets the dashboard upload from its own web address.
 */
function startUpload(b) {
  var meta = { name: String(b.name || 'review.mp4'), parents: [FOLDER_ID], mimeType: b.mime || 'video/mp4' };
  var headers = {
    Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
    'X-Upload-Content-Type': meta.mimeType,
    'X-Upload-Content-Length': String(b.size || '')
  };
  if (b.origin && /^https:\/\/[\w.-]+(:\d+)?$/.test(b.origin)) headers.Origin = b.origin;
  var res = UrlFetchApp.fetch(UPLOAD_PREFIX + 'v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name', {
    method: 'post',
    contentType: 'application/json; charset=UTF-8',
    headers: headers,
    payload: JSON.stringify(meta),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw new Error('Drive refused the upload: ' + res.getContentText());
  var h = res.getAllHeaders();
  return { ok: true, uploadUrl: h.Location || h.location };
}

function checkUploadUrl(url) {
  if (String(url || '').indexOf(UPLOAD_PREFIX) !== 0) throw new Error('Bad upload address');
}

function uploadResult(res) {
  var code = res.getResponseCode();
  if (code === 200 || code === 201) {
    var file = JSON.parse(res.getContentText());
    return { ok: true, done: true, fileId: file.id };
  }
  if (code === 308) {
    var h = res.getAllHeaders();
    var range = h.Range || h.range || '';
    var m = String(range).match(/bytes=0-(\d+)/);
    return { ok: true, done: false, offset: m ? Number(m[1]) + 1 : 0 };
  }
  if (code === 404 || code === 410) throw new Error('Upload expired, please start again');
  throw new Error('Drive upload error ' + code + ': ' + res.getContentText().slice(0, 200));
}

/** How much of a resumable upload Drive already has (or the file id if it is complete). */
function uploadStatus(b) {
  checkUploadUrl(b.uploadUrl);
  var res = UrlFetchApp.fetch(b.uploadUrl, {
    method: 'put',
    headers: { 'Content-Range': 'bytes */' + Number(b.size) },
    payload: '',
    followRedirects: false,
    muteHttpExceptions: true
  });
  return uploadResult(res);
}

/**
 * Fallback when the browser cannot send to Drive directly: the dashboard sends
 * the file here in slices (base64) and this script passes them on to Drive.
 */
function uploadChunk(b) {
  checkUploadUrl(b.uploadUrl);
  var bytes = Utilities.base64Decode(b.data);
  var start = Number(b.offset), size = Number(b.size), end = start + bytes.length - 1;
  var res = UrlFetchApp.fetch(b.uploadUrl, {
    method: 'put',
    contentType: 'application/octet-stream',
    headers: { 'Content-Range': 'bytes ' + start + '-' + end + '/' + size },
    payload: bytes,
    followRedirects: false,
    muteHttpExceptions: true
  });
  return uploadResult(res);
}

function slugify(s) {
  return String(s || 'project').toLowerCase().replace(/[^a-z0-9֐-׿]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'project';
}

/**
 * Called after an upload finishes (from the dashboard or Resolve). Makes the
 * file viewable by link, creates the video if needed, and records the new version.
 */
function finalizeUpload(b) {
  if (!b.fileId) throw new Error('Missing fileId');
  var file = DriveApp.getFileById(b.fileId);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return withLock(function () {
    var projects = liveProjects();
    var id = b.projectId ? slugify(b.projectId) : null;
    var project = id && projects.filter(function (r) { return r.id === id; })[0];
    var stamp = now();
    if (!project) {
      if (b.folderId && !folderExists(b.folderId)) throw new Error('Folder not found');
      // New video: base slug + short random suffix so links are not guessable.
      id = id || (slugify(b.title) + '-' + Utilities.getUuid().slice(0, 6));
      append('Projects', {
        id: id, title: clean(b.title || file.getName(), 200), client: clean(b.client || '', 200), createdAt: stamp,
        folderId: b.folderId || '', slug: '', status: '', thumb: b.thumb ? String(b.thumb).slice(0, 49000) : '', updatedAt: stamp
      });
    } else {
      var set = { updatedAt: stamp };
      if (b.thumb) set.thumb = String(b.thumb).slice(0, 49000);
      setCells('Projects', project._row, set);
    }
    var version = rows('Versions')
      .filter(function (v) { return v.projectId === id; })
      .reduce(function (m, v) { return Math.max(m, Number(v.version) || 0); }, 0) + 1;
    append('Versions', {
      projectId: id, version: version, fileId: b.fileId, fileName: file.getName(),
      fps: Number(b.fps) || 25, startTC: "'" + String(b.startTC || '00:00:00:00'), durationFrames: Number(b.durationFrames) || 0,
      width: Number(b.width) || 0, height: Number(b.height) || 0, createdAt: stamp, size: Number(b.size) || file.getSize()
    });
    return { ok: true, projectId: id, version: version };
  });
}

/* ------------------------------------------------------------ video proxy */

// Google Drive no longer lets other websites play its files in a <video> tag
// (it answers 503). The review page falls back to fetching the video through
// this script in slices and playing it from memory. Only files registered as
// a version can be fetched.
var CHUNK_BYTES = 6 * 1024 * 1024;

function getChunk(fileId, index) {
  if (!fileId) throw new Error('Missing file');
  var cache = CacheService.getScriptCache();
  var sizeKey = 'size:' + fileId;
  var size = Number(cache.get(sizeKey) || 0);
  if (!size) {
    var known = rows('Versions').some(function (v) { return v.fileId === fileId; });
    if (!known) throw new Error('Unknown file');
    size = DriveApp.getFileById(fileId).getSize();
    cache.put(sizeKey, String(size), 21600);
  }
  var start = index * CHUNK_BYTES;
  if (start >= size) throw new Error('Out of range');
  var end = Math.min(start + CHUNK_BYTES, size) - 1;
  var res = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '?alt=media&supportsAllDrives=true', {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), Range: 'bytes=' + start + '-' + end },
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code !== 206 && code !== 200) throw new Error('Drive error ' + code);
  return { ok: true, size: size, chunks: Math.ceil(size / CHUNK_BYTES), index: index, data: Utilities.base64Encode(res.getContent()) };
}
