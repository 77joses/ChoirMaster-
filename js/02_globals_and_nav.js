
/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║  CHOIRMASTER OMR  —  FILE 2 of 7                        ║
 * ║  Globals · State · Navigation · Logging · OpenCV Init   ║
 * ║                                                          ║
 * ║  PURPOSE: Must be pasted FIRST inside <script>.         ║
 * ║  Sets up all shared state and UI utilities that every   ║
 * ║  other module depends on.                               ║
 * ║                                                          ║
 * ║  DEPENDS ON: 01_shell_and_ui.html (DOM must exist)      ║
 * ║  NEXT PASTE: 03_file_handler.js                         ║
 * ╚══════════════════════════════════════════════════════════╝
 */

'use strict';

// ══════════════════════════════════════════════════════
//  GLOBAL STATE
//  Single source of truth for the entire application.
//  All modules read/write these variables.
// ══════════════════════════════════════════════════════

let cvReady  = false;       // true once OpenCV.js has loaded
let currentScore = null;    // the active recognised score object
let staffMode = 4;          // 4 = four separate staves, 2 = grand-staff pairs
let fullW = 0, fullH = 0;   // full-resolution image dimensions (for OMR)

/**
 * S — master runtime state
 *   parts    : which SATB voices are active (for playback)
 *   playing  : is audio currently running?
 *   looping  : is loop mode on?
 *   tempo    : beats per minute (from slider)
 *   transpose: semitone shift applied at playback (−12 … +12)
 *   volume   : master gain 0.0–1.0
 *   organ    : selected timbre key ('pipe'|'reed'|'flute'|'strings')
 *   audioOK  : has the Web Audio context been unlocked?
 *   songs    : array of saved score objects (persisted in localStorage)
 *   startTime: AudioContext timestamp when playback started
 *   offsetSecs: playback cursor position in seconds
 *   totalSecs : total duration of current score
 */
const S = {
  parts: { soprano: true, alto: true, tenor: true, bass: true },
  playing: false, looping: false,
  tempo: 80, transpose: 0, volume: 0.8,
  organ: 'pipe', audioOK: false,
  songs: [], startTime: 0, offsetSecs: 0, totalSecs: 0
};

// Restore saved library from localStorage on startup
try { S.songs = JSON.parse(localStorage.getItem('omr_choirmaster') || '[]'); } catch(e) {}


// ══════════════════════════════════════════════════════
//  OPENCV CALLBACKS
//  Called by the async <script> tag that loads opencv.js.
//  All other OMR functions are gated on cvReady === true.
// ══════════════════════════════════════════════════════

function onOpenCvReady() {
  cvReady = true;
  document.getElementById('cvStatus').classList.remove('show');
  toast('✅ Vision engine ready — upload a score!');
}

function onOpenCvError() {
  document.getElementById('cvStatus').textContent =
    '⚠️ OpenCV failed to load — check your internet connection';
}

// Show the loading indicator immediately
document.getElementById('cvStatus').classList.add('show');


// ══════════════════════════════════════════════════════
//  STAFF MODE SELECTOR
//  Called by the two mode buttons in the Scan panel.
// ══════════════════════════════════════════════════════

function setMode(n) {
  staffMode = n;
  document.getElementById('mode-4').classList.toggle('active', n === 4);
  document.getElementById('mode-2').classList.toggle('active', n === 2);
  toast(n === 4
    ? '4-staff mode: S · A · T · B separate'
    : '2-staff mode: Grand staff pairs');
}


// ══════════════════════════════════════════════════════
//  NAVIGATION
//  Switches between Scan / Play / MIDI panels.
//  go(name) — 'scan' | 'play' | 'midi'
// ══════════════════════════════════════════════════════

function go(n) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('panel-' + n).classList.add('active');
  document.getElementById('tab-' + n).classList.add('active');
  window.scrollTo(0, 0);
}


// ══════════════════════════════════════════════════════
//  TOAST NOTIFICATIONS
//  Shows a brief floating message at the bottom.
//  toast(message, durationMs?)
// ══════════════════════════════════════════════════════

let _toastTimer;
function toast(m, d = 2800) {
  const el = document.getElementById('toast');
  el.textContent = m;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), d);
}


// ══════════════════════════════════════════════════════
//  PIPELINE LOGGING
//  Writes colour-coded lines to the log panel below the canvas.
//  log(msg, type)  — type: 'ok'|'warn'|'err'|'info'
//  clearLog()      — wipes the panel
//  setStage(id, state) — updates a pipeline badge
//  resetStages()   — resets all badges to default
// ══════════════════════════════════════════════════════

const logEl = document.getElementById('pipelineLog');

function log(msg, type = 'info') {
  logEl.style.display = 'block';
  const d = document.createElement('div');
  d.className = 'log-' + type;
  d.textContent = (
    type === 'ok'   ? '✓ ' :
    type === 'warn' ? '⚠ ' :
    type === 'err'  ? '✗ ' : '  '
  ) + msg;
  logEl.appendChild(d);
  logEl.scrollTop = logEl.scrollHeight;
}

function clearLog() {
  logEl.innerHTML = '';
  logEl.style.display = 'none';
}

function setStage(id, state) {
  const el = document.getElementById('st-' + id);
  if (el) el.className = 'stage ' + state;
}

function resetStages() {
  ['load','thresh','staff','clef','key','time','notes','pitch','rhythm','voices']
    .forEach(s => setStage(s, ''));
}


// ══════════════════════════════════════════════════════
//  UTILITY
// ══════════════════════════════════════════════════════

/** Promise-based sleep — yields to the browser event loop so the UI updates. */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
