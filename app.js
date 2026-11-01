(function () {
  'use strict';

  var CFG = window.REVIEW_CONFIG || {};
  var T = CFG.text || {};
  var params = new URLSearchParams(location.search);
  var projectId = params.get('p');
  var adminKey = params.get('key') || '';
  var DEMO = !CFG.apiUrl || params.get('demo') === '1';

  var $ = function (id) { return document.getElementById(id); };
  var video = $('video');

  var state = {
    data: null,          // { project, versions, comments, portfolio, admin }
    version: null,       // current version object
    filter: 'all',
    replyTo: null,
    activeId: null,
    composerFrame: 0
  };

  /* ---------------------------------------------------------- branding */

  function applyBrand() {
    var c = CFG.colors || {};
    var map = { bg: '--bg', surface: '--surface', surface2: '--surface2', border: '--border', text: '--text', muted: '--muted', accent: '--accent', accentText: '--accent-text', done: '--done' };
    Object.keys(map).forEach(function (k) { if (c[k]) document.documentElement.style.setProperty(map[k], c[k]); });
    if (CFG.font && CFG.font.family) document.documentElement.style.setProperty('--font', CFG.font.family);
    if (CFG.font && CFG.font.googleFontsUrl) {
      var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = CFG.font.googleFontsUrl; document.head.appendChild(l);
    }
    var b = CFG.brand || {};
    var brand = $('brand');
    brand.href = b.website || '#';
    if (b.logoUrl) {
      var img = document.createElement('img'); img.src = b.logoUrl; img.alt = b.name || ''; brand.appendChild(img);
    } else {
      var dot = document.createElement('span'); dot.className = 'dot'; brand.appendChild(dot);
      brand.appendChild(document.createTextNode(b.name || 'Review'));
    }
    $('lblComments').textContent = T.comments || 'Comments';
    $('commentInput').placeholder = T.placeholder || '';
    $('authorInput').placeholder = T.yourName || 'Your name';
    $('sendBtn').textContent = T.send || 'Send';
    $('lblAt').textContent = T.attachTime || 'At';
    $('portfolioTitle').innerHTML = esc(CFG.portfolioTitle || 'More work').replace(/\*(.+?)\*/g, '<em>$1</em>') + (b.name ? ' by ' + esc(b.name) : '');

    var foot = $('footer');
    var parts = [];
    parts.push('<span>© ' + new Date().getFullYear() + ' ' + esc(b.name || '') + (b.tagline ? ' · ' + esc(b.tagline) : '') + '</span>');
    if (b.website) parts.push('<a href="' + escAttr(b.website) + '" target="_blank" rel="noopener">' + esc(b.website.replace(/^https?:\/\//, '')) + '</a>');
    if (b.email) parts.push('<a href="mailto:' + escAttr(b.email) + '">' + esc(b.email) + '</a>');
    if (b.instagram) parts.push('<a href="https://instagram.com/' + escAttr(b.instagram) + '" target="_blank" rel="noopener">@' + esc(b.instagram) + '</a>');
    foot.innerHTML = parts.join('');

    ['all', 'open', 'done'].forEach(function (f) {
      var btn = document.createElement('button');
      btn.type = 'button'; btn.textContent = T[f] || f; btn.dataset.f = f;
      if (f === state.filter) btn.className = 'on';
      btn.onclick = function () { state.filter = f; [].forEach.call($('filters').children, function (x) { x.className = x.dataset.f === f ? 'on' : ''; }); renderComments(); };
      $('filters').appendChild(btn);
    });
  }

  /* ---------------------------------------------------------- helpers */

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; }); }
  function escAttr(s) { return esc(s); }

  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, 2600);
  }

  function nominal(fps) { return Math.round(fps) || 25; }

  function tcToFrames(tc, fps) {
    var m = String(tc || '').match(/(\d+)[:;](\d+)[:;](\d+)[:;.](\d+)/);
    if (!m) return 0;
    var n = nominal(fps);
    return ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * n + +m[4];
  }

  function framesToTc(frames, fps) {
    var n = nominal(fps);
    frames = Math.max(0, Math.round(frames));
    var f = frames % n, s = Math.floor(frames / n);
    var p = function (x) { return (x < 10 ? '0' : '') + x; };
    return p(Math.floor(s / 3600)) + ':' + p(Math.floor(s / 60) % 60) + ':' + p(s % 60) + ':' + p(f);
  }

  function fps() { return (state.version && state.version.fps) || 25; }
  function startFrames() { return state.version ? tcToFrames(state.version.startTC, fps()) : 0; }
  function currentFrame() { return Math.floor(video.currentTime * fps() + 1e-4); }
  function frameToTc(frame) { return framesToTc(startFrames() + frame, fps()); }
  function totalFrames() {
    if (isFinite(video.duration) && video.duration > 0) return Math.round(video.duration * fps());
    return (state.version && state.version.durationFrames) || 0;
  }
  function seekFrame(frame) {
    frame = Math.max(0, Math.min(frame, Math.max(0, totalFrames() - 1)));
    video.currentTime = (frame + 0.5) / fps();
  }

  function timeAgo(iso) {
    var d = new Date(iso); if (isNaN(d)) return '';
    var s = (Date.now() - d.getTime()) / 1000;
    if (s < 60) return 'now';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return Math.floor(s / 3600) + 'h';
    if (s < 604800) return Math.floor(s / 86400) + 'd';
    return d.toLocaleDateString();
  }

  function colorFor(name) {
    var h = 0; String(name).split('').forEach(function (ch) { h = (h * 31 + ch.charCodeAt(0)) % 360; });
    return 'hsl(' + h + ', 55%, 45%)';
  }

  function videoUrl(v) {
    if (v.src) return v.src; // demo
    if (CFG.driveApiKey) return 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(v.fileId) + '?alt=media&key=' + encodeURIComponent(CFG.driveApiKey);
    return 'https://drive.usercontent.google.com/download?id=' + encodeURIComponent(v.fileId) + '&export=download&confirm=t';
  }

  /* -------------------------------------------------------------- api */

  var api = DEMO ? demoApi() : {
    review: function () {
      return fetch(CFG.apiUrl + '?action=review&p=' + encodeURIComponent(projectId) + '&key=' + encodeURIComponent(adminKey))
        .then(function (r) { return r.json(); }).then(check);
    },
    post: function (body) {
      return fetch(CFG.apiUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
        .then(function (r) { return r.json(); }).then(check);
    }
  };

  function check(res) { if (res && res.error) throw new Error(res.error); return res; }

  function demoApi() {
    var now = Date.now();
    var iso = function (minAgo) { return new Date(now - minAgo * 60000).toISOString(); };
    var db = {
      project: { id: 'demo', title: 'Summer campaign — 30s spot', client: 'Demo client' },
      versions: [
        { version: 1, src: 'demo/sample.mp4', fps: 25, startTC: '01:00:00:00', durationFrames: 500, createdAt: iso(3000) },
        { version: 2, src: 'demo/sample.mp4', fps: 25, startTC: '01:00:00:00', durationFrames: 500, createdAt: iso(200) }
      ],
      comments: [
        { id: 'c1', version: 2, frame: 63, timecode: '01:00:02:13', author: 'Noa', text: 'Can we hold this shot a little longer?', parentId: null, status: 'open', createdAt: iso(90) },
        { id: 'c2', version: 2, frame: 63, timecode: '01:00:02:13', author: 'Adam', text: 'Sure, adding 12 frames.', parentId: 'c1', status: 'open', createdAt: iso(70) },
        { id: 'c3', version: 2, frame: 212, timecode: '01:00:08:12', author: 'Noa', text: 'Logo is a bit too small here.', parentId: null, status: 'done', createdAt: iso(60) },
        { id: 'c4', version: 2, frame: 390, timecode: '01:00:15:15', author: 'Daniel', text: 'Music feels too loud under the VO.', parentId: null, status: 'open', createdAt: iso(20) },
        { id: 'c5', version: 1, frame: 100, timecode: '01:00:04:00', author: 'Noa', text: 'Colour is too warm.', parentId: null, status: 'done', createdAt: iso(2900) }
      ],
      portfolio: [
        { title: 'Big Buck Bunny', subtitle: 'Short film · 2008', url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ' },
        { title: 'Sintel', subtitle: 'Short film · 2010', url: 'https://www.youtube.com/watch?v=eRsGyueVLvQ' },
        { title: 'Tears of Steel', subtitle: 'Short film · 2012', url: 'https://www.youtube.com/watch?v=R6MlUcmOul8' },
        { title: 'Cosmos Laundromat', subtitle: 'Short film · 2015', url: 'https://www.youtube.com/watch?v=Y-rmzh0PI3c' }
      ],
      admin: true
    };
    return {
      review: function () { return Promise.resolve(JSON.parse(JSON.stringify(db))); },
      post: function (b) {
        if (b.action === 'comment') {
          var c = { id: 'd' + Math.random().toString(36).slice(2, 8), version: b.version, frame: b.frame, timecode: b.timecode, author: b.author, text: b.text, parentId: b.parentId || null, status: 'open', createdAt: new Date().toISOString() };
          db.comments.push(c); return Promise.resolve({ ok: true, comment: c });
        }
        var c2 = db.comments.filter(function (x) { return x.id === b.id; })[0];
        if (b.action === 'status' && c2) c2.status = b.status;
        if (b.action === 'delete') db.comments = db.comments.filter(function (x) { return x.id !== b.id; });
        return Promise.resolve({ ok: true });
      }
    };
  }

  /* ------------------------------------------------------------- load */

  function load(first) {
    return api.review().then(function (data) {
      state.data = data;
      if (first) {
        document.title = data.project.title + ' · ' + ((CFG.brand && CFG.brand.name) || 'Review');
        $('projectTitle').textContent = data.project.title;
        $('projectClient').textContent = data.project.client || '';
        var sel = $('versionSelect');
        sel.innerHTML = '';
        data.versions.forEach(function (v) {
          var o = document.createElement('option');
          o.value = v.version; o.textContent = (T.version || 'Version') + ' ' + v.version;
          sel.appendChild(o);
        });
        sel.hidden = data.versions.length < 2;
        var wanted = Number(params.get('v'));
        var v = data.versions.filter(function (x) { return x.version === wanted; })[0] || data.versions[data.versions.length - 1];
        if (!v) throw new Error('This project has no video yet.');
        selectVersion(v.version);
        renderPortfolio();
      } else {
        renderComments();
        renderMarkers();
      }
    });
  }

  function selectVersion(num) {
    var v = state.data.versions.filter(function (x) { return x.version === Number(num); })[0];
    if (!v) return;
    state.version = v;
    $('versionSelect').value = v.version;
    $('videoError').hidden = true;
    video.src = videoUrl(v);
    var dl = $('downloadBtn');
    if (CFG.allowDownload && v.fileId) {
      dl.hidden = false; dl.textContent = T.download || 'Download';
      dl.href = 'https://drive.google.com/uc?export=download&id=' + encodeURIComponent(v.fileId);
    }
    var u = new URL(location.href); u.searchParams.set('v', v.version); history.replaceState(null, '', u);
    $('tcDur').textContent = frameToTc(v.durationFrames || 0);
    updateTime();
    renderComments();
    renderMarkers();
  }

  /* --------------------------------------------------------- comments */

  function versionComments() {
    return state.data.comments.filter(function (c) { return c.version === state.version.version; });
  }

  function renderComments() {
    var list = $('commentList');
    var all = versionComments();
    var roots = all.filter(function (c) { return !c.parentId; });
    $('commentCount').textContent = roots.length;
    var shown = roots.filter(function (c) { return state.filter === 'all' || c.status === state.filter; })
      .sort(function (a, b) { return a.frame - b.frame || (a.createdAt < b.createdAt ? -1 : 1); });
    list.innerHTML = '';
    if (!shown.length) {
      list.innerHTML = '<div class="empty">' + esc(roots.length ? '—' : (T.noComments || 'No comments yet.')) + '</div>';
      return;
    }
    shown.forEach(function (c) {
      var el = commentEl(c, false);
      var replies = all.filter(function (r) { return r.parentId === c.id; }).sort(function (a, b) { return a.createdAt < b.createdAt ? -1 : 1; });
      if (replies.length) {
        var box = document.createElement('div'); box.className = 'replies';
        replies.forEach(function (r) { box.appendChild(commentEl(r, true)); });
        el.appendChild(box);
      }
      list.appendChild(el);
    });
  }

  function commentEl(c, isReply) {
    var el = document.createElement('div');
    el.className = 'comment' + (c.status === 'done' ? ' is-done' : '') + (state.activeId === c.id ? ' active' : '');
    el.dataset.id = c.id;
    var html = '<div class="c-head"><span class="avatar" style="background:' + colorFor(c.author) + '">' + esc((c.author || '?').trim().charAt(0).toUpperCase()) + '</span>' +
      '<span class="c-author">' + esc(c.author) + '</span>' +
      (c.status === 'done' && !isReply ? '<span class="c-done-badge">✓</span>' : '') +
      '<span class="c-time">' + esc(timeAgo(c.createdAt)) + '</span></div>';
    if (!isReply) html += '<span class="c-tc">' + esc(c.timecode || frameToTc(c.frame)) + '</span>';
    html += '<p class="c-text" dir="auto">' + esc(c.text) + '</p>';
    var acts = [];
    if (!isReply) acts.push('<button type="button" data-act="reply">' + esc(T.reply || 'Reply') + '</button>');
    if (state.data.admin && !isReply) acts.push('<button type="button" data-act="toggle">' + esc(c.status === 'done' ? (T.reopen || 'Reopen') : (T.markDone || 'Mark done')) + '</button>');
    if (state.data.admin) acts.push('<button type="button" data-act="delete">' + esc(T.remove || 'Delete') + '</button>');
    if (acts.length) html += '<div class="c-actions">' + acts.join('') + '</div>';
    el.innerHTML = html;

    el.addEventListener('click', function (e) {
      var act = e.target.closest('[data-act]');
      if (act && act.closest('.comment') === el) {
        e.stopPropagation();
        if (act.dataset.act === 'reply') startReply(c);
        if (act.dataset.act === 'toggle') setStatus(c, c.status === 'done' ? 'open' : 'done');
        if (act.dataset.act === 'delete' && confirm('Delete this comment?')) removeComment(c);
        return;
      }
      if (isReply) return;
      e.stopPropagation();
      jumpTo(c);
    });
    return el;
  }

  function jumpTo(c) {
    video.pause();
    state.activeId = c.id;
    seekFrame(c.frame);
    renderComments();
    renderMarkers();
  }

  function startReply(c) {
    state.replyTo = c;
    var r = $('replying');
    r.hidden = false;
    r.innerHTML = 'Replying to <b>' + esc(c.author) + '</b> · <button type="button">cancel</button>';
    r.querySelector('button').onclick = cancelReply;
    $('attachTc').closest('label').style.visibility = 'hidden';
    $('commentInput').focus();
  }

  function cancelReply() {
    state.replyTo = null;
    $('replying').hidden = true;
    $('attachTc').closest('label').style.visibility = '';
  }

  function setStatus(c, status) {
    var prev = c.status; c.status = status; renderComments(); renderMarkers();
    api.post({ action: 'status', key: adminKey, id: c.id, status: status }).catch(function (e) { c.status = prev; renderComments(); renderMarkers(); toast(e.message); });
  }

  function removeComment(c) {
    api.post({ action: 'delete', key: adminKey, id: c.id }).then(function () {
      state.data.comments = state.data.comments.filter(function (x) { return x.id !== c.id && x.parentId !== c.id; });
      renderComments(); renderMarkers();
    }).catch(function (e) { toast(e.message); });
  }

  function submitComment(e) {
    e.preventDefault();
    var text = $('commentInput').value.trim();
    var author = $('authorInput').value.trim();
    if (!author) { $('authorInput').focus(); toast(T.yourName || 'Your name'); return; }
    if (!text) { $('commentInput').focus(); return; }
    try { localStorage.setItem('review.author', author); } catch (err) { /* private mode */ }

    var reply = state.replyTo;
    var frame = reply ? reply.frame : ($('attachTc').checked ? state.composerFrame : 0);
    var body = {
      action: 'comment', p: projectId, version: state.version.version,
      frame: frame, timecode: reply ? reply.timecode : ($('attachTc').checked ? frameToTc(frame) : ''),
      author: author, text: text, parentId: reply ? reply.id : ''
    };
    $('sendBtn').disabled = true;
    api.post(body).then(function (res) {
      res.comment.version = Number(res.comment.version); res.comment.frame = Number(res.comment.frame);
      state.data.comments.push(res.comment);
      $('commentInput').value = '';
      cancelReply();
      renderComments(); renderMarkers();
    }).catch(function (err) { toast(err.message); })
      .then(function () { $('sendBtn').disabled = false; });
  }

  /* ---------------------------------------------------------- markers */

  function renderMarkers() {
    var box = $('scrubMarkers');
    box.innerHTML = '';
    var total = totalFrames();
    if (!total) return;
    versionComments().filter(function (c) { return !c.parentId && c.timecode; }).forEach(function (c) {
      var m = document.createElement('div');
      m.className = 'marker' + (c.status === 'done' ? ' done' : '') + (state.activeId === c.id ? ' active' : '');
      m.style.left = (Math.min(c.frame, total) / total * 100) + '%';
      m.title = c.author + ': ' + c.text;
      m.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
      m.addEventListener('click', function (e) { e.stopPropagation(); jumpTo(c); scrollToComment(c.id); });
      m.addEventListener('mouseenter', function () { showHover(m.style.left, c.author + ': ' + c.text); });
      m.addEventListener('mouseleave', function () { $('scrubHover').hidden = true; });
      box.appendChild(m);
    });
  }

  function scrollToComment(id) {
    var el = document.querySelector('.comment[data-id="' + id + '"]');
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function showHover(left, text) {
    var h = $('scrubHover'); h.textContent = text; h.style.left = left; h.hidden = false;
  }

  /* ----------------------------------------------------------- player */

  function updateTime() {
    var f = currentFrame();
    $('tcNow').textContent = frameToTc(f);
    var total = totalFrames();
    $('scrubFill').style.width = total ? (f / total * 100) + '%' : '0';
    if (document.activeElement !== $('commentInput') || !$('commentInput').value) {
      state.composerFrame = f;
      $('composerTc').textContent = frameToTc(f);
    }
  }

  function updateBuffer() {
    try {
      var b = video.buffered;
      if (b.length && video.duration) $('scrubBuffer').style.width = (b.end(b.length - 1) / video.duration * 100) + '%';
    } catch (e) { /* ignore */ }
  }

  function togglePlay() { if (video.paused) video.play(); else video.pause(); }

  function bindPlayer() {
    video.addEventListener('click', togglePlay);
    $('playBtn').onclick = togglePlay;
    $('prevFrame').onclick = function () { video.pause(); seekFrame(currentFrame() - 1); };
    $('nextFrame').onclick = function () { video.pause(); seekFrame(currentFrame() + 1); };
    $('muteBtn').onclick = function () { video.muted = !video.muted; $('muteBtn').classList.toggle('muted-ctl', video.muted); };
    $('speedSelect').onchange = function () { video.playbackRate = Number(this.value); };
    $('fsBtn').onclick = function () {
      var p = $('player');
      if (document.fullscreenElement) document.exitFullscreen();
      else if (p.requestFullscreen) p.requestFullscreen();
      else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
    };
    video.addEventListener('play', function () { $('player').classList.add('playing'); $('playBtn').classList.add('playing-ctl'); state.activeId = null; });
    video.addEventListener('pause', function () { $('player').classList.remove('playing'); $('playBtn').classList.remove('playing-ctl'); });
    video.addEventListener('timeupdate', updateTime);
    video.addEventListener('seeked', updateTime);
    video.addEventListener('progress', updateBuffer);
    video.addEventListener('loadedmetadata', function () { $('tcDur').textContent = frameToTc(totalFrames()); renderMarkers(); updateTime(); });
    video.addEventListener('error', function () {
      var err = $('videoError');
      err.hidden = false;
      err.textContent = 'The video could not be loaded. If it was just uploaded, give Google Drive a minute and refresh.';
    });

    // smooth timecode while playing
    (function tick() { if (!video.paused) updateTime(); requestAnimationFrame(tick); })();

    // scrubbing
    var scrub = $('scrub'), dragging = false;
    function frameAt(e) {
      var r = scrub.getBoundingClientRect();
      var x = Math.min(Math.max(0, e.clientX - r.left), r.width);
      return Math.floor(x / r.width * totalFrames());
    }
    scrub.addEventListener('pointerdown', function (e) { dragging = true; scrub.setPointerCapture(e.pointerId); video.pause(); seekFrame(frameAt(e)); });
    scrub.addEventListener('pointermove', function (e) {
      var f = frameAt(e);
      if (dragging) seekFrame(f);
      if (e.target === scrub || e.target.closest('.scrub-track')) {
        var r = scrub.getBoundingClientRect();
        showHover(((e.clientX - r.left) / r.width * 100) + '%', frameToTc(f));
      }
    });
    scrub.addEventListener('pointerup', function () { dragging = false; });
    scrub.addEventListener('pointerleave', function () { if (!dragging) $('scrubHover').hidden = true; });

    // keyboard
    document.addEventListener('keydown', function (e) {
      var tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && e.target.id === 'commentInput') $('composer').requestSubmit();
        if (e.key === 'Escape') e.target.blur();
        return;
      }
      if (!$('modal').hidden) { if (e.key === 'Escape') closeModal(); return; }
      if (e.key === ' ' || e.key === 'k') { e.preventDefault(); togglePlay(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); video.pause(); seekFrame(currentFrame() - (e.shiftKey ? nominal(fps()) : 1)); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); video.pause(); seekFrame(currentFrame() + (e.shiftKey ? nominal(fps()) : 1)); }
      else if (e.key === 'f') $('fsBtn').click();
      else if (e.key === 'm') $('muteBtn').click();
    });

    // writing a comment pauses the video and locks the timecode
    $('commentInput').addEventListener('focus', function () {
      video.pause();
      state.composerFrame = currentFrame();
      $('composerTc').textContent = frameToTc(state.composerFrame);
    });
    $('composer').addEventListener('submit', submitComment);
    $('versionSelect').onchange = function () { video.pause(); state.activeId = null; selectVersion(this.value); };

    try { $('authorInput').value = localStorage.getItem('review.author') || ''; } catch (e) { /* ignore */ }
  }

  /* -------------------------------------------------------- portfolio */

  function parseLink(url) {
    var m;
    if ((m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/))) {
      return { embed: 'https://www.youtube.com/embed/' + m[1] + '?autoplay=1&rel=0', thumb: 'https://i.ytimg.com/vi/' + m[1] + '/hqdefault.jpg' };
    }
    if ((m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/))) {
      return { embed: 'https://player.vimeo.com/video/' + m[1] + '?autoplay=1', thumb: 'https://vumbnail.com/' + m[1] + '.jpg' };
    }
    if ((m = url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?.*id=)([\w-]{20,})/))) {
      return { embed: 'https://drive.google.com/file/d/' + m[1] + '/preview', thumb: 'https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w640' };
    }
    if (/\.(mp4|webm|mov)(\?|$)/i.test(url)) return { video: url, thumb: '' };
    return { link: url, thumb: '' };
  }

  function renderPortfolio() {
    var items = state.data.portfolio || [];
    if (!items.length) return;
    $('portfolioSection').hidden = false;
    var grid = $('portfolioGrid');
    items.forEach(function (p) {
      var info = parseLink(String(p.url));
      var card = document.createElement('button');
      card.type = 'button'; card.className = 'card';
      var thumb = p.thumbnail || info.thumb;
      card.innerHTML = '<div class="thumb"' + (thumb ? ' style="background-image:url(\'' + encodeURI(thumb).replace(/'/g, '%27') + '\')"' : '') + '></div>' +
        '<div class="meta"><b>' + esc(p.title) + '</b>' + (p.subtitle ? '<span>' + esc(p.subtitle) + '</span>' : '') + '</div>';
      card.onclick = function () {
        if (info.link) { window.open(info.link, '_blank', 'noopener'); return; }
        video.pause();
        openModal(info);
      };
      grid.appendChild(card);
    });
  }

  function openModal(info) {
    var f = $('modalFrame');
    f.innerHTML = '';
    if (info.video) {
      var v = document.createElement('video'); v.src = info.video; v.controls = true; v.autoplay = true; f.appendChild(v);
    } else {
      var ifr = document.createElement('iframe'); ifr.src = info.embed; ifr.allow = 'autoplay; fullscreen; picture-in-picture'; ifr.allowFullscreen = true; f.appendChild(ifr);
    }
    $('modal').hidden = false;
  }

  function closeModal() { $('modal').hidden = true; $('modalFrame').innerHTML = ''; }

  /* -------------------------------------------------------------- go */

  applyBrand();
  bindPlayer();
  [].forEach.call(document.querySelectorAll('[data-close]'), function (el) { el.onclick = closeModal; });

  if (!projectId && !DEMO) {
    $('projectTitle').textContent = 'Nothing to review here';
    $('commentList').innerHTML = '<div class="empty">This link is missing its project. Ask for a new link.</div>';
    return;
  }
  if (DEMO) projectId = projectId || 'demo';

  load(true).then(function () {
    // pick up new comments from other reviewers
    setInterval(function () { if (!document.hidden) load(false).catch(function () {}); }, 30000);
  }).catch(function (e) {
    $('projectTitle').textContent = 'Could not open this review';
    $('commentList').innerHTML = '<div class="empty">' + esc(e.message) + '</div>';
  });
})();
