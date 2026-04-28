/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║  CHOIRMASTER OMR  —  FILE 6 of 7                        ║
 * ║  Score Library — Load · Save · Persist · Render         ║
 * ║                                                          ║
 * ║  PURPOSE: Manages the library of scanned scores.        ║
 * ║  Saves up to 20 scores in localStorage, renders the     ║
 * ║  saved-scores list in the Play tab, and provides        ║
 * ║  loadScore() which is the bridge between the OMR        ║
 * ║  pipeline and the audio engine.                         ║
 * ║                                                          ║
 * ║  DEPENDS ON: 02_globals_and_nav.js, 05_audio_engine.js  ║
 * ║  NEXT PASTE: 07_midi_and_camera.js                      ║
 * ╚══════════════════════════════════════════════════════════╝
 */

// ══════════════════════════════════════════════════════
//  LOAD SCORE
//  Called after every successful scan AND when the user
//  taps a saved score in the library.
//  Registers the score as the active currentScore,
//  updates all UI displays, and saves to the library.
// ══════════════════════════════════════════════════════

function loadScore(score, filename) {
  currentScore = score;

  const total = _calcTotal(score);
  S.totalSecs = total;

  // Now-playing header in the Play tab
  document.getElementById('npTitle').textContent = score.title || filename;
  const counts = Object.entries(score.parts)
    .map(([k, v]) => k[0].toUpperCase() + ':' + v.length)
    .join('  ');
  document.getElementById('npParts').textContent = counts + '  —  ' + _fmt(total);
  document.getElementById('tTot').textContent = _fmt(total);

  // MIDI info panel
  document.getElementById('midiInfo').innerHTML = `
    <strong style="color:var(--gold2)">${score.title}</strong><br>
    Key: ${score.key} &nbsp;|&nbsp; Time: ${score.time} &nbsp;|&nbsp; Tempo: ${score.tempo} BPM<br>
    Soprano: ${score.parts.soprano.length} &nbsp;
    Alto: ${score.parts.alto.length} &nbsp;
    Tenor: ${score.parts.tenor.length} &nbsp;
    Bass: ${score.parts.bass.length}
  `;

  saveSong(score, filename);
}


// ══════════════════════════════════════════════════════
//  DURATION CALCULATOR
//  Computes total playback duration in seconds for the
//  longest voice part at current tempo.
// ══════════════════════════════════════════════════════

function _calcTotal(sc) {
  const spb = 60 / S.tempo;
  const tsn = parseInt(sc.time) || 4;
  let mx = 0;
  Object.values(sc.parts).flat().forEach(n => {
    const t = ((n.measure - 1) * tsn + (n.beat - 1) + n.duration) * spb;
    if (t > mx) mx = t;
  });
  return mx || 10;
}

/** Re-export _fmt so it is accessible from this file if audio engine loaded first. */
function _fmt(s) {
  s = Math.max(0, s || 0);
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}


// ══════════════════════════════════════════════════════
//  SAVE SONG
//  Upserts a score into S.songs (max 20 entries, newest
//  first) and persists to localStorage.
// ══════════════════════════════════════════════════════

function saveSong(score, filename) {
  // Build a compact library entry (store the full score so we can replay it)
  const entry = {
    title:    score.title,
    filename,
    key:      score.key,
    time:     score.time,
    tempo:    score.tempo,
    score                   // full structured score for playback
  };

  const idx = S.songs.findIndex(s => s.title === score.title);
  if (idx >= 0) {
    S.songs[idx] = entry;           // update existing
  } else {
    S.songs.unshift(entry);         // prepend new
  }

  // Cap at 20 scores
  if (S.songs.length > 20) S.songs = S.songs.slice(0, 20);

  try {
    localStorage.setItem('omr_choirmaster', JSON.stringify(S.songs));
  } catch(e) {
    // Storage full — silently continue; the score is still active in memory
  }

  renderLib();
}


// ══════════════════════════════════════════════════════
//  RENDER LIBRARY
//  Rebuilds the saved-scores list in the Play tab.
//  Each entry has a tap area (loads the score) and a
//  delete button.
// ══════════════════════════════════════════════════════

function renderLib() {
  const lib = document.getElementById('library');
  if (!S.songs.length) {
    lib.innerHTML = '<p class="muted-msg">No scores yet — scan a hymn book to begin.</p>';
    return;
  }

  lib.innerHTML = S.songs.map((s, i) => `
    <div class="song-item" onclick="loadScore(S.songs[${i}].score, ${JSON.stringify(s.filename)})">
      <div class="song-thumb">🎵</div>
      <div class="song-info">
        <div class="song-title">${_escHtml(s.title)}</div>
        <div class="song-meta">${_escHtml(s.key)} · ${_escHtml(s.time)}</div>
      </div>
      <button class="btn-sm" style="flex:0;padding:6px 8px"
        onclick="event.stopPropagation(); _deleteSong(${i})">🗑</button>
    </div>
  `).join('');
}

/** Delete a saved song by index and re-render. */
function _deleteSong(i) {
  S.songs.splice(i, 1);
  try { localStorage.setItem('omr_choirmaster', JSON.stringify(S.songs)); } catch(e) {}
  renderLib();
}

/** Escape HTML to prevent XSS from crafted filenames/titles in localStorage. */
function _escHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Render the library on first load (restores from localStorage)
renderLib();
