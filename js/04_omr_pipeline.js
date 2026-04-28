/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║  CHOIRMASTER OMR  —  FILE 4 of 7                        ║
 * ║  OMR Pipeline — Full Score Recognition Engine           ║
 * ║                                                          ║
 * ║  PURPOSE: The complete Optical Music Recognition chain. ║
 * ║  Takes an HTMLImageElement and produces a structured    ║
 * ║  score object with SATB parts ready for playback.       ║
 * ║                                                          ║
 * ║  PIPELINE STAGES (in order):                            ║
 * ║    1. Load image → display & processing canvases        ║
 * ║    2. Threshold (binarise with OpenCV)                  ║
 * ║    3. Detect staff lines                                ║
 * ║    4. Assign clef types                                 ║
 * ║    5. Detect key signature                              ║
 * ║    6. Detect time signature (stub — returns 4/4)        ║
 * ║    7. Detect noteheads                                  ║
 * ║    8. Assign pitch to each notehead                     ║
 * ║    9. Assign rhythm (duration) to each note             ║
 * ║   10. Separate into SATB voices                         ║
 * ║   11. Show results & hand off to audio                  ║
 * ║                                                          ║
 * ║  DEPENDS ON: 02_globals_and_nav.js, 03_file_handler.js  ║
 * ║  CALLS:      showResults() → loadScore() in later files ║
 * ║  NEXT PASTE: 05_audio_engine.js                         ║
 * ╚══════════════════════════════════════════════════════════╝
 */

// ══════════════════════════════════════════════════════
//  MAIN PIPELINE ORCHESTRATOR
//  Called by file_handler after every image load.
//  imgEl   : HTMLImageElement (full-resolution source)
//  filename: original filename string for titling
// ══════════════════════════════════════════════════════

async function processImage(imgEl, filename) {
  setStage('load', 'active');

  // ── DISPLAY canvas (scaled to fit the screen) ──────
  const dispCanvas = document.getElementById('mainCanvas');
  const overlay    = document.getElementById('overlayCanvas');
  document.getElementById('canvasWrap').style.display = 'block';

  const dispScale   = Math.min(1, 500 / imgEl.width);
  dispCanvas.width  = Math.round(imgEl.width  * dispScale);
  dispCanvas.height = Math.round(imgEl.height * dispScale);
  overlay.width     = dispCanvas.width;
  overlay.height    = dispCanvas.height;
  dispCanvas.getContext('2d').drawImage(imgEl, 0, 0, dispCanvas.width, dispCanvas.height);

  // ── PROCESSING canvas (FULL resolution) ───────────
  // OpenCV always works on the original pixel dimensions.
  // A downscaled image loses the fine detail needed for notehead detection.
  const procCanvas  = document.createElement('canvas');
  procCanvas.width  = imgEl.width;
  procCanvas.height = imgEl.height;
  procCanvas.getContext('2d').drawImage(imgEl, 0, 0);
  fullW = imgEl.width;
  fullH = imgEl.height;

  log(`Image: ${imgEl.width}×${imgEl.height}px  display: ${dispScale.toFixed(2)}× — processing at FULL resolution`, 'info');
  setStage('load', 'done');
  await sleep(30);

  try {
    // Read the full-res canvas into an OpenCV Mat
    const src  = cv.imread(procCanvas);
    const gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    // ─── STAGE 2: THRESHOLD ──────────────────────────
    setStage('thresh', 'active');
    await sleep(20);
    const binary = new cv.Mat();
    // Adaptive threshold copes with uneven lighting from phone cameras
    cv.adaptiveThreshold(gray, binary, 255,
      cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 25, 10);
    setStage('thresh', 'done');
    log('Threshold applied (adaptive Gaussian, block=25, C=10)', 'ok');

    // ─── STAGE 3: STAFF LINES ────────────────────────
    setStage('staff', 'active');
    await sleep(20);
    const staves = detectStaves(binary, fullW, fullH);
    if (!staves.length) {
      setStage('staff', 'err');
      log('No staff lines found — try a clearer, well-lit photo', 'err');
      toast('⚠️ No staff lines found — try better lighting');
      src.delete(); gray.delete(); binary.delete();
      return;
    }
    setStage('staff', 'done');
    log(`Found ${staves.length} staff(s)  spacing: ${staves[0].spacing.toFixed(1)}px`, 'ok');
    drawStavesOverlay(overlay, staves, dispScale);

    // ─── STAGE 4: CLEF ASSIGNMENT ────────────────────
    setStage('clef', 'active');
    await sleep(10);
    const clefs = assignClefs(staves);
    setStage('clef', 'done');
    log(`Clefs: ${clefs.map(c => c.type).join(', ')}`, 'ok');

    // ─── STAGE 5: KEY SIGNATURE ──────────────────────
    setStage('key', 'active');
    await sleep(10);
    const keySig = detectKeySig(binary, staves, clefs);
    setStage('key', 'done');
    log(`Key: ${keySig.name}  (${keySig.accidentals} accidentals)`, 'ok');

    // ─── STAGE 6: TIME SIGNATURE ─────────────────────
    setStage('time', 'active');
    await sleep(10);
    const timeSig = detectTimeSig(binary, staves);
    setStage('time', 'done');
    log(`Time: ${timeSig.str}`, 'ok');

    // ─── STAGE 7: NOTEHEAD DETECTION ─────────────────
    setStage('notes', 'active');
    await sleep(30);
    const rawNotes = detectNoteheads(binary, staves);
    setStage('notes', 'done');
    log(`Noteheads found: ${rawNotes.length}`, 'ok');
    if (rawNotes.length > 0) drawNoteheadsOverlay(overlay, rawNotes, dispScale);

    // ─── STAGE 8: PITCH ──────────────────────────────
    setStage('pitch', 'active');
    await sleep(10);
    const notesWithPitch = assignPitch(rawNotes, staves, clefs, keySig);
    setStage('pitch', 'done');
    log(`Pitches assigned: ${notesWithPitch.filter(n => n.pitch !== 'R').length}`, 'ok');

    // ─── STAGE 9: RHYTHM ─────────────────────────────
    setStage('rhythm', 'active');
    await sleep(10);
    const notesWithRhythm = assignRhythm(notesWithPitch, binary, staves, timeSig);
    setStage('rhythm', 'done');
    log('Rhythm values assigned', 'ok');

    // ─── STAGE 10: VOICE SEPARATION ──────────────────
    setStage('voices', 'active');
    await sleep(10);
    const score = separateVoices(notesWithRhythm, staves, clefs, timeSig, keySig, filename);
    setStage('voices', 'done');
    const total = Object.values(score.parts).reduce((a, p) => a + p.length, 0);
    log(`Voice separation done  Total: ${total} notes`, 'ok');

    // Clean up OpenCV memory
    src.delete(); gray.delete(); binary.delete();

    // Hand off to the results / audio layer
    showResults(score, filename);

  } catch (err) {
    log('Pipeline error: ' + err.message, 'err');
    console.error(err);
    toast('⚠️ Recognition error — see pipeline log');
  }
}


// ══════════════════════════════════════════════════════
//  STAGE 3 — STAFF LINE DETECTION
//  Uses a horizontal projection: counts dark pixels per
//  row. Rows where >25% of the width is dark are candidate
//  staff lines. Groups of 5 evenly-spaced lines form a staff.
// ══════════════════════════════════════════════════════

function detectStaves(binary, W, H) {
  const data = binary.data;

  // Build horizontal projection histogram
  const proj = new Int32Array(H);
  for (let y = 0; y < H; y++) {
    let cnt = 0;
    for (let x = 0; x < W; x++) { if (data[y * W + x] > 128) cnt++; }
    proj[y] = cnt;
  }

  // Staff lines: rows where more than 25% of width is dark
  const threshold = W * 0.25;
  const peaks = [];
  for (let y = 2; y < H - 2; y++) {
    if (proj[y] > threshold && proj[y] >= proj[y - 1] && proj[y] >= proj[y + 1]) {
      peaks.push(y);
    }
  }

  // Merge peaks within 3px (thick lines produce multiple adjacent peaks)
  const merged = [];
  let last = -99;
  for (const r of peaks) {
    if (r - last > 3) {
      merged.push(r); last = r;
    } else {
      merged[merged.length - 1] = Math.round((merged[merged.length - 1] + r) / 2);
    }
  }

  log(`Projection peaks: ${merged.length}  threshold: ${threshold.toFixed(0)}px`, 'info');

  // Group into staves: exactly 5 lines with consistent spacing
  const staves = [];
  for (let i = 0; i <= merged.length - 5; i++) {
    const g  = merged.slice(i, i + 5);
    const sp = [];
    for (let j = 1; j < 5; j++) sp.push(g[j] - g[j - 1]);
    const avg    = sp.reduce((a, b) => a + b, 0) / 4;
    const maxDev = Math.max(...sp.map(s => Math.abs(s - avg)));

    // Accept if spacings vary by less than 30% and are a plausible staff size
    if (maxDev / avg < 0.3 && avg >= 4 && avg <= 80) {
      staves.push({
        lines:   g,
        top:     g[0] - avg * 0.6,
        bottom:  g[4] + avg * 0.6,
        spacing: avg,
        midY:    (g[0] + g[4]) / 2
      });
      i += 4; // skip consumed lines
    }
  }

  return staves;
}


// ══════════════════════════════════════════════════════
//  STAGE 4 — CLEF ASSIGNMENT
//  Assigns clef types by staff position rather than
//  visual detection (visual detection is Phase 2).
//  4-staff: S=treble, A=treble, T=bass, B=bass (per group of 4)
//  2-staff: even=treble (SA), odd=bass (TB)
// ══════════════════════════════════════════════════════

function assignClefs(staves) {
  return staves.map((s, i) => {
    let type = 'treble';
    if (staffMode === 4) {
      const pos = i % 4;
      type = (pos >= 2) ? 'bass' : 'treble'; // positions 2 & 3 = Tenor & Bass
    } else {
      type = (i % 2 === 0) ? 'treble' : 'bass';
    }
    return { staffIdx: i, type };
  });
}


// ══════════════════════════════════════════════════════
//  STAGE 5 — KEY SIGNATURE DETECTION
//  Examines the region after the clef on the first staff.
//  Counts and classifies accidental blobs (sharps vs flats).
// ══════════════════════════════════════════════════════

function detectKeySig(binary, staves, clefs) {
  const W = binary.cols, H = binary.rows;
  if (!staves.length) return { accidentals: 0, name: 'C major', sharps: 0, flats: 0, debug: {} };

  const staff = staves[0];
  const sp    = staff.spacing;

  // Key signature region: after clef (≈3.5×sp) for about 4.5×sp width
  const x0 = Math.max(0,   Math.round(sp * 3.5));
  const x1 = Math.min(W-1, Math.round(sp * 8.0));
  const y0 = Math.max(0,   Math.floor(staff.top));
  const y1 = Math.min(H-1, Math.floor(staff.bottom));

  if (x1 <= x0 || y1 <= y0) return { accidentals: 0, name: 'C major', sharps: 0, flats: 0, debug: {} };

  const roi       = new cv.Rect(x0, y0, x1 - x0, y1 - y0);
  const roiMat    = binary.roi(roi);
  const contours  = new cv.MatVector();
  const hierarchy = new cv.Mat();
  let blobCount = 0, tallBlobCount = 0, hasFlat = false;

  try {
    const tmp = roiMat.clone();
    cv.findContours(tmp, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    for (let i = 0; i < contours.size(); i++) {
      const cnt  = contours.get(i);
      const area = cv.contourArea(cnt);
      const r    = cv.boundingRect(cnt);
      cnt.delete();

      if (area < sp * sp * 0.1) continue;  // too small
      if (r.width > sp * 1.5)   continue;  // too wide (barline/clef body)
      if (r.height < sp * 0.7)  continue;  // too short

      blobCount++;
      if (r.height > r.width * 1.3) tallBlobCount++;
      if (r.height > sp * 2 && r.width > sp * 0.5) hasFlat = true;
    }
    tmp.delete();
  } finally {
    contours.delete(); hierarchy.delete(); roiMat.delete();
  }

  let accidentals = 0;
  if (hasFlat) {
    accidentals = -Math.min(blobCount, 7);
  } else if (tallBlobCount > 0) {
    accidentals = Math.min(Math.ceil(tallBlobCount / 1.5), 7);
  } else if (blobCount > 0) {
    accidentals = Math.min(blobCount, 4);
  }

  const keyNames = {
     0:'C major',  1:'G major',  2:'D major',  3:'A major',
     4:'E major',  5:'B major',  6:'F# major', 7:'C# major',
    '-1':'F major','-2':'Bb major','-3':'Eb major','-4':'Ab major',
    '-5':'Db major','-6':'Gb major','-7':'Cb major'
  };

  return {
    accidentals,
    name:   keyNames[accidentals] || 'C major',
    sharps: accidentals > 0 ?  accidentals : 0,
    flats:  accidentals < 0 ? -accidentals : 0,
    debug:  { blobCount, tallBlobCount, hasFlat }
  };
}


// ══════════════════════════════════════════════════════
//  STAGE 6 — TIME SIGNATURE DETECTION
//  Digit recognition is a Phase 2 feature.
//  Currently always returns 4/4.
// ══════════════════════════════════════════════════════

function detectTimeSig(binary, staves) {
  return { num: 4, den: 4, str: '4/4' };
}


// ══════════════════════════════════════════════════════
//  STAGE 7 — NOTEHEAD DETECTION
//  Finds all contours in the binary image and filters
//  them to oval shapes of the right size near a staff.
// ══════════════════════════════════════════════════════

function detectNoteheads(binary, staves) {
  if (!staves.length) return [];

  const avgSp = staves.reduce((a, s) => a + s.spacing, 0) / staves.length;
  const W     = binary.cols;

  // Expected notehead dimensions relative to staff spacing
  const minW    = avgSp * 0.45,  maxW    = avgSp * 1.5;
  const minH    = avgSp * 0.40,  maxH    = avgSp * 1.05;
  const minArea = avgSp * avgSp * 0.20;
  const maxArea = avgSp * avgSp * 1.80;

  log(`Notehead target W:${minW.toFixed(1)}–${maxW.toFixed(1)}  H:${minH.toFixed(1)}–${maxH.toFixed(1)}`, 'info');

  const notes    = [];
  const contours = new cv.MatVector();
  const hierarchy= new cv.Mat();
  const rej      = { area: 0, width: 0, height: 0, aspect: 0, staffLine: 0, notNearStaff: 0 };

  try {
    const tmp   = binary.clone();
    cv.findContours(tmp, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    const total = contours.size();
    log(`Total contours: ${total}`, 'info');

    for (let i = 0; i < total; i++) {
      const cnt    = contours.get(i);
      const area   = cv.contourArea(cnt);
      const rect   = cv.boundingRect(cnt);
      cnt.delete();

      const w = rect.width, h = rect.height;
      const cx = rect.x + w / 2, cy = rect.y + h / 2;
      const aspect = w / Math.max(h, 1);

      if (area < minArea || area > maxArea)   { rej.area++;         continue; }
      if (w < minW || w > maxW)               { rej.width++;        continue; }
      if (h < minH || h > maxH)               { rej.height++;       continue; }
      if (aspect < 0.5 || aspect > 2.0)       { rej.aspect++;       continue; }
      if (w > W * 0.06)                        { rej.staffLine++;    continue; } // reject barlines

      // Must be within 1.5 staff-spacings of a known staff
      const nearStaff = staves.some(s =>
        cy >= s.top - s.spacing * 1.5 && cy <= s.bottom + s.spacing * 1.5);
      if (!nearStaff) { rej.notNearStaff++; continue; }

      const filled = _isFilledNotehead(binary, rect);
      const stem   = _detectStem(binary, rect, avgSp);

      notes.push({ x: cx, y: cy, w, h, area, filled,
                   hasStem: stem.has, stemUp: stem.up, raw_rect: rect });
    }

    log(`Passed: ${notes.length}  rejected — area:${rej.area} w:${rej.width} h:${rej.height} aspect:${rej.aspect} staffLine:${rej.staffLine} notNearStaff:${rej.notNearStaff}`, 'info');
    tmp.delete();
  } finally {
    contours.delete(); hierarchy.delete();
  }

  notes.sort((a, b) => a.x - b.x);
  return notes;
}

/** Sample the centre of a notehead contour to determine if filled (quarter/8th) or hollow (half/whole). */
function _isFilledNotehead(binary, rect) {
  const cx = rect.x + rect.width / 2, cy = rect.y + rect.height / 2;
  const r  = Math.min(rect.width, rect.height) * 0.28;
  let dark = 0, total = 0;
  const data = binary.data, W = binary.cols, H = binary.rows;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx*dx + dy*dy <= r*r) {
        const px = Math.round(cx + dx), py = Math.round(cy + dy);
        if (px >= 0 && px < W && py >= 0 && py < H) {
          total++;
          if (data[py * W + px] > 128) dark++;
        }
      }
    }
  }
  return total > 0 && (dark / total) > 0.45;
}

/** Look above and below the notehead for a vertical stem. Returns {has, up}. */
function _detectStem(binary, rect, sp) {
  const W = binary.cols, H = binary.rows, data = binary.data;
  const stemLen = Math.round(sp * 2.8);
  const cx = Math.round(rect.x + rect.width / 2);
  let above = 0, below = 0;
  for (let ox = -1; ox <= 1; ox++) {
    const x = Math.max(0, Math.min(W - 1, cx + ox));
    for (let dy = Math.round(rect.height / 2) + 1; dy <= stemLen; dy++) {
      const ya = Math.round(rect.y - dy);
      const yb = Math.round(rect.y + rect.height + dy);
      if (ya >= 0 && ya < H && data[ya * W + x] > 128) above++;
      if (yb >= 0 && yb < H && data[yb * W + x] > 128) below++;
    }
  }
  return { has: above > 4 || below > 4, up: above > below };
}


// ══════════════════════════════════════════════════════
//  STAGE 8 — PITCH ASSIGNMENT
//  Converts a note's Y position on the staff into a
//  note name + octave, then applies key-signature
//  accidentals.
// ══════════════════════════════════════════════════════

/**
 * Converts a staff position integer to a note name.
 * staffPos 0 = bottom line of the staff.
 * Each integer step = one diatonic step upward.
 */
function _positionToNote(staffPos, clefType) {
  const noteNames = ['C','D','E','F','G','A','B'];
  if (clefType === 'treble') {
    // Bottom line of treble clef = E4  (index 2, octave 4)
    const total = staffPos + 2;
    return noteNames[((total % 7) + 7) % 7] + (4 + Math.floor(total / 7));
  } else {
    // Bottom line of bass clef = G2  (index 4, octave 2)
    const total = staffPos + 4;
    return noteNames[((total % 7) + 7) % 7] + (2 + Math.floor(total / 7));
  }
}

function assignPitch(notes, staves, clefs, keySig) {
  const sharpOrder = ['F','C','G','D','A','E','B'];
  const flatOrder  = ['B','E','A','D','G','C','F'];

  return notes.map(note => {
    // Find the closest staff by midpoint distance
    let bestStaff = -1, bestDist = Infinity;
    staves.forEach((s, i) => {
      const d = Math.abs(note.y - s.midY);
      if (d < bestDist) { bestDist = d; bestStaff = i; }
    });
    if (bestStaff < 0) return { ...note, pitch: 'R', staffIdx: -1, staffPos: 0 };

    const staff  = staves[bestStaff];
    const clef   = clefs[bestStaff] || { type: 'treble' };
    const halfSp = staff.spacing / 2;

    // staff.lines[0] is the TOP line (smallest Y) in a top-to-bottom scan.
    // staff.lines[4] is the BOTTOM line (largest Y).
    // We use lines[4] as the reference (bottom line = staffPos 0).
    const bottomLine = staff.lines[4];
    const rawPos     = (bottomLine - note.y) / halfSp;  // positive = above bottom line
    const staffPos   = Math.round(rawPos);

    let pitch = _positionToNote(staffPos, clef.type);

    // Apply key signature accidentals
    const m = pitch.match(/^([A-G])(\d)$/);
    if (m) {
      const noteName = m[1];
      if (keySig.accidentals > 0 && sharpOrder.slice(0, keySig.accidentals).includes(noteName)) {
        pitch = noteName + '#' + m[2];
      } else if (keySig.accidentals < 0 && flatOrder.slice(0, -keySig.accidentals).includes(noteName)) {
        pitch = noteName + 'b' + m[2];
      }
    }

    return { ...note, pitch, staffIdx: bestStaff, staffPos, clefType: clef.type };
  });
}


// ══════════════════════════════════════════════════════
//  STAGE 9 — RHYTHM ASSIGNMENT
//  Deduces note duration from visual properties:
//    hollow + no stem → whole  (4 beats)
//    hollow + stem    → half   (2 beats)
//    filled + no flag → quarter(1 beat)
//    filled + flag    → eighth (0.5 beats)
// ══════════════════════════════════════════════════════

function assignRhythm(notes, binary, staves, timeSig) {
  return notes.map(note => {
    let duration = 1;
    if (!note.filled) {
      duration = note.hasStem ? 2 : 4;
    } else {
      duration = _detectFlag(binary, note, staves) ? 0.5 : 1;
    }
    return { ...note, duration };
  });
}

/** Look for an eighth-note flag: dark pixels to the right of the stem tip. */
function _detectFlag(binary, note, staves) {
  const avgSp = staves.reduce((a, s) => a + s.spacing, 0) / staves.length;
  const W = binary.cols, H = binary.rows, data = binary.data;
  const stemTipY = Math.round(note.stemUp ? note.y - avgSp * 2.8 : note.y + avgSp * 2.8);
  const x0 = Math.round(note.x),               x1 = Math.round(note.x + avgSp * 1.2);
  const y0 = Math.round(stemTipY - avgSp * 0.8),y1 = Math.round(stemTipY + avgSp * 0.8);
  let dark = 0, total = 0;
  for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) {
      total++;
      if (data[y * W + x] > 128) dark++;
    }
  }
  return total > 0 && (dark / total) > 0.15;
}


// ══════════════════════════════════════════════════════
//  STAGE 10 — VOICE SEPARATION
//  Routes each note to soprano / alto / tenor / bass
//  based on staff index and stem direction.
// ══════════════════════════════════════════════════════

function separateVoices(notes, staves, clefs, timeSig, keySig, filename) {
  const parts = { soprano: [], alto: [], tenor: [], bass: [] };

  notes.forEach(note => {
    const idx = note.staffIdx;
    if (idx < 0) return;
    let voice = 'soprano';

    if (staffMode === 4) {
      // Every group of 4 staves = one SATB set
      const voiceMap = ['soprano','alto','tenor','bass'];
      voice = voiceMap[idx % 4] || 'soprano';
    } else {
      // Grand-staff pairs: stem direction splits the two voices per staff
      if (idx % 2 === 0) {
        voice = note.stemUp ? 'soprano' : 'alto';   // treble staff
      } else {
        voice = note.stemUp ? 'tenor'   : 'bass';   // bass staff
      }
    }

    parts[voice].push({
      pitch:    note.pitch    || 'R',
      duration: note.duration || 1,
      x:        note.x,
      lyric:    ''
    });
  });

  // Assign measure numbers and beat positions to each voice
  Object.keys(parts).forEach(v => {
    parts[v] = _assignMeasuresBeats(parts[v], timeSig);
  });

  const title = filename.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ');
  const total = Object.values(parts).reduce((a, p) => a + p.length, 0);

  return {
    title, key: keySig.name, time: timeSig.str, tempo: 80, lyrics: '',
    parts,
    meta: { totalNotes: total, filename, scannedAt: new Date().toISOString() }
  };
}

function _assignMeasuresBeats(notes, timeSig) {
  if (!notes.length) return notes;
  let beat = 1, measure = 1;
  const bpm = timeSig.num;
  return notes.map(n => {
    const r = { ...n, beat, measure };
    beat += n.duration;
    while (beat > bpm + 0.01) { beat -= bpm; measure++; }
    return r;
  });
}


// ══════════════════════════════════════════════════════
//  OVERLAY DRAWING
//  Draws detection results on the transparent canvas
//  that sits on top of the displayed image.
// ══════════════════════════════════════════════════════

function drawStavesOverlay(overlay, staves, scale) {
  const ctx = overlay.getContext('2d');
  ctx.clearRect(0, 0, overlay.width, overlay.height);

  const labels = staffMode === 4
    ? ['Soprano','Alto','Tenor','Bass','Soprano','Alto','Tenor','Bass']
    : ['Soprano+Alto','Tenor+Bass','Soprano+Alto','Tenor+Bass'];

  staves.forEach((s, i) => {
    // Draw each of the 5 staff lines in teal
    s.lines.forEach(ly => {
      ctx.strokeStyle = 'rgba(62,207,176,0.45)';
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(0, ly * scale);
      ctx.lineTo(overlay.width, ly * scale);
      ctx.stroke();
    });
    // Label the staff
    ctx.fillStyle = 'rgba(201,168,76,0.85)';
    ctx.font = 'bold 10px monospace';
    ctx.fillText(labels[i % labels.length] || 'Staff ' + (i + 1), 4, s.lines[0] * scale - 3);
  });
}

function drawNoteheadsOverlay(overlay, notes, scale) {
  const ctx = overlay.getContext('2d');
  notes.forEach(n => {
    // Pink for filled (quarter/eighth), blue for hollow (half/whole)
    ctx.strokeStyle = n.filled
      ? 'rgba(240,160,192,0.9)'
      : 'rgba(160,192,240,0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(
      n.x * scale, n.y * scale,
      (n.w / 2 + 1) * scale, (n.h / 2 + 1) * scale,
      0, 0, Math.PI * 2
    );
    ctx.stroke();
    // Draw pitch label above the notehead
    if (n.pitch && n.pitch !== 'R') {
      ctx.fillStyle = 'rgba(240,208,128,0.95)';
      ctx.font = `${Math.max(7, 8 * scale)}px monospace`;
      ctx.fillText(n.pitch, n.x * scale - 10, (n.y - n.h / 2 - 2) * scale);
    }
  });
}


// ══════════════════════════════════════════════════════
//  SHOW RESULTS
//  Populates the notes table and score info box,
//  then calls loadScore() to register with the audio engine.
// ══════════════════════════════════════════════════════

function showResults(score, filename) {
  currentScore = score;

  // Score info summary
  const infoEl = document.getElementById('detectionInfo');
  infoEl.style.display = 'block';
  infoEl.innerHTML = `
    <strong style="color:var(--gold2)">${score.title}</strong><br>
    Key: ${score.key} &nbsp;·&nbsp; Time: ${score.time} &nbsp;·&nbsp; Mode: ${staffMode}-staff<br>
    Soprano: ${score.parts.soprano.length} &nbsp;
    Alto: ${score.parts.alto.length} &nbsp;
    Tenor: ${score.parts.tenor.length} &nbsp;
    Bass: ${score.parts.bass.length} notes
  `;

  // Notes table (first 100 notes sorted by measure/beat)
  const tbody    = document.getElementById('notesBody');
  tbody.innerHTML = '';
  const allNotes = [];
  Object.entries(score.parts).forEach(([v, ns]) =>
    ns.forEach(n => allNotes.push({ ...n, voice: v }))
  );
  allNotes.sort((a, b) => (a.measure - b.measure) || ((a.beat || 0) - (b.beat || 0)));
  allNotes.slice(0, 100).forEach(n => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${n.measure || '?'}</td>
      <td>${(n.beat || 0).toFixed(1)}</td>
      <td><span class="pitch-badge">${n.pitch}</span></td>
      <td>${_durName(n.duration)}</td>
      <td style="color:${_vCol(n.voice)}">${n.voice}</td>`;
    tbody.appendChild(tr);
  });

  document.getElementById('notesCard').style.display = 'block';
  document.getElementById('partsCard').style.display = 'block';

  // Hand off to the audio/library layer (defined in 05 and 06)
  loadScore(score, filename);
  toast(`✅ "${score.title}" — ${score.meta.totalNotes} notes`, 3500);
}

/** Human-readable duration name. */
function _durName(d) {
  return { 4: 'whole', 2: 'half', 1: 'quarter', 0.5: 'eighth', 0.25: '16th' }[d] || d + 'b';
}

/** Voice colour for the notes table. */
function _vCol(v) {
  return { soprano: '#f0a0c0', alto: '#c0a0f0', tenor: '#a0d0f0', bass: '#a0f0c0' }[v]
      || 'var(--text)';
}
