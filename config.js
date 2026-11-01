/*
 * Your branding and connection settings. This is the only file you need to
 * edit to change the look of the review site.
 */
window.REVIEW_CONFIG = {
  // Paste your Apps Script Web App URL here (ends with /exec). Leave empty for demo mode.
  apiUrl: 'https://script.google.com/macros/s/AKfycbyiqUK5jdSNU6PgfnhFmTejeqUwGz6NQcXt3HAHM9pmvS6qD_vQvhwUcIfEah3_MI_B/exec',

  // Google Cloud API key with the Google Drive API enabled (lets the browser stream the video from Drive).
  driveApiKey: '',

  brand: {
    name: 'Adam BN',               // shown top-left when there is no logo, and in "More work by ..."
    logoUrl: 'logo-white.png',    // white version for the blue theme; 'logo.png' is the black one for light backgrounds. e.g. 'logo.png' (put the file next to index.html) or a full URL
    tagline: 'Video editing & post-production',
    website: '',                  // e.g. 'https://adam.studio'
    email: '',                    // shown in the footer
    instagram: ''                 // e.g. 'adam.edits' (without @)
  },

  // Colors: any CSS color. Change accent first, it drives buttons, markers and highlights.
  colors: {
    bg: '#1f40aa',                     // royal blue
    surface: 'rgba(8, 22, 84, 0.32)',  // panels (darker, see-through blue)
    surface2: 'rgba(255, 255, 255, 0.08)',
    border: 'rgba(255, 255, 255, 0.14)',
    text: '#ffffff',
    muted: '#b9c6f2',
    accent: '#ef8842',                 // orange
    accentText: '#ffffff',
    done: '#5be3a0'
  },

  font: {
    family: "'Inter', system-ui, -apple-system, sans-serif",
    googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap'
  },

  allowDownload: false,           // show a download button to the client
  portfolioTitle: 'More *work*',  // heading above your previous projects; *word* is shown in the accent color

  // UI text, in case you want it in another language.
  text: {
    comments: 'Comments',
    placeholder: 'Leave a comment at this frame…',
    yourName: 'Your name',
    send: 'Send',
    reply: 'Reply',
    attachTime: 'At',
    noComments: 'No comments yet. Pause the video anywhere and write what you want changed.',
    all: 'All', open: 'Open', done: 'Done',
    markDone: 'Mark done', reopen: 'Reopen', remove: 'Delete',
    version: 'Version',
    download: 'Download'
  }
};
