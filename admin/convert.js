/*
 * Makes a light "review copy" of a video right here in the browser:
 * H.264 .mp4, at most 1920 px on the long side, ~8 Mbit/s, a key frame every
 * second (fast, frame-accurate seeking) and the index at the front of the file
 * so it starts playing straight away. Uses the computer's own video
 * encoder (WebCodecs) through the Mediabunny library; nothing is uploaded
 * until it is done.
 *
 * 4K HEVC/ProRes masters (60-80 Mbit/s) are what made client playback stall:
 * Drive can't stream that fast and many browsers can't decode HEVC at all.
 */
(function () {
  'use strict';

  var LIB = 'vendor/mediabunny-1.65.2.min.mjs';
  var MAX_SIDE = 1920;
  var BITRATE = 8e6;
  var lib = null;

  function load() {
    if (!lib) lib = import(new URL(LIB, document.baseURI).href);
    return lib;
  }

  function supported() {
    return typeof window.VideoEncoder === 'function' && typeof window.VideoDecoder === 'function';
  }

  /**
   * True when a file is too heavy for smooth streaming or not playable everywhere.
   * `probe` is what MediaProbe.probe returned for it.
   */
  function needed(probe, size) {
    var codec = String(probe.codec || '').toLowerCase();
    var w = probe.width || 0, h = probe.height || 0;
    var secs = probe.durationFrames && probe.fps ? probe.durationFrames / probe.fps : 0;
    var mbps = secs ? size * 8 / secs / 1e6 : 0;
    if (codec && codec !== 'avc1' && codec !== 'avc3') return true;   // HEVC, ProRes, …
    if (Math.max(w, h) > MAX_SIDE) return true;                          // 4K
    if (mbps > 16) return true;                                         // very high bitrate
    if (!secs && size > 300 * 1048576) return true;
    return false;
  }

  /**
   * Converts `source` (a File/Blob, or a URL string) and resolves with
   * { blob, width, height }. `onProgress(0..1)` reports progress.
   */
  function convert(source, onProgress, opts) {
    opts = opts || {};
    if (!supported()) return Promise.reject(new Error('This browser can’t make a review copy. Use Chrome on a computer.'));
    return load().then(function (MB) {
      var input = new MB.Input({
        formats: MB.ALL_FORMATS,
        source: typeof source === 'string' ? new MB.UrlSource(source) : new MB.BlobSource(source)
      });
      var target = new MB.BufferTarget();
      var output = new MB.Output({ format: new MB.Mp4OutputFormat({ fastStart: 'in-memory' }), target: target });
      var size = { width: 0, height: 0 };

      return MB.Conversion.init({
        input: input,
        output: output,
        tracks: 'primary',
        video: function (track) {
          return Promise.all([track.getDisplayWidth(), track.getDisplayHeight()]).then(function (d) {
            var w = d[0], h = d[1], o = {
              codec: opts.videoCodec || 'avc', quality: new MB.Quality({ bitrate: BITRATE }), keyFrameInterval: 1, forceTranscode: true
            };
            if (Math.max(w, h) > MAX_SIDE) {
              if (w >= h) { o.width = MAX_SIDE; size.width = MAX_SIDE; size.height = Math.round(h * MAX_SIDE / w / 2) * 2; }
              else { o.height = MAX_SIDE; size.height = MAX_SIDE; size.width = Math.round(w * MAX_SIDE / h / 2) * 2; }
            } else { size.width = w; size.height = h; }
            return o;
          });
        },
        // AAC (what Resolve writes) is copied as is; anything else becomes AAC.
        audio: function (track) {
          var want = opts.audioCodec || 'aac';
          return track.getCodec().then(function (codec) {
            return codec === want ? { codec: want } : { codec: want, quality: new MB.Quality({ bitrate: 256000 }) };
          });
        }
      }).then(function (conv) {
        var hasVideo = conv.utilizedTracks.some(function (t) { return t.type === 'video'; });
        if (!conv.isValid || !hasVideo) {
          var why = conv.discardedTracks.map(function (d) { return d.reason; }).join(', ');
          throw new Error('This browser can’t convert this file' + (why ? ' (' + why + ')' : '') + '.');
        }
        if (onProgress) conv.onProgress = function (p) { onProgress(Math.max(0, Math.min(1, p))); };
        return conv.execute().then(function () {
          return { blob: new Blob([target.buffer], { type: 'video/mp4' }), width: size.width, height: size.height };
        });
      });
    });
  }

  window.ReviewConvert = { supported: supported, needed: needed, convert: convert, maxSide: MAX_SIDE };
})();
