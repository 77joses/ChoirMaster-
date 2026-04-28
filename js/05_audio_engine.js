/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║  CHOIRMASTER OMR  —  FILE 5 of 7                        ║
 * ║  Audio Engine — Church Organ Synthesis & Playback       ║
 * ║                                                          ║
 * ║  PURPOSE: Converts the score object into sound using    ║
 * ║  the Web Audio API. Each voice (S/A/T/B) is rendered   ║
 * ║  as additive-synthesis organ tones with four timbres:   ║
 * ║    • Pipe Organ  — 4 harmonics                         ║
 * ║    • Reed Organ  — 3 harmonics (rich midrange)         ║
 * ║    • Flute Pipes — 2 harmonics (airy)                  ║
 * ║    • Strings     — 3 harmonics (bowed)                 ║
 * ║                                                          ║
 * ║  FEATURES:                                              ║
 * ║    • Per-voice stereo pan  (A left, T right)           ║
 * ║    • Per-voice volume balance                          ║
 * ║    • Tempo / transpose / master volume sliders         ║
 * ║    • Individual voice mute/solo                        ║
 * ║    • Seekable progress bar                             ║
 * ║    • Loop mode                                         ║
 * ║                                                          ║
 * ║  DEPENDS ON: 02_globals_and_nav.js, 04_omr_pipeline.js  ║
 * ║  NEXT PASTE: 06_score_library.js                        ║
 * ╚══════════════════════════════════════════════════════════╝
 */

// ══════════════════════════════════════════════════════
//  WEB AUDIO CONTEXT
// ══════════════════════════════════════════════════════

let actx = null; // the single shared AudioContext

function getCtx() {
  if (!actx || actx.state === 'closed') {
    actx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return actx;
}

/**
 * Chrome on Android requires a user gesture before any audio plays.
 * Calling this from the banner tap pre-creates and resumes the context.
 */
function unlockAudio() {
  const c = getCtx();
  // Play a silent buffer to satisfy the gesture requirement
  const buf = c.createBuffer(1, 1, 22050);
  const src = c.createBufferSource();
  src.buffer = buf;
  src.connect(c.destination);
  src.start(0);
  c.resume().then(() => {
    S.audioOK = true;
    document.getElementById('audioUnlockBanner').classList.add('hidden');
    toast('🔊 Audio ready!');
  });
}


// ══════════════════════════════════════════════════════
//  ORGAN TIMBRE DEFINITIONS
//  Each timbre is an array of { m: multiplier, a: amplitude }
//  Harmonics are summed together per note via additive synthesis.
//  m=1 is the fundamental, m=2 is the octave, m=3 is the 5th, etc.
// ══════════════════════════════════════════════════════

const VDEF = {
  pipe:    [ {m:1,a:1.0}, {m:2,a:0.50}, {m:3,a:0.25}, {m:4,a:0.12} ],  // Pipe: 4 harmonics, bright
  reed:    [ {m:1,a:1.0}, {m:2,a:0.80}, {m:3,a:0.50} ],                  // Reed: rich, nasal
  flute:   [ {m:1,a:1.0}, {m:2,a:0.12} ],                                 // Flute: nearly pure, airy
  strings: [ {m:1,a:1.0}, {m:2,a:0.60}, {m:3,a:0.30} ]                   // Strings: warm bowed tone
};

// Per-voice relative volume (soprano is loudest as the melody carrier)
const PVOL = { soprano: 1.0, alto: 0.75, tenor: 0.70, bass: 0.85 };

// Per-voice stereo pan — Alto left, Tenor right, S/B centre
const PPAN = { soprano: 0, alto: -0.35, tenor: 0.35, bass: 0 };


// ══════════════════════════════════════════════════════
//  PITCH → FREQUENCY CONVERSION
//  n2f('G#4', transpose) → Hz
//  Supports sharps (#) and flats (b).
// ══════════════════════════════════════════════════════

function n2f(name, tr) {
  if (!name || name === 'R') return 0;
  const noteTable = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const m = name.match(/^([A-G])(#|b)?(\d)$/);
  if (!m) return 0;

  let idx = noteTable.indexOf(m[1] + (m[2] || ''));
  if (idx < 0) {
    // Handle flats by converting to enharmonic sharp
    idx = (noteTable.indexOf(m[1]) - 1 + 12) % 12;
  }
  // MIDI formula: A4 = 69 = 440 Hz
  return 440 * Math.pow(2, ((parseInt(m[3]) + 1) * 12 + idx + (tr || 0) - 69) / 12);
}


// ══════════════════════════════════════════════════════
//  NOTE SCHEDULER
//  Schedules a single note on the AudioContext timeline
//  using additive synthesis + attack/release envelope.
//
//  c    : AudioContext
//  freq : frequency in Hz
//  t0   : start time (AudioContext clock seconds)
//  dur  : duration in seconds
//  vol  : gain (0.0 – 1.0)
//  voice: timbre key ('pipe'|'reed'|'flute'|'strings')
//  pan  : stereo position (-1.0 left … +1.0 right)
// ══════════════════════════════════════════════════════

function schedNote(c, freq, t0, dur, vol, voice, pan) {
  if (freq <= 0 || dur <= 0) return;

  const harmonics = VDEF[voice] || VDEF.pipe;

  // Master gain with ADSR envelope (simplified: attack + release)
  const mg  = c.createGain();
  const att = 0.015;
  const rel = Math.min(0.07, dur * 0.12);
  mg.gain.setValueAtTime(0, t0);
  mg.gain.linearRampToValueAtTime(vol, t0 + att);
  mg.gain.setValueAtTime(vol, t0 + dur - rel);
  mg.gain.linearRampToValueAtTime(0.0001, t0 + dur);

  // Stereo panning
  if (c.createStereoPanner && pan !== 0) {
    const pn = c.createStereoPanner();
    pn.pan.value = pan;
    mg.connect(pn);
    pn.connect(c.destination);
  } else {
    mg.connect(c.destination);
  }

  // One oscillator per harmonic, all routed through the master gain
  harmonics.forEach(h => {
    const osc = c.createOscillator();
    const hg  = c.createGain();
    osc.type            = 'sine';
    osc.frequency.value = freq * h.m;
    hg.gain.value       = h.a;
    osc.connect(hg);
    hg.connect(mg);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  });
}


// ══════════════════════════════════════════════════════
//  EVENT QUEUE BUILDER
//  Converts all notes in the score to absolute-time
//  playback events, respecting active parts and tempo.
//  fromSecs: only include events at or after this offset
// ══════════════════════════════════════════════════════

function buildEvents(fromSecs) {
  if (!currentScore) return [];

  const spb  = 60 / S.tempo;         // seconds per beat
  const mv   = 0.28;                  // master volume scalar
  const tsn  = parseInt(currentScore.time) || 4; // beats per measure
  const evts = [];

  Object.entries(currentScore.parts).forEach(([part, notes]) => {
    if (!S.parts[part]) return;       // voice is muted — skip

    notes.forEach(n => {
      if (!n.measure || !n.beat) return;
      const t = ((n.measure - 1) * tsn + (n.beat - 1)) * spb;
      if (t < fromSecs - 0.05) return; // behind the playhead

      evts.push({
        t,
        freq: n2f(n.pitch, S.transpose),
        dur:  Math.max(0.05, n.duration * spb * 0.87), // small gap between notes
        vol:  mv * (PVOL[part] || 1) * S.volume,
        pan:  PPAN[part] || 0
      });
    });
  });

  return evts.sort((a, b) => a.t - b.t);
}


// ══════════════════════════════════════════════════════
//  PLAYBACK ENGINE
// ══════════════════════════════════════════════════════

let _pTimer = null;  // setInterval handle for the pump
let _eventQ = [];    // sorted queue of upcoming note events

/**
 * Play / Pause toggle.
 * If audio is not yet unlocked, unlocks it first.
 */
function togglePlay() {
  if (!S.audioOK) {
    unlockAudio();
    setTimeout(() => { if (S.audioOK) startPlay(); }, 400);
    return;
  }
  if (S.playing) stopPlay();
  else           startPlay();
}

/**
 * Begin playback from a given time offset.
 * fromOff: seconds into the score (0 = start)
 */
function startPlay(fromOff) {
  if (!currentScore) { toast('📄 Scan a score first'); return; }

  actx = new (window.AudioContext || window.webkitAudioContext)();
  actx.resume();

  S.playing     = true;
  S.offsetSecs  = fromOff || 0;
  S.startTime   = actx.currentTime - S.offsetSecs;

  document.getElementById('playBtn').textContent = '⏸';

  _eventQ = buildEvents(S.offsetSecs);
  clearInterval(_pTimer);
  _pTimer = setInterval(_pump, 250);
  _pump();
}

/**
 * The playback heartbeat — called every 250 ms.
 * Schedules notes up to 1.5 s ahead of the current time,
 * updates the progress bar and time display.
 */
function _pump() {
  if (!actx || !S.playing) return;

  const now   = actx.currentTime;
  const el    = now - S.startTime;   // elapsed seconds
  const ahead = now + 1.5;           // schedule this far ahead

  // Fire all events that fall within the lookahead window
  while (_eventQ.length && (S.startTime + _eventQ[0].t) <= ahead) {
    const ev = _eventQ.shift();
    const at = S.startTime + ev.t;
    if (at >= now - 0.02) {
      schedNote(actx, ev.freq, at, ev.dur, ev.vol, S.organ, ev.pan);
    }
  }

  // Update progress bar
  const pct = Math.min(100, (el / S.totalSecs) * 100);
  document.getElementById('progFill').style.width = pct + '%';
  document.getElementById('tCur').textContent = _fmt(el);

  // Animate VU meters — driven by whether each voice is active
  // (Phase 2: replace random values with real amplitude analysis)
  const parts = ['soprano','alto','tenor','bass'];
  ['mS','mA','mT','mB'].forEach((id, i) => {
    const h = S.parts[parts[i]] ? (Math.random() * 70 + 20) : 0;
    document.getElementById(id).style.height = h + '%';
  });

  // End of score
  if (el >= S.totalSecs && _eventQ.length === 0) {
    if (S.looping) {
      stopPlay(false);
      setTimeout(() => startPlay(0), 150);
    } else {
      stopPlay();
    }
  }
}

/**
 * Stop playback.
 * reset=true resets the UI to the start position.
 */
function stopPlay(reset = true) {
  S.playing = false;
  clearInterval(_pTimer);
  _eventQ = [];

  if (actx && actx.state !== 'closed') {
    actx.close().catch(() => {});
    actx = null;
  }

  if (reset) {
    document.getElementById('playBtn').textContent = '▶';
    document.getElementById('progFill').style.width = '0%';
    document.getElementById('tCur').textContent = '0:00';
    ['mS','mA','mT','mB'].forEach(id =>
      document.getElementById(id).style.height = '0%'
    );
    S.offsetSecs = 0;
  }
}

/** Click on the progress bar to seek to a position. */
function seekClick(e) {
  if (!currentScore) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  const off  = pct * S.totalSecs;
  const was  = S.playing;

  stopPlay(false);
  S.offsetSecs = off;
  document.getElementById('progFill').style.width = (pct * 100) + '%';
  document.getElementById('tCur').textContent = _fmt(off);

  if (was) {
    S.audioOK = true;
    setTimeout(() => startPlay(off), 100);
  }
}

/** Toggle loop mode. */
function toggleLoop() {
  S.looping = !S.looping;
  document.getElementById('loopBtn').classList.toggle('on', S.looping);
  toast(S.looping ? '🔁 Loop ON' : '↻ Loop OFF');
}

/** Format seconds as M:SS */
function _fmt(s) {
  s = Math.max(0, s || 0);
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}


// ══════════════════════════════════════════════════════
//  PLAYBACK CONTROLS (Sliders & organ selector)
// ══════════════════════════════════════════════════════

function setTempo(v) {
  S.tempo = parseInt(v);
  document.getElementById('tempoV').textContent = v + ' BPM';
  if (S.playing) { stopPlay(false); startPlay(0); }
}

function setTranspose(v) {
  S.transpose = parseInt(v);
  document.getElementById('transV').textContent = (v > 0 ? '+' : '') + v;
  if (S.playing) { stopPlay(false); startPlay(0); }
}

function setVolume(v) {
  S.volume = v / 100;
  document.getElementById('volV').textContent = v + '%';
  // Volume change takes effect on next note (no need to restart)
}

function setOrgan(type, btn) {
  S.organ = type;
  document.querySelectorAll('.organ-grid .btn-sm').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  toast('🎵 ' + type.charAt(0).toUpperCase() + type.slice(1));
  if (S.playing) { stopPlay(false); startPlay(S.offsetSecs); }
}


// ══════════════════════════════════════════════════════
//  VOICE MUTE CONTROLS
// ══════════════════════════════════════════════════════

const KM = { S: 'soprano', A: 'alto', T: 'tenor', B: 'bass' };

/** Toggle a single voice on or off. */
function togglePart(k) {
  const p = KM[k];
  S.parts[p] = !S.parts[p];
  document.getElementById('tog-' + k).classList.toggle('on', S.parts[p]);
  document.getElementById('pc-' + k).classList.toggle('on', S.parts[p]);
  toast(S.parts[p] ? `${p} ON` : `${p} muted`);
  if (S.playing) {
    const off = actx ? (actx.currentTime - S.startTime) : 0;
    stopPlay(false);
    startPlay(Math.max(0, off));
  }
}

/** Turn all four voices on. */
function allOn() {
  ['S','A','T','B'].forEach(k => {
    S.parts[KM[k]] = true;
    document.getElementById('tog-' + k).classList.add('on');
    document.getElementById('pc-' + k).classList.add('on');
  });
  if (S.playing) { stopPlay(false); startPlay(0); }
}

/** Mute all four voices (stops playback). */
function allMute() {
  ['S','A','T','B'].forEach(k => {
    S.parts[KM[k]] = false;
    document.getElementById('tog-' + k).classList.remove('on');
    document.getElementById('pc-' + k).classList.remove('on');
  });
  stopPlay();
}
