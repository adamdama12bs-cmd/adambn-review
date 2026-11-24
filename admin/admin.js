/*
 * Adam BN dashboard: upload, organise, rename, delete and share review videos.
 * Talks to the same Apps Script backend as the review page. Owner only: every
 * action needs the admin key, which you get by signing in.
 */
(function () {
  'use strict';

  var CFG = window.REVIEW_CONFIG || {};
  var API = CFG.apiUrl;
  var KEY_STORE = 'adambn.key';
  var $ = function (id) { return document.getElementById(id); };

  // The public site address, e.g. https://adamdama12bs-cmd.github.io/adambn-review/
  // Share links use siteUrl from config.js when set (the short address), otherwise the address the dashboard is open on.
  var SITE = CFG.siteUrl || location.href.replace(/admin\/.*$/, '').replace(/[?#].*$/, '');
  if (!/\/$/.test(SITE)) SITE += '/';

  var key = '';
  try { key = localStorage.getItem(KEY_STORE) || ''; } catch (e) { /* private mode */ }

  var state = {
    lib: null,            // { projects, folders, recent, hasPassword }
    view: 'all',          // 'all' | 'inbox' | folder id
    search: '',
    selected: null,       // project id shown in the drawer
    expanded: {}
  };
  try { state.expanded = JSON.parse(localStorage.getItem('adambn.expanded') || '{}'); } catch (e) { /* ignore */ }

  /* ------------------------------------------------------------ helpers */

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; }); }

  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, 3000);
  }

  function timeAgo(iso) {
    var d = new Date(iso); if (isNaN(d)) return '';
    var s = (Date.now() - d.getTime()) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    if (s < 604800) return Math.floor(s / 86400) + ' d ago';
    return d.toLocaleDateString();
  }

  function fmtSize(b) {
    if (!b) return '';
    if (b < 1048576) return Math.round(b / 1024) + ' KB';
    if (b < 1073741824) return (b / 1048576).toFixed(b < 10485760 ? 1 : 0) + ' MB';
    return (b / 1073741824).toFixed(2) + ' GB';
  }

  function fmtDur(frames, fps) {
    if (!frames || !fps) return '';
    var s = Math.round(frames / fps), m = Math.floor(s / 60);
    return m + ':' + ('0' + (s % 60)).slice(-2);
  }

  function colorFor(name) {
    var h = 0; String(name).split('').forEach(function (ch) { h = (h * 31 + ch.charCodeAt(0)) % 360; });
    return 'hsl(' + h + ', 55%, 45%)';
  }

  function check(res) { if (res && res.error) throw new Error(res.error); return res; }

  function post(body) {
    body.key = key;
    return fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); }).then(check)
      .catch(function (e) {
        if (/Not authorized/.test(e.message)) signOut();
        throw e;
      });
  }

  function svg(path) { return '<svg viewBox="0 0 24 24"><path d="' + path + '"/></svg>'; }
  var ICON = {
    folder: 'M3 5h7l2 2h9v12H3z',
    more: 'M5 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm7 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm7 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4z',
    chev: 'M9 6l6 6-6 6-1.4-1.4 4.6-4.6-4.6-4.6z',
    link: 'M10.6 13.4a1 1 0 0 1 0-1.4l3.5-3.5a1 1 0 1 1 1.4 1.4L12 13.4a1 1 0 0 1-1.4 0zM8 19a4 4 0 0 1-2.8-6.8l2.1-2.1 1.4 1.4-2.1 2.1A2 2 0 1 0 9.4 16.4l2.1-2.1 1.4 1.4-2.1 2.1A4 4 0 0 1 8 19zm8.7-5.3-1.4-1.4 2.1-2.1A2 2 0 1 0 14.6 7.4l-2.1 2.1-1.4-1.4 2.1-2.1a4 4 0 1 1 5.6 5.6z',
    close: 'M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7 4.3 4.3l6.3 6.3 6.3-6.3z',
    play: 'M8 5v14l11-7z',
    chat: 'M4 4h16v12H7l-3 3z'
  };

  /* ------------------------------------------------------------- auth */

  function showLogin(msg) {
    $('app').hidden = true;
    $('login').hidden = false;
    $('loginErr').hidden = !msg;
    $('loginErr').textContent = msg || '';
    setTimeout(function () { $('loginPassword').focus(); }, 50);
  }

  function signOut() {
    key = '';
    try { localStorage.removeItem(KEY_STORE); } catch (e) { /* ignore */ }
    showLogin();
  }

  $('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var pw = $('loginPassword').value;
    $('loginBtn').disabled = true;
    $('loginErr').hidden = true;
    fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'login', password: pw }) })
      .then(function (r) { return r.json(); }).then(check)
      .then(function (res) {
        key = res.key;
        try { localStorage.setItem(KEY_STORE, key); } catch (err) { /* ignore */ }
        $('loginPassword').value = '';
        start();
        if (!res.hasPassword) setTimeout(function () { toast('Tip: set an easy password in Settings so you never need the key again.'); }, 1200);
      })
      .catch(function (err) {
        var m = err.message;
        if (/Unknown action/.test(m)) m = 'The backend needs updating first (new Apps Script version).';
        showLogin(m === 'Failed to fetch' ? 'Could not reach the server. Check your connection.' : m);
      })
      .then(function () { $('loginBtn').disabled = false; });
  });

  /* ----------------------------------------------------------- data */

  function load() {
    return post({ action: 'library' }).then(function (lib) {
      state.lib = lib;
      if (state.view !== 'all' && state.view !== 'inbox' && !folderById(state.view)) state.view = 'all';
      if (state.selected && !projectById(state.selected)) state.selected = null;
      render();
    });
  }

  function projectById(id) { return state.lib.projects.filter(function (p) { return p.id === id; })[0]; }
  function folderById(id) { return state.lib.folders.filter(function (f) { return f.id === id; })[0]; }
  function childFolders(id) {
    return state.lib.folders.filter(function (f) { return f.parentId === (id || ''); })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
  }
  function folderPath(id) {
    var out = [], f = folderById(id), guard = 0;
    while (f && guard++ < 50) { out.unshift(f); f = folderById(f.parentId); }
    return out;
  }
  function currentFolderId() { return state.view === 'all' || state.view === 'inbox' ? '' : state.view; }

  function projectLink(p) { return p.slug ? SITE + p.slug + '/' : SITE + '?p=' + encodeURIComponent(p.id); }
  function folderLink(f) { return f.slug ? SITE + f.slug + '/' : SITE + '?f=' + encodeURIComponent(f.id); }

  /* --------------------------------------------------------- render */

  function render() {
    renderTree();
    renderMain();
    renderDrawer();
    var open = state.lib.projects.reduce(function (n, p) { return n + p.open; }, 0);
    $('inboxBadge').hidden = !open;
    $('inboxBadge').textContent = open;
  }

  function renderTree() {
    [].forEach.call(document.querySelectorAll('.side-item'), function (b) {
      b.classList.toggle('on', b.dataset.view === state.view);
    });
    var tree = $('tree');
    tree.innerHTML = '';
    function add(parentId, depth, box) {
      childFolders(parentId).forEach(function (f) {
        var kids = childFolders(f.id).length;
        var row = document.createElement('div');
        row.className = 'tree-row' + (state.view === f.id ? ' on' : '');
        row.style.paddingLeft = (10 + depth * 14) + 'px';
        row.dataset.folder = f.id;
        row.innerHTML = '<button type="button" class="twisty' + (kids ? '' : ' none') + (state.expanded[f.id] ? ' open' : '') + '">' + svg(ICON.chev) + '</button>' +
          svg(ICON.folder) + '<span>' + esc(f.name) + '</span>';
        row.onclick = function (e) {
          if (e.target.closest('.twisty')) { toggleExpand(f.id); return; }
          go(f.id);
        };
        makeDropTarget(row, f.id);
        box.appendChild(row);
        if (kids && state.expanded[f.id]) add(f.id, depth + 1, box);
      });
    }
    add('', 0, tree);
    if (!state.lib.folders.length) tree.innerHTML = '<p class="muted small tree-empty">No folders yet. Use + to make one, e.g. one per client.</p>';
  }

  function toggleExpand(id) {
    state.expanded[id] = !state.expanded[id];
    try { localStorage.setItem('adambn.expanded', JSON.stringify(state.expanded)); } catch (e) { /* ignore */ }
    renderTree();
  }

  function go(view) {
    state.view = view;
    if (view !== 'all' && view !== 'inbox') folderPath(view).forEach(function (f) { if (f.id !== view) state.expanded[f.id] = true; });
    document.body.classList.remove('side-open');
    render();
    $('main').scrollTop = 0;
  }

  function renderHeavyBanner() {
    var heavy = 0;
    state.lib.projects.forEach(function (p) { p.versions.forEach(function (x) { if (heavyVersion(x)) heavy++; }); });
    var b = $('heavyBanner');
    if (!b) {
      b = document.createElement('div'); b.id = 'heavyBanner'; b.className = 'heavy-banner';
      $('main').insertBefore(b, $('main').firstChild);
    }
    b.hidden = !heavy || !(window.ReviewConvert && window.ReviewConvert.supported());
    if (b.hidden) return;
    b.innerHTML = '<span><b>' + heavy + ' video' + (heavy === 1 ? ' is a' : 's are') + ' heavy 4K master' + (heavy === 1 ? '' : 's') + '</b> and can stall for clients. ' +
      'Make light 1080p copies (same links, same comments, same timecode). Keep this tab open while it runs.</span>' +
      '<button class="btn small" type="button">Make them play smoothly</button>';
    b.querySelector('button').onclick = function () { window.fixAllHeavy(); b.querySelector('button').disabled = true; };
  }

  function renderMain() {
    renderHeavyBanner();
    var view = state.view, q = state.search.trim().toLowerCase();
    var crumbs = $('crumbs'), acts = $('headActions');
    $('inbox').hidden = view !== 'inbox';
    $('grid').hidden = $('foldersRow').hidden = view === 'inbox';
    acts.innerHTML = '';

    if (view === 'inbox') {
      crumbs.innerHTML = '<h1>Comments</h1>';
      renderInbox();
      $('emptyDrop').hidden = true;
      return;
    }

    var fid = currentFolderId();
    if (q) {
      crumbs.innerHTML = '<h1>Search: “' + esc(state.search.trim()) + '”</h1>';
    } else if (!fid) {
      crumbs.innerHTML = '<h1>All videos</h1>';
    } else {
      var path = folderPath(fid);
      crumbs.innerHTML = '<button type="button" data-go="all">All videos</button>' + path.map(function (f, i) {
        return '<span class="sep">/</span>' + (i === path.length - 1 ? '<h1>' + esc(f.name) + '</h1>' : '<button type="button" data-go="' + esc(f.id) + '">' + esc(f.name) + '</button>');
      }).join('');
      [].forEach.call(crumbs.querySelectorAll('[data-go]'), function (b) { b.onclick = function () { go(b.dataset.go); }; });
      var f = folderById(fid);
      acts.innerHTML = '<button class="btn ghost" type="button" data-a="share">' + svg(ICON.link) + ' Share folder</button>' +
        '<button class="icon" type="button" data-a="more" aria-label="Folder options">' + svg(ICON.more) + '</button>';
      acts.querySelector('[data-a=share]').onclick = function () { shareDialog('folder', f); };
      acts.querySelector('[data-a=more]').onclick = function (e) { folderMenu(f, e.currentTarget); };
    }

    // sub-folders
    var row = $('foldersRow');
    row.innerHTML = '';
    var subs = q ? [] : childFolders(fid);
    var newBtn = document.createElement('button');
    newBtn.type = 'button'; newBtn.className = 'folder-tile new';
    newBtn.innerHTML = svg('M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z') + '<span>New folder</span>';
    newBtn.onclick = function () { newFolder(fid); };
    subs.forEach(function (f) {
      var count = state.lib.projects.filter(function (p) { return p.folderId === f.id; }).length;
      var t = document.createElement('div');
      t.className = 'folder-tile';
      t.innerHTML = svg(ICON.folder) + '<span class="ft-name">' + esc(f.name) + '</span><span class="muted small">' + count + ' video' + (count === 1 ? '' : 's') + '</span>' +
        '<button class="icon small ft-more" type="button" aria-label="Folder options">' + svg(ICON.more) + '</button>';
      t.onclick = function (e) {
        if (e.target.closest('.ft-more')) { folderMenu(f, e.target.closest('.ft-more')); return; }
        go(f.id);
      };
      makeDropTarget(t, f.id);
      row.appendChild(t);
    });
    if (!q) row.appendChild(newBtn);

    // videos
    var list = state.lib.projects.filter(function (p) {
      if (q) return (p.title + ' ' + (p.client || '')).toLowerCase().indexOf(q) >= 0;
      return p.folderId === fid || (view === 'all' && !folderById(p.folderId));
    }).sort(function (a, b) { return a.updatedAt < b.updatedAt ? 1 : -1; });

    var grid = $('grid');
    grid.innerHTML = '';
    list.forEach(function (p) { grid.appendChild(card(p)); });
    $('emptyDrop').hidden = !!list.length || !!q;
    if (q && !list.length) grid.innerHTML = '<p class="muted">No videos match.</p>';
  }

  function card(p) {
    var v = p.versions[p.versions.length - 1] || {};
    var el = document.createElement('div');
    el.className = 'vcard' + (state.selected === p.id ? ' on' : '');
    el.draggable = true;
    var tall = v.height > v.width;
    el.innerHTML =
      '<div class="vthumb' + (tall ? ' tall' : '') + '">' +
        (p.thumb ? '<img src="' + esc(p.thumb) + '" alt="">' : '<div class="nothumb">' + svg(ICON.play) + '</div>') +
        '<span class="vbadge">v' + (v.version || 1) + '</span>' +
        (v.durationFrames ? '<span class="vdur">' + fmtDur(v.durationFrames, v.fps) + '</span>' : '') +
      '</div>' +
      '<div class="vmeta">' +
        '<div class="vtitle"><b>' + esc(p.title) + '</b>' +
          '<button class="icon small" type="button" data-a="more" aria-label="Options">' + svg(ICON.more) + '</button></div>' +
        '<div class="vsub muted">' + esc(p.client ? p.client + ' · ' : '') + esc(timeAgo(p.updatedAt)) + '</div>' +
        (p.open ? '<span class="vopen">' + svg(ICON.chat) + p.open + ' open</span>' : (p.done ? '<span class="vdone">✓ ' + p.done + ' done</span>' : '')) +
      '</div>';
    el.onclick = function (e) {
      if (e.target.closest('[data-a=more]')) { videoMenu(p, e.target.closest('[data-a=more]')); return; }
      state.selected = p.id; render();
    };
    el.ondblclick = function () { window.open(projectLink(p), '_blank'); };
    el.addEventListener('dragstart', function (e) { e.dataTransfer.setData('text/x-project', p.id); e.dataTransfer.effectAllowed = 'move'; document.body.classList.add('dragging-card'); });
    el.addEventListener('dragend', function () { document.body.classList.remove('dragging-card'); });
    return el;
  }

  function makeDropTarget(el, folderId) {
    el.addEventListener('dragover', function (e) {
      if ([].indexOf.call(e.dataTransfer.types, 'text/x-project') < 0) return;
      e.preventDefault(); el.classList.add('drop-on');
    });
    el.addEventListener('dragleave', function () { el.classList.remove('drop-on'); });
    el.addEventListener('drop', function (e) {
      var id = e.dataTransfer.getData('text/x-project');
      el.classList.remove('drop-on');
      if (!id) return;
      e.preventDefault(); e.stopPropagation();
      moveProject(projectById(id), folderId);
    });
  }

  /* ---------------------------------------------------------- inbox */

  function renderInbox() {
    var box = $('inbox');
    var items = state.lib.recent;
    if (!items.length) { box.innerHTML = '<p class="muted empty-note">No comments yet. When clients comment on a review link, they show up here.</p>'; return; }
    box.innerHTML = '';
    items.forEach(function (c) {
      var p = projectById(c.projectId);
      if (!p) return;
      var el = document.createElement('div');
      el.className = 'inbox-row' + (c.status === 'done' ? ' is-done' : '');
      el.innerHTML = '<span class="avatar" style="background:' + colorFor(c.author) + '">' + esc((c.author || '?').trim().charAt(0).toUpperCase()) + '</span>' +
        '<div class="ib-body"><div class="ib-head"><b>' + esc(c.author) + '</b> <span class="muted">' + (c.parentId ? 'replied on' : 'on') + '</span> <b>' + esc(c.projectTitle) + '</b> <span class="muted">v' + c.version + '</span>' +
        (c.timecode && !c.parentId ? ' <span class="c-tc">' + esc(c.timecode) + '</span>' : '') +
        '<span class="muted ib-time">' + esc(timeAgo(c.createdAt)) + '</span></div>' +
        '<p dir="auto">' + esc(c.text) + '</p></div>' +
        (c.parentId ? '' : '<button class="btn ghost small" type="button" data-a="toggle">' + (c.status === 'done' ? 'Reopen' : 'Mark done') + '</button>');
      el.onclick = function (e) {
        if (e.target.closest('[data-a=toggle]')) { toggleComment(c); return; }
        window.open(projectLink(p) + (projectLink(p).indexOf('?') >= 0 ? '&' : '?') + 'v=' + c.version, '_blank');
      };
      box.appendChild(el);
    });
  }

  function toggleComment(c) {
    var status = c.status === 'done' ? 'open' : 'done';
    post({ action: 'status', id: c.id, status: status }).then(function () {
      c.status = status;
      var p = projectById(c.projectId);
      if (p && !c.parentId) { p.open += status === 'done' ? -1 : 1; p.done += status === 'done' ? 1 : -1; }
      render();
    }).catch(function (e) { toast(e.message); });
  }

  /* --------------------------------------------------------- drawer */

  function renderDrawer() {
    var d = $('drawer');
    var p = state.selected && projectById(state.selected);
    document.body.classList.toggle('drawer-open', !!p);
    if (!p) { d.hidden = true; return; }
    d.hidden = false;
    var v = p.versions[p.versions.length - 1] || {};
    var link = projectLink(p);
    var comments = state.lib.recent.filter(function (c) { return c.projectId === p.id && !c.parentId; });

    d.innerHTML =
      '<div class="dr-head"><b>Details</b><button class="icon" type="button" data-a="close" aria-label="Close">' + svg(ICON.close) + '</button></div>' +
      '<div class="dr-thumb' + (v.height > v.width ? ' tall' : '') + '">' + (p.thumb ? '<img src="' + esc(p.thumb) + '" alt="">' : '') +
        '<a class="dr-play" href="' + esc(link) + '" target="_blank" rel="noopener">' + svg(ICON.play) + '</a></div>' +
      '<label class="fld"><span>Name</span><input id="drTitle" value="' + esc(p.title) + '" maxlength="200"></label>' +
      '<label class="fld"><span>Client</span><input id="drClient" value="' + esc(p.client || '') + '" maxlength="200" placeholder="Optional"></label>' +
      '<div class="fld"><span>Review link</span><div class="linkbox"><input readonly value="' + esc(link) + '"><button class="btn small" type="button" data-a="copy">Copy</button></div>' +
        '<button class="linklike" type="button" data-a="share">Change short link</button></div>' +
      '<div class="dr-actions">' +
        '<a class="btn ghost small" href="' + esc(link) + '" target="_blank" rel="noopener">Open review</a>' +
        '<button class="btn ghost small" type="button" data-a="version">Upload new version</button>' +
        '<button class="btn ghost small" type="button" data-a="move">Move</button>' +
      '</div>' +
      '<h3>Versions</h3><div class="versions">' +
        p.versions.slice().reverse().map(function (x) {
          return '<div class="ver"><b>v' + x.version + '</b><span class="muted">' + esc(timeAgo(x.createdAt)) +
            [x.width && x.height ? x.width + '×' + x.height : '', x.fps ? x.fps + ' fps' : '', fmtSize(x.size)].filter(Boolean).map(function (s) { return ' · ' + s; }).join('') + '</span>' +
            '<a class="linklike" href="' + esc(link + (link.indexOf('?') >= 0 ? '&' : '?') + 'v=' + x.version) + '" target="_blank" rel="noopener">Open</a>' +
            (heavyVersion(x) ? '<button class="linklike fixv" type="button" data-fix-version="' + x.version + '" title="Make a light 1080p copy so it streams smoothly for clients">Make it play smoothly</button>' : '') +
            (p.versions.length > 1 ? '<button class="linklike danger" type="button" data-del-version="' + x.version + '">Delete</button>' : '') + '</div>';
        }).join('') + '</div>' +
      '<h3>Comments <span class="muted">' + p.open + ' open · ' + p.done + ' done</span></h3>' +
      '<div class="dr-comments">' + (comments.length ? comments.map(function (c) {
        return '<div class="dc' + (c.status === 'done' ? ' is-done' : '') + '" data-c="' + esc(c.id) + '"><span class="c-tc">' + esc(c.timecode || '—') + '</span> <span class="muted">v' + c.version + '</span> <b>' + esc(c.author) + '</b><p dir="auto">' + esc(c.text) + '</p>' +
          '<button class="linklike" type="button" data-toggle="' + esc(c.id) + '">' + (c.status === 'done' ? 'Reopen' : 'Mark done') + '</button></div>';
      }).join('') : '<p class="muted small">No comments yet.</p>') + '</div>' +
      '<button class="btn ghost small danger" type="button" data-a="delete">Delete video</button>';

    d.querySelector('[data-a=close]').onclick = function () { state.selected = null; render(); };
    d.querySelector('[data-a=copy]').onclick = function () { copy(link); };
    d.querySelector('[data-a=share]').onclick = function () { shareDialog('project', p); };
    d.querySelector('[data-a=version]').onclick = function () { pickFiles({ projectId: p.id }); };
    d.querySelector('[data-a=move]').onclick = function () { moveDialog(p); };
    d.querySelector('[data-a=delete]').onclick = function () { deleteProject(p); };
    [].forEach.call(d.querySelectorAll('[data-fix-version]'), function (b) {
      b.onclick = function () { fixVersion(p, Number(b.dataset.fixVersion)); };
    });
    [].forEach.call(d.querySelectorAll('[data-del-version]'), function (b) {
      b.onclick = function () { deleteVersion(p, Number(b.dataset.delVersion)); };
    });
    [].forEach.call(d.querySelectorAll('[data-toggle]'), function (b) {
      b.onclick = function () { toggleComment(state.lib.recent.filter(function (c) { return c.id === b.dataset.toggle; })[0]); };
    });
    bindSave($('drTitle'), function (val) {
      if (!val.trim()) { $('drTitle').value = p.title; return; }
      if (val === p.title) return;
      p.title = val; renderMain();
      post({ action: 'updateProject', id: p.id, title: val }).then(function () { toast('Renamed'); }).catch(function (e) { toast(e.message); load(); });
    });
    bindSave($('drClient'), function (val) {
      if (val === (p.client || '')) return;
      p.client = val; renderMain();
      post({ action: 'updateProject', id: p.id, client: val }).then(function () { toast('Saved'); }).catch(function (e) { toast(e.message); load(); });
    });
  }

  function bindSave(input, fn) {
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { input.value = input.defaultValue; input.blur(); } });
    input.addEventListener('blur', function () { fn(input.value.trim()); });
  }

  function copy(text) {
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
      .then(function () { toast('Link copied'); })
      .catch(function () { window.prompt('Copy this link:', text); });
  }

  /* ---------------------------------------------------------- menus */

  function openMenu(anchor, items) {
    var m = $('menu');
    m.innerHTML = '';
    items.forEach(function (it) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = it[0];
      if (it[2]) b.className = 'danger';
      b.onclick = function () { closeMenu(); it[1](); };
      m.appendChild(b);
    });
    m.hidden = false;
    var r = anchor.getBoundingClientRect();
    var w = m.offsetWidth, h = m.offsetHeight;
    m.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + 'px';
    m.style.top = (r.bottom + h + 8 > innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4) + 'px';
  }
  function closeMenu() { $('menu').hidden = true; }
  document.addEventListener('click', function (e) { if (!e.target.closest('#menu') && !e.target.closest('[data-a=more]') && !e.target.closest('.ft-more')) closeMenu(); });

  function videoMenu(p, anchor) {
    openMenu(anchor, [
      ['Copy review link', function () { copy(projectLink(p)); }],
      ['Open review', function () { window.open(projectLink(p), '_blank'); }],
      ['Share settings…', function () { shareDialog('project', p); }],
      ['Rename', function () { renameProject(p); }],
      ['Move to…', function () { moveDialog(p); }],
      ['Upload new version', function () { pickFiles({ projectId: p.id }); }],
      ['Delete', function () { deleteProject(p); }, true]
    ]);
  }

  function folderMenu(f, anchor) {
    openMenu(anchor, [
      ['Copy folder link', function () { copy(folderLink(f)); }],
      ['Share settings…', function () { shareDialog('folder', f); }],
      ['Rename', function () { renameFolder(f); }],
      ['New folder inside', function () { newFolder(f.id); }],
      ['Move to…', function () { moveFolderDialog(f); }],
      ['Delete folder', function () { deleteFolder(f); }, true]
    ]);
  }

  /* -------------------------------------------------------- dialogs */

  function dialog(html, onReady) {
    $('dlgBox').innerHTML = html;
    $('dlg').hidden = false;
    var first = $('dlgBox').querySelector('input:not([readonly]), select, textarea');
    if (first) setTimeout(function () { first.focus(); if (first.select) first.select(); }, 30);
    [].forEach.call($('dlgBox').querySelectorAll('[data-dlg-close]'), function (b) { b.onclick = closeDialog; });
    if (onReady) onReady($('dlgBox'));
  }
  function closeDialog() { $('dlg').hidden = true; $('dlgBox').innerHTML = ''; }
  document.querySelector('.dlg-backdrop').onclick = closeDialog;
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { if (!$('dlg').hidden) closeDialog(); closeMenu(); } });

  function ask(title, label, value, okText, fn) {
    dialog('<form class="dlg-form"><h2>' + esc(title) + '</h2><label class="fld"><span>' + esc(label) + '</span><input name="v" value="' + esc(value || '') + '" maxlength="200" required></label>' +
      '<div class="dlg-btns"><button class="btn ghost" type="button" data-dlg-close>Cancel</button><button class="btn" type="submit">' + esc(okText) + '</button></div></form>', function (box) {
      box.querySelector('form').onsubmit = function (e) {
        e.preventDefault();
        var v = box.querySelector('[name=v]').value.trim();
        if (!v) return;
        closeDialog(); fn(v);
      };
    });
  }

  function confirmDlg(title, text, okText, fn) {
    dialog('<div class="dlg-form"><h2>' + esc(title) + '</h2><p class="muted">' + text + '</p>' +
      '<div class="dlg-btns"><button class="btn ghost" type="button" data-dlg-close>Cancel</button><button class="btn danger-btn" type="button" data-ok>' + esc(okText) + '</button></div></div>', function (box) {
      box.querySelector('[data-ok]').onclick = function () { closeDialog(); fn(); };
    });
  }

  function newFolder(parentId) {
    ask('New folder', 'Name', '', 'Create', function (name) {
      post({ action: 'createFolder', name: name, parentId: parentId || '' }).then(function (res) {
        state.lib.folders.push(res.folder);
        if (parentId) state.expanded[parentId] = true;
        render(); toast('Folder created');
      }).catch(function (e) { toast(e.message); });
    });
  }

  function renameFolder(f) {
    ask('Rename folder', 'Name', f.name, 'Save', function (name) {
      var prev = f.name; f.name = name; render();
      post({ action: 'updateFolder', id: f.id, name: name }).catch(function (e) { f.name = prev; render(); toast(e.message); });
    });
  }

  function renameProject(p) {
    ask('Rename video', 'Name', p.title, 'Save', function (name) {
      var prev = p.title; p.title = name; render();
      post({ action: 'updateProject', id: p.id, title: name }).catch(function (e) { p.title = prev; render(); toast(e.message); });
    });
  }

  function deleteFolder(f) {
    var n = state.lib.projects.filter(function (p) { return p.folderId === f.id; }).length;
    var parent = folderById(f.parentId);
    confirmDlg('Delete “' + f.name + '”?', 'Only the folder is removed. Its ' + n + ' video' + (n === 1 ? '' : 's') + ' and any sub-folders move to <b>' + esc(parent ? parent.name : 'All videos') + '</b>. Old folder links stop working.', 'Delete folder', function () {
      post({ action: 'deleteFolder', id: f.id }).then(function () {
        if (state.view === f.id) state.view = parent ? parent.id : 'all';
        toast('Folder deleted'); return load();
      }).catch(function (e) { toast(e.message); });
    });
  }

  function deleteProject(p) {
    confirmDlg('Delete “' + p.title + '”?', 'The review link stops working and its ' + p.versions.length + ' file' + (p.versions.length === 1 ? '' : 's') + ' go to your Google Drive trash (you can restore them from there for 30 days).', 'Delete video', function () {
      post({ action: 'deleteProject', id: p.id }).then(function () {
        state.lib.projects = state.lib.projects.filter(function (x) { return x.id !== p.id; });
        if (state.selected === p.id) state.selected = null;
        render(); toast('Video deleted');
      }).catch(function (e) { toast(e.message); });
    });
  }

  function deleteVersion(p, version) {
    confirmDlg('Delete version ' + version + '?', 'The file goes to your Google Drive trash. Comments on this version stay in the Sheet but are hidden.', 'Delete version', function () {
      post({ action: 'deleteVersion', projectId: p.id, version: version }).then(function () {
        p.versions = p.versions.filter(function (v) { return v.version !== version; });
        render(); toast('Version deleted');
      }).catch(function (e) { toast(e.message); });
    });
  }

  function folderOptions(excludeId) {
    var out = [['', 'All videos (no folder)', 0]];
    function add(pid, depth) {
      childFolders(pid).forEach(function (f) {
        if (f.id === excludeId) return;
        out.push([f.id, f.name, depth + 1]);
        add(f.id, depth + 1);
      });
    }
    add('', 0);
    return out;
  }

  function pickFolder(title, current, excludeId, fn) {
    var opts = folderOptions(excludeId);
    dialog('<div class="dlg-form"><h2>' + esc(title) + '</h2><div class="pick">' + opts.map(function (o) {
      return '<button type="button" class="pick-row' + (o[0] === current ? ' on' : '') + '" data-id="' + esc(o[0]) + '" style="padding-left:' + (12 + o[2] * 16) + 'px">' + svg(ICON.folder) + esc(o[1]) + '</button>';
    }).join('') + '</div><div class="dlg-btns"><button class="btn ghost" type="button" data-dlg-close>Cancel</button></div></div>', function (box) {
      [].forEach.call(box.querySelectorAll('.pick-row'), function (b) { b.onclick = function () { closeDialog(); fn(b.dataset.id); }; });
    });
  }

  function moveDialog(p) { pickFolder('Move “' + p.title + '” to', p.folderId, null, function (fid) { moveProject(p, fid); }); }

  function moveProject(p, fid) {
    if (!p || p.folderId === fid) return;
    var prev = p.folderId; p.folderId = fid; render();
    var f = folderById(fid);
    post({ action: 'updateProject', id: p.id, folderId: fid })
      .then(function () { toast('Moved to ' + (f ? f.name : 'All videos')); })
      .catch(function (e) { p.folderId = prev; render(); toast(e.message); });
  }

  function moveFolderDialog(f) {
    pickFolder('Move “' + f.name + '” into', f.parentId, f.id, function (pid) {
      var prev = f.parentId; f.parentId = pid; render();
      post({ action: 'updateFolder', id: f.id, parentId: pid }).catch(function (e) { f.parentId = prev; render(); toast(e.message); });
    });
  }

  function shareDialog(kind, item) {
    var link = kind === 'folder' ? folderLink(item) : projectLink(item);
    var name = kind === 'folder' ? item.name : item.title;
    var suggestion = item.slug || String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
    dialog('<div class="dlg-form share"><h2>Share “' + esc(name) + '”</h2>' +
      '<p class="muted">' + (kind === 'folder'
        ? 'Anyone with this link sees the videos in this folder (and its sub-folders) and can comment on each one.'
        : 'Anyone with this link can watch and leave comments at exact frames. No sign-in needed.') + '</p>' +
      '<div class="linkbox big"><input readonly id="shLink" value="' + esc(link) + '"><button class="btn" type="button" id="shCopy">Copy</button></div>' +
      '<form id="shForm" class="fld"><span>Short link</span><div class="slug-row"><span class="muted slug-prefix">' + esc(SITE.replace(/^https?:\/\//, '')) + '</span>' +
        '<input id="shSlug" value="' + esc(item.slug || '') + '" placeholder="' + esc(suggestion || 'e.g. client-name') + '" maxlength="60"><button class="btn ghost small" type="submit">Save</button></div>' +
        '<small class="muted">Letters, numbers and dashes. Leave empty to use the private long link.</small></form>' +
      '<div class="dlg-btns"><a class="btn ghost" id="shOpen" href="' + esc(link) + '" target="_blank" rel="noopener">Open</a><button class="btn ghost" type="button" data-dlg-close>Done</button></div></div>', function (box) {
      box.querySelector('#shCopy').onclick = function () { copy($('shLink').value); };
      box.querySelector('#shForm').onsubmit = function (e) {
        e.preventDefault();
        var slug = $('shSlug').value.trim().toLowerCase().replace(/[^a-z0-9֐-׿]+/g, '-').replace(/^-+|-+$/g, '');
        $('shSlug').value = slug;
        var body = kind === 'folder' ? { action: 'updateFolder', id: item.id, slug: slug } : { action: 'updateProject', id: item.id, slug: slug };
        post(body).then(function () {
          item.slug = slug;
          var l = kind === 'folder' ? folderLink(item) : projectLink(item);
          $('shLink').value = l; $('shOpen').href = l;
          render(); toast(slug ? 'Short link saved' : 'Short link removed');
        }).catch(function (err) { toast(err.message); });
      };
    });
  }

  function settingsDialog() {
    dialog('<form class="dlg-form"><h2>Settings</h2>' +
      '<label class="fld"><span>' + (state.lib && state.lib.hasPassword ? 'Change password' : 'Set a password') + '</span><input type="password" name="pw" minlength="8" placeholder="At least 8 characters" autocomplete="new-password"></label>' +
      '<p class="muted small">You can always sign in with the admin key too.</p>' +
      '<div class="dlg-btns"><button class="btn ghost" type="button" id="signOut">Sign out</button><span class="grow"></span><button class="btn ghost" type="button" data-dlg-close>Close</button><button class="btn" type="submit">Save password</button></div></form>', function (box) {
      box.querySelector('#signOut').onclick = function () { closeDialog(); signOut(); };
      box.querySelector('form').onsubmit = function (e) {
        e.preventDefault();
        var pw = box.querySelector('[name=pw]').value;
        if (pw.length < 8) { toast('Use at least 8 characters'); return; }
        post({ action: 'setPassword', password: pw }).then(function () {
          if (state.lib) state.lib.hasPassword = true;
          closeDialog(); toast('Password saved');
        }).catch(function (err) { toast(err.message); });
      };
    });
  }

  /* --------------------------------------------------------- upload */

  var pendingTarget = null;

  function pickFiles(target) {
    pendingTarget = target || { folderId: currentFolderId() };
    $('fileInput').value = '';
    $('fileInput').click();
  }

  $('fileInput').onchange = function () {
    var files = [].slice.call(this.files || []);
    if (files.length) prepareUpload(files, pendingTarget || { folderId: currentFolderId() });
  };

  function baseName(n) { return String(n).replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim(); }

  function prepareUpload(files, target) {
    files = files.filter(function (f) { return /^video\//.test(f.type) || /\.(mp4|mov|m4v|webm)$/i.test(f.name); });
    if (!files.length) { toast('Only video files can be uploaded'); return; }
    var project = target.projectId && projectById(target.projectId);
    if (project) files = files.slice(0, 1);
    var prev = project && project.versions[project.versions.length - 1];
    var folder = folderById(target.folderId);
    var lastTc = '';
    try { lastTc = localStorage.getItem('adambn.lastTC') || ''; } catch (e) { /* ignore */ }

    var rows = files.map(function (f, i) {
      return '<div class="up-row" data-i="' + i + '">' +
        '<div class="up-thumb"><span class="spin"></span></div>' +
        '<div class="up-fields">' +
          (project ? '<div class="up-name"><b>' + esc(project.title) + '</b> <span class="muted">→ version ' + ((prev && prev.version || 0) + 1) + '</span></div>'
            : '<input class="up-title" value="' + esc(baseName(f.name)) + '" maxlength="200" placeholder="Name">') +
          '<div class="up-tech">' +
            '<label>FPS <input class="up-fps" inputmode="decimal" value="' + esc(prev ? prev.fps : 25) + '"></label>' +
            '<label>Start TC <input class="up-tc" value="' + esc(prev ? prev.startTC : (lastTc || '00:00:00:00')) + '" maxlength="11"></label>' +
            '<span class="muted small up-info">' + fmtSize(f.size) + ' · reading…</span>' +
          '</div>' +
          '<label class="up-conv"' + (window.ReviewConvert && window.ReviewConvert.supported() ? '' : ' hidden') + '><input type="checkbox" class="up-light"' + (likelyHeavy(f) ? ' checked' : '') + '> Make a light review copy (1080p H.264) so it plays smoothly</label>' +
          '<div class="up-warn" hidden></div>' +
        '</div></div>';
    }).join('');

    dialog('<form class="dlg-form wide"><h2>' + (project ? 'New version of “' + esc(project.title) + '”' : 'Upload ' + files.length + ' video' + (files.length === 1 ? '' : 's') + ' to ' + esc(folder ? folder.name : 'All videos')) + '</h2>' +
      (project ? '' : '<label class="fld"><span>Client (optional)</span><input class="up-client" maxlength="200" placeholder="e.g. Nike"></label>') +
      '<div class="up-list">' + rows + '</div>' +
      '<p class="muted small">Timecode and frame rate are read from the file when it has them (Resolve .mov exports do). Comments use them to land on the exact frame in Resolve.</p>' +
      '<div class="dlg-btns"><button class="btn ghost" type="button" data-dlg-close>Cancel</button><button class="btn" type="submit" id="upGo">Upload</button></div></form>', function (box) {
      var probes = files.map(function (f, i) {
        var row = box.querySelector('.up-row[data-i="' + i + '"]');
        return window.MediaProbe.probe(f).then(function (m) {
          if (!row.isConnected) return m;
          row.querySelector('.up-thumb').innerHTML = m.thumb ? '<img src="' + m.thumb + '" alt="">' : svg(ICON.play);
          if (m.fpsKnown && !prev) row.querySelector('.up-fps').value = m.fps;
          if (m.fpsKnown && prev) row.querySelector('.up-fps').value = m.fps;
          if (m.startTC) row.querySelector('.up-tc').value = m.startTC;
          row.querySelector('.up-info').textContent = [fmtSize(f.size), m.width && m.height ? m.width + '×' + m.height : '', m.durationFrames ? fmtDur(m.durationFrames, m.fps) : '', m.startTC ? 'TC from file' : ''].filter(Boolean).join(' · ');
          var warn = [], light = row.querySelector('.up-light'), canConvert = window.ReviewConvert && window.ReviewConvert.supported();
          var heavy = window.ReviewConvert ? window.ReviewConvert.needed(m, f.size) : false;
          if (light && !light.dataset.touched) light.checked = heavy && canConvert;
          if (heavy && canConvert) warn.push('This is a heavy master' + (m.width ? ' (' + m.width + '×' + m.height + ')' : '') + '. A light copy is made on this computer before upload, so clients can watch without stalling. Timecode stays the same.');
          else if (!m.playable) warn.push('Browsers can’t play this file (probably ProRes or another edit codec). Export an H.264 .mp4 for review.');
          else if (heavy) warn.push('Big file: clients may see it stall. A 1080p H.264 export of the same edit streams much better.');
          if (warn.length) { var w = row.querySelector('.up-warn'); w.hidden = false; w.textContent = warn.join(' '); }
          return m;
        });
      });
      [].forEach.call(box.querySelectorAll('.up-light'), function (c) { c.onchange = function () { c.dataset.touched = '1'; }; });
      box.querySelector('form').onsubmit = function (e) {
        e.preventDefault();
        var client = box.querySelector('.up-client') ? box.querySelector('.up-client').value.trim() : '';
        var jobs = files.map(function (f, i) {
          var row = box.querySelector('.up-row[data-i="' + i + '"]');
          var tc = row.querySelector('.up-tc').value.trim();
          if (!/^\d\d[:;]\d\d[:;]\d\d[:;]\d\d$/.test(tc)) tc = '00:00:00:00';
          return {
            file: f, probe: probes[i],
            title: project ? project.title : (row.querySelector('.up-title').value.trim() || baseName(f.name)),
            client: client, fps: Number(row.querySelector('.up-fps').value) || 25, startTC: tc,
            projectId: project ? project.id : '', folderId: project ? project.folderId : (target.folderId || ''),
            light: !!(row.querySelector('.up-light') && row.querySelector('.up-light').checked && !row.querySelector('.up-conv').hidden)
          };
        });
        try { localStorage.setItem('adambn.lastTC', jobs[0].startTC); } catch (err) { /* ignore */ }
        closeDialog();
        jobs.forEach(enqueue);
      };
    });
  }

  /* upload queue */

  var queue = [], running = false;

  function enqueue(job) {
    job.el = document.createElement('div');
    job.el.className = 'upl';
    job.el.innerHTML = '<div class="upl-top"><b>' + esc(job.title) + '</b><span class="upl-pct muted">Waiting</span></div><div class="upl-bar"><i></i></div>';
    $('uploads').hidden = false;
    $('uploads').appendChild(job.el);
    queue.push(job);
    window.onbeforeunload = function () { return 'Uploads are still running'; };
    next();
  }

  function setJob(job, pct, text) {
    job.el.querySelector('i').style.width = Math.max(0, Math.min(100, pct)) + '%';
    job.el.querySelector('.upl-pct').textContent = text;
  }

  function next() {
    if (running) return;
    var job = queue.shift();
    if (!job) {
      window.onbeforeunload = null;
      return;
    }
    running = true;
    runJob(job).then(function (res) {
      job.el.classList.add('ok');
      setJob(job, 100, 'Done');
      var link = SITE + '?p=' + encodeURIComponent(res.projectId);
      var a = document.createElement('div');
      a.className = 'upl-done';
      a.innerHTML = '<button class="linklike" type="button">Copy link</button><button class="linklike" type="button">Close</button>';
      a.children[0].onclick = function () {
        var p = projectById(res.projectId); copy(p ? projectLink(p) : link);
      };
      a.children[1].onclick = function () { job.el.remove(); if (!$('uploads').children.length) $('uploads').hidden = true; };
      job.el.appendChild(a);
      state.selected = res.projectId;
      return load();
    }).catch(function (e) {
      job.el.classList.add('err');
      setJob(job, 100, 'Failed');
      var m = document.createElement('div');
      m.className = 'upl-done';
      m.innerHTML = '<span class="small">' + esc(e.message) + '</span> <button class="linklike" type="button">Close</button>';
      m.querySelector('button').onclick = function () { job.el.remove(); if (!$('uploads').children.length) $('uploads').hidden = true; };
      job.el.appendChild(m);
    }).then(function () { running = false; next(); });
  }

  function runJob(job) {
    var project = job.projectId && projectById(job.projectId);
    var vnum = project ? (project.versions.reduce(function (m, v) { return Math.max(m, v.version); }, 0) + 1) : 1;
    setJob(job, 0, job.light ? 'Making light copy…' : 'Starting…');

    var prepared = job.light
      ? window.ReviewConvert.convert(job.file, function (p) { setJob(job, p * 100, 'Making light copy ' + Math.floor(p * 100) + '%'); })
          .then(function (c) { return { blob: c.blob, width: c.width, height: c.height, name: 'review.mp4', mime: 'video/mp4' }; }, function (e) {
            // Could not convert on this computer: upload the original rather than nothing.
            toast('Light copy failed (' + e.message + '). Uploading the original.');
            return null;
          })
      : Promise.resolve(null);

    return prepared.then(function (c) {
      var f = c ? c.blob : job.file, size = f.size;
      var name = c ? c.name : job.file.name;
      var mime = c ? c.mime : (job.file.type || (/\.mov$/i.test(name) ? 'video/quicktime' : 'video/mp4'));
      var ext = (name.match(/\.[^.]+$/) || ['.mp4'])[0];
      var driveName = job.title.replace(/[\\/:*?"<>|]+/g, ' ') + ' v' + vnum + ext;
      setJob(job, 0, 'Uploading…');
      return post({ action: 'startUpload', name: driveName, size: size, mime: mime, origin: location.origin })
        .then(function (s) {
          return sendFile(s.uploadUrl, f, function (sent, how) {
            setJob(job, sent / size * 100, 'Uploading ' + Math.floor(sent / size * 100) + '%' + (how === 'relay' ? ' (slow mode)' : ''));
          });
        })
        .then(function (fileId) {
          setJob(job, 100, 'Finishing…');
          return job.probe.then(function (m) {
            return post({
              action: 'finalizeUpload', fileId: fileId, projectId: job.projectId || '', folderId: job.folderId,
              title: job.title, client: job.client, fps: job.fps, startTC: job.startTC,
              durationFrames: m.durationFrames || 0, width: (c && c.width) || m.width || 0, height: (c && c.height) || m.height || 0,
              thumb: m.thumb || '', size: size
            });
          });
        });
    });
  }

  /* ------------------------------------------- light copies of old uploads */

  function likelyHeavy(f) { return /\.mov$/i.test(f.name) || f.size > 250 * 1048576; }

  function heavyVersion(x) {
    if (!x.fileId) return false;
    var secs = x.durationFrames && x.fps ? x.durationFrames / x.fps : 0;
    var mbps = secs && x.size ? x.size * 8 / secs / 1e6 : 0;
    return /\.mov$/i.test(x.fileName || '') || Math.max(x.width || 0, x.height || 0) > 1920 || mbps > 16;
  }

  // Fetches the original through the backend in slices (the same route the review page
  // falls back to). Google rate-limits big downloads with the public API key, so it isn't used here.
  function driveSource(fileId, onProgress) {
    function get(i, tries) {
      return fetch(API + '?action=chunk&f=' + encodeURIComponent(fileId) + '&i=' + i)
        .then(function (r) { return r.json(); }).then(check)
        .catch(function (e) {
          if ((tries || 0) >= 3) throw e;
          return new Promise(function (ok) { setTimeout(ok, 2000 * ((tries || 0) + 1)); }).then(function () { return get(i, (tries || 0) + 1); });
        });
    }
    function bytes(b64) {
      var bin = atob(b64), out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    return get(0).then(function (first) {
      var parts = [bytes(first.data)], next = 1, done = 1;
      onProgress(done / first.chunks);
      function worker() {
        if (next >= first.chunks) return Promise.resolve();
        var i = next++;
        return get(i).then(function (c) { parts[i] = bytes(c.data); done++; onProgress(done / first.chunks); return worker(); });
      }
      var pool = [];
      for (var w = 0; w < 5; w++) pool.push(worker());
      return Promise.all(pool).then(function () { return new Blob(parts); });
    });
  }

  var fixing = {}, fixChain = Promise.resolve();

  /** Replaces a heavy version's file with a light copy. Same version number, same comments, same link. */
  function fixVersion(p, version) {
    var x = p.versions.filter(function (v) { return v.version === version; })[0];
    if (!x || fixing[x.fileId]) return;
    if (!window.ReviewConvert || !window.ReviewConvert.supported()) { toast('Open the dashboard in Chrome on your computer to do this.'); return; }
    fixing[x.fileId] = true;
    var job = { title: p.title + (p.versions.length > 1 ? ' v' + version : '') + ' · light copy' };
    job.el = document.createElement('div');
    job.el.className = 'upl';
    job.el.innerHTML = '<div class="upl-top"><b>' + esc(job.title) + '</b><span class="upl-pct muted">Waiting</span></div><div class="upl-bar"><i></i></div>';
    $('uploads').hidden = false;
    $('uploads').appendChild(job.el);
    window.onbeforeunload = function () { return 'A light copy is still being made'; };

    // One at a time: converting is heavy work for the computer.
    fixChain = fixChain.then(function () {
     return driveSource(x.fileId, function (pr) { setJob(job, pr * 100, 'Fetching from Drive ' + Math.floor(pr * 100) + '%'); }).then(function (src) {
      setJob(job, 0, 'Making light copy…');
      return window.ReviewConvert.convert(src, function (pr) { setJob(job, pr * 100, 'Making light copy ' + Math.floor(pr * 100) + '%'); });
     })
      .then(function (c) {
        var size = c.blob.size;
        var driveName = p.title.replace(/[\\/:*?"<>|]+/g, ' ') + ' v' + version + '.mp4';
        return post({ action: 'startUpload', name: driveName, size: size, mime: 'video/mp4', origin: location.origin })
          .then(function (s) {
            return sendFile(s.uploadUrl, c.blob, function (sent, how) {
              setJob(job, sent / size * 100, 'Uploading ' + Math.floor(sent / size * 100) + '%' + (how === 'relay' ? ' (slow mode)' : ''));
            });
          })
          .then(function (fileId) {
            setJob(job, 100, 'Finishing…');
            return post({ action: 'replaceVersionFile', projectId: p.id, version: version, fileId: fileId, size: size, width: c.width, height: c.height });
          });
      })
      .then(function () {
        job.el.classList.add('ok'); setJob(job, 100, 'Done');
        toast('“' + p.title + '” now plays smoothly');
        return load();
      })
      .catch(function (e) {
        job.el.classList.add('err'); setJob(job, 100, 'Failed');
        var m = document.createElement('div');
        m.className = 'upl-done';
        m.innerHTML = '<span class="small">' + esc(e.message) + '</span> <button class="linklike" type="button">Close</button>';
        m.querySelector('button').onclick = function () { job.el.remove(); if (!$('uploads').children.length) $('uploads').hidden = true; };
        job.el.appendChild(m);
      })
      .then(function () {
        delete fixing[x.fileId];
        if (!Object.keys(fixing).length && !running) window.onbeforeunload = null;
        setTimeout(function () { if (job.el.classList.contains('ok')) { job.el.remove(); if (!$('uploads').children.length) $('uploads').hidden = true; } }, 4000);
      });
    });
  }

  /** Exposed so every heavy video can be fixed in one go from the console or a button. */
  window.fixAllHeavy = function () {
    (state.lib ? state.lib.projects : []).forEach(function (p) {
      p.versions.forEach(function (x) { if (heavyVersion(x)) fixVersion(p, x.version); });
    });
  };

  /**
   * Sends the file to the Drive upload session. Tries the fast way first
   * (browser → Drive). If the browser isn't allowed to (or the connection
   * drops), it asks the backend how much arrived and carries on from there,
   * falling back to sending slices through the backend.
   */
  function sendFile(url, file, progress) {
    var size = file.size, directTries = 0;

    function status() { return post({ action: 'uploadStatus', uploadUrl: url, size: size }); }

    function direct(offset) {
      directTries++;
      return new Promise(function (resolve, reject) {
        var x = new XMLHttpRequest(), moved = false;
        x.open('PUT', url);
        if (offset > 0) x.setRequestHeader('Content-Range', 'bytes ' + offset + '-' + (size - 1) + '/' + size);
        x.upload.onprogress = function (e) { if (e.loaded > 0) moved = true; progress(offset + e.loaded, 'direct'); };
        x.onload = function () {
          if (x.status === 200 || x.status === 201) {
            try { resolve({ done: true, fileId: JSON.parse(x.responseText).id }); } catch (e) { resolve({ check: true, moved: true }); }
          } else resolve({ check: true, moved: moved });
        };
        x.onerror = function () { resolve({ check: true, moved: moved }); };
        x.send(offset > 0 ? file.slice(offset) : file);
      });
    }

    var RELAY = 8 * 1024 * 1024; // multiple of 256 KB, as Drive requires

    function toBase64(blob) {
      return new Promise(function (resolve, reject) {
        var r = new FileReader();
        r.onload = function () { resolve(String(r.result).split(',')[1] || ''); };
        r.onerror = function () { reject(new Error('Could not read the file')); };
        r.readAsDataURL(blob);
      });
    }

    function relay(offset, fails) {
      progress(offset, 'relay');
      var chunk = file.slice(offset, Math.min(offset + RELAY, size));
      return toBase64(chunk)
        .then(function (data) { return post({ action: 'uploadChunk', uploadUrl: url, offset: offset, size: size, data: data }); })
        .then(function (r) {
          if (r.done) return r.fileId;
          return relay(r.offset, 0);
        }, function (e) {
          if (fails >= 4 || /expired/.test(e.message)) throw e;
          return new Promise(function (ok) { setTimeout(ok, 2000 * (fails + 1)); })
            .then(status)
            .then(function (s) { return s.done ? s.fileId : relay(s.offset, fails + 1); });
        });
    }

    function attempt(offset) {
      return direct(offset).then(function (r) {
        if (r.done) return r.fileId;
        return status().then(function (s) {
          if (s.done) return s.fileId;
          // Browser not allowed to talk to Drive, or too many drops: go through the backend.
          if (!r.moved || directTries >= 3) return relay(s.offset, 0);
          return attempt(s.offset);
        });
      });
    }

    return attempt(0);
  }

  /* drag & drop files anywhere */

  var dragDepth = 0;
  function hasFiles(e) { return [].indexOf.call(e.dataTransfer.types || [], 'Files') >= 0; }
  document.addEventListener('dragenter', function (e) {
    if (!hasFiles(e) || $('app').hidden) return;
    dragDepth++;
    var f = folderById(currentFolderId());
    $('dropTarget').textContent = f ? f.name : 'All videos';
    $('dropOverlay').hidden = false;
  });
  document.addEventListener('dragleave', function (e) { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('dropOverlay').hidden = true; });
  document.addEventListener('dragover', function (e) { if (hasFiles(e)) e.preventDefault(); });
  document.addEventListener('drop', function (e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0; $('dropOverlay').hidden = true;
    if ($('app').hidden) return;
    var files = [].slice.call(e.dataTransfer.files || []);
    if (files.length) prepareUpload(files, { folderId: currentFolderId() });
  });

  /* ----------------------------------------------------------- boot */

  function applyBrand() {
    var c = CFG.colors || {};
    var map = { bg: '--bg', surface: '--surface', surface2: '--surface2', border: '--border', text: '--text', muted: '--muted', accent: '--accent', accentText: '--accent-text', done: '--done' };
    Object.keys(map).forEach(function (k) { if (c[k]) document.documentElement.style.setProperty(map[k], c[k]); });
    if (CFG.font && CFG.font.family) document.documentElement.style.setProperty('--font', CFG.font.family);
    if (CFG.font && CFG.font.googleFontsUrl) {
      var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = CFG.font.googleFontsUrl; document.head.appendChild(l);
    }
    var b = CFG.brand || {};
    var logo = b.logoUrl ? (/^(https?:|data:|\/)/.test(b.logoUrl) ? b.logoUrl : '../' + b.logoUrl) : '';
    var html = logo ? '<img src="' + esc(logo) + '" alt="' + esc(b.name || '') + '">' : '<span class="dot"></span>' + esc(b.name || 'Studio');
    $('brand').innerHTML = html + '<span class="brand-tag">Studio</span>';
    $('loginLogo').innerHTML = html;
    document.title = (b.name || 'Review') + ' · Studio';
  }

  function bindUi() {
    [].forEach.call(document.querySelectorAll('.side-item'), function (b) { b.onclick = function () { go(b.dataset.view); }; });
    makeDropTarget(document.querySelector('.side-item[data-view=all]'), '');
    $('newFolderSide').onclick = function () { newFolder(''); };
    $('uploadBtn').onclick = function () { pickFiles({ folderId: currentFolderId() }); };
    $('emptyDrop').onclick = function () { pickFiles({ folderId: currentFolderId() }); };
    $('settingsBtn').onclick = settingsDialog;
    $('menuBtn').onclick = function () { document.body.classList.toggle('side-open'); };
    $('search').addEventListener('input', function () { state.search = this.value; if (state.view === 'inbox') state.view = 'all'; renderMain(); renderTree(); });
    $('brand').onclick = function (e) { e.preventDefault(); $('search').value = ''; state.search = ''; go('all'); };
  }

  function start() {
    $('login').hidden = true;
    $('app').hidden = false;
    $('grid').innerHTML = '<p class="muted">Loading your videos…</p>';
    load().catch(function (e) {
      if (!key) return;
      var m = /Unknown action/.test(e.message) ? 'The backend needs the new Apps Script version before the dashboard can load.' : e.message;
      $('grid').innerHTML = '<p class="muted">' + esc(m) + '</p>';
    });
  }

  applyBrand();
  bindUi();
  if (!API) showLogin('No backend address in config.js yet.');
  else if (key) start();
  else showLogin();

  // keep comments fresh while the tab is open
  setInterval(function () { if (key && !document.hidden && !running && $('dlg').hidden && !(document.activeElement && document.activeElement.closest && document.activeElement.closest('#drawer'))) load().catch(function () {}); }, 60000);
})();
