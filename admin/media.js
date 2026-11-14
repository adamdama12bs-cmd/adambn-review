/*
 * Reads what the review page needs from a video file before upload:
 * frame rate, frame count and start timecode (from the MP4/MOV header, the same
 * timecode track Resolve writes), size, and a small JPEG thumbnail.
 * Everything here runs in the browser; nothing is uploaded.
 */
(function () {
  'use strict';

  var CONTAINERS = { moov: 1, trak: 1, mdia: 1, minf: 1, stbl: 1, edts: 1 };

  function u32(dv, o) { return dv.getUint32(o); }
  function u64(dv, o) { return dv.getUint32(o) * 4294967296 + dv.getUint32(o + 4); }
  function type(dv, o) { return String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3)); }

  function readBytes(file, start, len) {
    return file.slice(start, start + len).arrayBuffer().then(function (b) { return new DataView(b); });
  }

  // Walks the top-level boxes of the file to find "moov" (it may be at the end).
  function findMoov(file) {
    var pos = 0, guard = 0;
    function step() {
      if (pos + 8 > file.size || guard++ > 200) return Promise.resolve(null);
      return readBytes(file, pos, 16).then(function (dv) {
        var size = u32(dv, 0), t = type(dv, 4), head = 8;
        if (size === 1) { size = u64(dv, 8); head = 16; }
        else if (size === 0) size = file.size - pos;
        if (size < head) return null;
        if (t === 'moov') {
          if (size > 80 * 1024 * 1024) return null;
          return readBytes(file, pos + head, size - head);
        }
        pos += size;
        return step();
      });
    }
    return step();
  }

  // Calls fn(type, start, end) for every box between start and end, descending into containers.
  function walk(dv, start, end, fn) {
    var o = start;
    while (o + 8 <= end) {
      var size = u32(dv, o), t = type(dv, o + 4), head = 8;
      if (size === 1) { size = u64(dv, o + 8); head = 16; }
      else if (size === 0) size = end - o;
      if (size < head || o + size > end) break;
      fn(t, o + head, o + size);
      if (CONTAINERS[t]) walk(dv, o + head, o + size, fn);
      o += size;
    }
  }

  function parseTracks(dv) {
    var tracks = [], cur = null;
    walk(dv, 0, dv.byteLength, function (t, s, e) {
      if (t === 'trak') { cur = { start: s, end: e }; tracks.push(cur); return; }
      if (!cur || s >= cur.end) return;
      var v = dv.getUint8(s);
      if (t === 'tkhd') {
        var wo = v === 1 ? 88 : 76;
        if (s + wo + 8 <= e) { cur.width = u32(dv, s + wo) / 65536; cur.height = u32(dv, s + wo + 4) / 65536; }
      } else if (t === 'mdhd') {
        if (v === 1) { cur.timescale = u32(dv, s + 20); cur.duration = u64(dv, s + 24); }
        else { cur.timescale = u32(dv, s + 12); cur.duration = u32(dv, s + 16); }
      } else if (t === 'hdlr') {
        if (!cur.handler) cur.handler = type(dv, s + 8); // the first hdlr (in mdia) is the media type
      } else if (t === 'stts') {
        var n = u32(dv, s + 4), samples = 0, dur = 0, deltas = {};
        for (var i = 0; i < n && s + 8 + i * 8 + 8 <= e; i++) {
          var c = u32(dv, s + 8 + i * 8), d = u32(dv, s + 12 + i * 8);
          samples += c; dur += c * d; deltas[d] = (deltas[d] || 0) + c;
        }
        cur.samples = samples; cur.sttsDuration = dur;
        var best = 0, bestDelta = 0;
        Object.keys(deltas).forEach(function (k) { if (deltas[k] > best) { best = deltas[k]; bestDelta = Number(k); } });
        cur.delta = bestDelta;
      } else if (t === 'stsd') {
        var es = s + 8, et = type(dv, es + 4);
        cur.codec = et;
        if (et === 'tmcd' && es + 8 + 26 <= e) {
          var b = es + 8 + 8; // after entry header + reserved(6) + dataRefIndex(2)
          cur.tc = { flags: u32(dv, b + 4), timescale: u32(dv, b + 8), frameDuration: u32(dv, b + 12), nominal: dv.getUint8(b + 16) };
        }
      } else if (t === 'stco') {
        if (u32(dv, s + 4) > 0) cur.firstChunk = u32(dv, s + 8);
      } else if (t === 'co64') {
        if (u32(dv, s + 4) > 0) cur.firstChunk = u64(dv, s + 8);
      }
    });
    return tracks;
  }

  function pad(x) { return (x < 10 ? '0' : '') + x; }
  function framesToTc(frames, fps) {
    var n = Math.round(fps) || 25, f = frames % n, s = Math.floor(frames / n);
    return pad(Math.floor(s / 3600) % 24) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60) + ':' + pad(f);
  }

  // Common rates, so 23.976 shows as 23.976 and not 23.97602.
  function tidyFps(x) {
    var known = [23.976, 24, 25, 29.97, 30, 47.952, 48, 50, 59.94, 60, 100, 119.88, 120];
    for (var i = 0; i < known.length; i++) if (Math.abs(known[i] - x) < 0.02) return known[i];
    return Math.round(x * 1000) / 1000;
  }

  /** Returns { fps, durationFrames, startTC, width, height, codec } — fields it cannot find are left out. */
  function probeHeader(file) {
    return findMoov(file).then(function (dv) {
      if (!dv) return {};
      var tracks = parseTracks(dv), out = {};
      var vid = tracks.filter(function (t) { return t.handler === 'vide'; })[0];
      if (vid) {
        if (vid.timescale && vid.delta) out.fps = tidyFps(vid.timescale / vid.delta);
        else if (vid.samples && vid.sttsDuration && vid.timescale) out.fps = tidyFps(vid.samples * vid.timescale / vid.sttsDuration);
        if (vid.samples) out.durationFrames = vid.samples;
        if (vid.width) { out.width = Math.round(vid.width); out.height = Math.round(vid.height); }
        out.codec = vid.codec;
      }
      var tc = tracks.filter(function (t) { return t.handler === 'tmcd' && t.tc && t.firstChunk; })[0];
      if (!tc) return out;
      return readBytes(file, tc.firstChunk, 4).then(function (d) {
        var nominal = tc.tc.nominal || Math.round(tc.tc.timescale / (tc.tc.frameDuration || 1)) || Math.round(out.fps || 25);
        out.startTC = framesToTc(u32(d, 0), nominal);
        if (!out.fps && tc.tc.frameDuration) out.fps = tidyFps(tc.tc.timescale / tc.tc.frameDuration);
        return out;
      });
    }).catch(function () { return {}; });
  }

  /** Loads the file in a hidden <video>, returns size/duration and a JPEG data URL (or no thumb if the browser can't decode it). */
  function probeVideo(file) {
    return new Promise(function (resolve) {
      var v = document.createElement('video'), url = URL.createObjectURL(file), done = false;
      v.muted = true; v.preload = 'auto'; v.playsInline = true;
      function finish(res) { if (done) return; done = true; URL.revokeObjectURL(url); v.removeAttribute('src'); v.load(); resolve(res); }
      var timer = setTimeout(function () { finish({ playable: false }); }, 15000);
      v.onerror = function () { clearTimeout(timer); finish({ playable: false }); };
      v.onloadedmetadata = function () {
        if (!v.videoWidth) { clearTimeout(timer); finish({ playable: false, duration: v.duration }); return; }
        v.currentTime = Math.min(Math.max(0.5, v.duration * 0.3), Math.max(0, v.duration - 0.1));
      };
      v.onseeked = function () {
        clearTimeout(timer);
        var thumb = '';
        try { thumb = makeThumb(v); } catch (e) { /* tainted or unsupported */ }
        finish({ playable: true, duration: v.duration, width: v.videoWidth, height: v.videoHeight, thumb: thumb });
      };
      v.src = url;
    });
  }

  // Small JPEG that fits in one Google Sheet cell (< 45k characters).
  function makeThumb(v) {
    var max = 360, w = v.videoWidth, h = v.videoHeight, k = Math.min(1, max / Math.max(w, h));
    var c = document.createElement('canvas');
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    var q = 0.78, data = c.toDataURL('image/jpeg', q);
    while (data.length > 45000 && q > 0.3) { q -= 0.12; data = c.toDataURL('image/jpeg', q); }
    return data.length > 45000 ? '' : data;
  }

  function probe(file) {
    return Promise.all([probeHeader(file), probeVideo(file)]).then(function (r) {
      var h = r[0], v = r[1], out = {
        fps: h.fps || 25,
        fpsKnown: !!h.fps,
        startTC: h.startTC || '',
        width: h.width || v.width || 0,
        height: h.height || v.height || 0,
        thumb: v.thumb || '',
        playable: !!v.playable,
        codec: h.codec || ''
      };
      out.durationFrames = h.durationFrames || (v.duration ? Math.round(v.duration * out.fps) : 0);
      return out;
    });
  }

  window.MediaProbe = { probe: probe, probeVideo: probeVideo, framesToTc: framesToTc };
})();
