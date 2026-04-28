/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║  CHOIRMASTER OMR  —  FILE 7 of 7                        ║
 * ║  MIDI Export · Camera Capture                           ║
 * ║                                                          ║
 * ║  PURPOSE:                                               ║
 * ║    MIDI — Exports the recognised score as a standard    ║
 * ║    Type-1 MIDI file (.mid). Supports full score or      ║
 * ║    individual SATB voices. Compatible with any DAW,     ║
 * ║    notation app, or MIDI player.                        ║
 * ║                                                          ║
 * ║    Camera — Provides live camera capture (rear lens)    ║
 * ║    via getUserMedia. The captured frame is passed       ║
 * ║    directly to the OMR pipeline as an image.            ║
 * ║                                                          ║
 * ║  DEPENDS ON: 02_globals_and_nav.js, 04_omr_pipeline.js  ║
 * ║  This is the FINAL module. No further pastes needed.    ║
 * ╚══════════════════════════════════════════════════════════╝
 */

// ══════════════════════════════════════════════════════
//  MIDI EXPORT
//  Builds a binary Type-1 MIDI file in memory and
//  triggers a browser download.
//
//  pname: 'all' | 'soprano' | 'alto' | 'tenor' | 'bass'
// ══════════════════════════════════════════════════════

function exportMidi(pname) {
  if (!currentScore) { toast('⚠️ No score loaded — scan a score first'); return; }

  const allVoices = ['soprano','alto','tenor','bass'];
  const parts     = (pname === 'all') ? allVoices : [pname];

  const tsn  = parseInt(currentScore.time) || 4;  // beats per measure
  const tpb  = 480;                                // MIDI ticks per beat
  const uspb = Math.round(60_000_000 / S.tempo);  // microseconds per beat

  // ── Helper: write a 16-bit big-endian integer ──────
  const i16 = n => [(n >> 8) & 0xFF, n & 0xFF];

  // ── Helper: write a 32-bit big-endian integer ──────
  const i32 = n => [
    (n >> 24) & 0xFF, (n >> 16) & 0xFF,
    (n >>  8) & 0xFF,  n        & 0xFF
  ];

  // ── Helper: encode integer as MIDI variable-length quantity ──
  function vl(v) {
    const b = [v & 0x7F];
    v >>= 7;
    while (v > 0) { b.unshift((v & 0x7F) | 0x80); v >>= 7; }
    return b;
  }

  /**
   * Build MIDI track bytes for one voice.
   * Returns an array of raw bytes (no track header — added below).
   * ch: MIDI channel index (0–3)
   */
  function mkTrack(notes, ch) {
    const pairs = [];

    notes.forEach(n => {
      const midi = _n2midi(n.pitch, S.transpose);
      if (midi === null) return;

      // Convert measure/beat to absolute MIDI ticks
      const startTick = Math.round(((n.measure - 1) * tsn + (n.beat - 1)) * tpb);
      const endTick   = startTick + Math.round(n.duration * tpb * 0.88); // slight gap between notes

      pairs.push(
        { t: startTick, cmd: 0x90, n: midi, v: 85 },  // note on  (velocity 85 = mezzo-forte)
        { t: endTick,   cmd: 0x80, n: midi, v: 0  }   // note off
      );
    });

    // Sort by time; note-offs before note-ons at same tick
    pairs.sort((a, b) => a.t - b.t || (a.cmd === 0x80 ? -1 : 1));

    // Encode as delta-time events
    const bytes = [];
    let lastTick = 0;
    pairs.forEach(ev => {
      const delta = Math.max(0, ev.t - lastTick);
      lastTick = ev.t;
      bytes.push(...vl(delta), ev.cmd | ch, ev.n, ev.v);
    });

    // End-of-track meta event
    bytes.push(0x00, 0xFF, 0x2F, 0x00);
    return bytes;
  }

  // ── Tempo & time-sig track (Track 0) ───────────────
  const tempoTrack = [
    // Set Tempo meta event
    0x00, 0xFF, 0x51, 0x03,
    (uspb >> 16) & 0xFF, (uspb >> 8) & 0xFF, uspb & 0xFF,
    // Time Signature meta event (num, log2(den), MIDI clocks per click, 32nds per quarter)
    0x00, 0xFF, 0x58, 0x04, tsn, 0x02, 0x18, 0x08,
    // End of track
    0x00, 0xFF, 0x2F, 0x00
  ];

  // ── Build one track per selected voice ─────────────
  const tracks = [tempoTrack];
  parts.forEach((p, i) => {
    const ns = currentScore.parts[p];
    if (!ns || !ns.length) return;

    // Program Change to organ (General MIDI #20 = Church Organ; 0-indexed = 19)
    const prgChange = [0x00, 0xC0 | i, 19];
    tracks.push([...prgChange, ...mkTrack(ns, i)]);
  });

  // ── Assemble the complete MIDI binary ──────────────
  // Header chunk: MThd + length(6) + format(1) + numTracks + ticks/beat
  let bytes = [
    0x4D, 0x54, 0x68, 0x64,   // 'MThd'
    ...i32(6),                  // chunk length always 6
    ...i16(1),                  // format type 1 (multi-track)
    ...i16(tracks.length),      // number of tracks
    ...i16(tpb)                 // ticks per quarter note
  ];

  // Each track chunk: MTrk + length + data
  tracks.forEach(t => {
    bytes.push(
      0x4D, 0x54, 0x72, 0x6B, // 'MTrk'
      ...i32(t.length),         // track data length
      ...t
    );
  });

  // ── Trigger browser download ───────────────────────
  const blob     = new Blob([new Uint8Array(bytes)], { type: 'audio/midi' });
  const url      = URL.createObjectURL(blob);
  const anchor   = document.createElement('a');
  const safeName = (currentScore.title || 'score').replace(/\s+/g, '_');
  anchor.href     = url;
  anchor.download = `${safeName}_${pname}.mid`;
  anchor.click();
  URL.revokeObjectURL(url);

  toast(`🎹 MIDI saved: ${pname}`);
}


// ══════════════════════════════════════════════════════
//  PITCH → MIDI NOTE NUMBER
//  'G#4' + transpose → integer 0–127
// ══════════════════════════════════════════════════════

function _n2midi(name, tr) {
  if (!name || name === 'R') return null;

  const noteTable = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const m = name.match(/^([A-G])(#|b)?(\d)$/);
  if (!m) return null;

  let idx = noteTable.indexOf(m[1] + (m[2] || ''));
  if (idx < 0) {
    idx = (noteTable.indexOf(m[1]) - 1 + 12) % 12; // enharmonic flat
  }
  if (idx < 0) return null;

  const midi = (parseInt(m[3]) + 1) * 12 + idx + (tr || 0);
  if (midi < 0 || midi > 127) return null; // out of MIDI range
  return midi;
}


// ══════════════════════════════════════════════════════
//  CAMERA
//  Opens the device's rear camera in a full-screen modal.
//  Capture snaps the current frame and routes it to the
//  OMR pipeline exactly like an uploaded image.
// ══════════════════════════════════════════════════════

let _camStream = null; // holds the active MediaStream

async function openCam() {
  document.getElementById('camModal').classList.add('open');
  try {
    _camStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment',   // rear camera
        width:  { ideal: 1920 },
        height: { ideal: 1440 }
      }
    });
    document.getElementById('camVideo').srcObject = _camStream;
  } catch(err) {
    toast('⚠️ Camera error: ' + err.message);
    document.getElementById('camModal').classList.remove('open');
  }
}

function capturePhoto() {
  const video  = document.getElementById('camVideo');
  const canvas = document.getElementById('camCanvas');
  canvas.width  = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);

  // Convert to a high-quality JPEG and wrap in an Image element
  const img = new Image();
  img.onload = () => processImage(img, 'camera_scan.jpg');
  img.src = canvas.toDataURL('image/jpeg', 0.95);

  closeCam();
}

function closeCam() {
  if (_camStream) {
    _camStream.getTracks().forEach(t => t.stop());
    _camStream = null;
  }
  document.getElementById('camModal').classList.remove('open');
}
