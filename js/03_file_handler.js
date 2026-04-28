/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║  CHOIRMASTER OMR  —  FILE 3 of 7                        ║
 * ║  File Handler — Image & PDF Loading                     ║
 * ║                                                          ║
 * ║  PURPOSE: Accepts any image (JPG/PNG) or PDF file       ║
 * ║  from upload, drag-and-drop, or camera. Converts        ║
 * ║  everything to an HTMLImageElement then hands it to     ║
 * ║  processImage() in the OMR pipeline.                    ║
 * ║                                                          ║
 * ║  DEPENDS ON: 02_globals_and_nav.js                      ║
 * ║  CALLS:      processImage() from 04_omr_pipeline.js     ║
 * ║  NEXT PASTE: 04_omr_pipeline.js                         ║
 * ╚══════════════════════════════════════════════════════════╝
 */

// ══════════════════════════════════════════════════════
//  DRAG-AND-DROP ENTRY POINT
// ══════════════════════════════════════════════════════

function handleDrop(e) {
  e.preventDefault();
  document.getElementById('dropZone').classList.remove('drag');
  const f = e.dataTransfer.files[0];
  if (f) handleFile(f);
}


// ══════════════════════════════════════════════════════
//  MAIN FILE DISPATCH
//  Routes the user's file to either the PDF renderer
//  or the direct image loader depending on MIME type.
// ══════════════════════════════════════════════════════

function handleFile(file) {
  if (!file) return;

  // OpenCV must be ready before we can process anything
  if (!cvReady) {
    toast('⏳ Vision engine still loading — please wait a moment');
    return;
  }

  // Reset UI state
  clearLog();
  resetStages();
  document.getElementById('detectionInfo').style.display = 'none';
  document.getElementById('notesCard').style.display     = 'none';
  document.getElementById('partsCard').style.display     = 'none';
  document.getElementById('canvasWrap').style.display    = 'none';

  const isPDF = file.type === 'application/pdf'
             || file.name.toLowerCase().endsWith('.pdf');

  if (isPDF) {
    loadPDF(file);
  } else if (file.type.startsWith('image/')) {
    _loadImageFile(file);
  } else {
    toast('⚠️ Please upload an image (JPG / PNG) or a PDF file');
  }
}


// ══════════════════════════════════════════════════════
//  IMAGE FILE LOADER
//  Reads the file with FileReader and creates an
//  HTMLImageElement, then triggers the OMR pipeline.
// ══════════════════════════════════════════════════════

function _loadImageFile(file) {
  setStage('load', 'active');
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => processImage(img, file.name);
    img.onerror = () => {
      setStage('load', 'err');
      log('Could not load image — is the file corrupted?', 'err');
      toast('⚠️ Image load failed');
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}


// ══════════════════════════════════════════════════════
//  PDF RENDERER
//  Uses PDF.js (loaded on-demand from CDN) to rasterise
//  the first page of the PDF at 2.5× scale, producing a
//  high-resolution image for the OMR pipeline.
//
//  NOTE: Only page 1 is processed in this version.
//  Multi-page support is a planned Phase 2 feature.
// ══════════════════════════════════════════════════════

async function loadPDF(file) {
  log('PDF detected — rendering page 1…', 'info');
  setStage('load', 'active');

  const reader = new FileReader();
  reader.onload = async e => {
    try {
      // Dynamically load PDF.js if not already present
      if (!window.pdfjsLib) {
        await _loadScript(
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
        );
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      }

      // Parse the PDF from ArrayBuffer
      const pdf = await window.pdfjsLib.getDocument({ data: e.target.result }).promise;
      log(`PDF loaded: ${pdf.numPages} page(s) — rendering page 1 at 2.5×`, 'ok');

      const page = await pdf.getPage(1);

      // High-resolution render: 2.5× gives ~2000px wide for a typical A4 page
      const scale    = 2.5;
      const viewport = page.getViewport({ scale });
      const tmpCanvas = document.createElement('canvas');
      tmpCanvas.width  = viewport.width;
      tmpCanvas.height = viewport.height;

      await page.render({
        canvasContext: tmpCanvas.getContext('2d'),
        viewport
      }).promise;

      log(`Rendered: ${tmpCanvas.width}×${tmpCanvas.height}px`, 'ok');

      // Convert canvas to an Image element and pass to OMR
      const img = new Image();
      img.onload = () => processImage(img, file.name.replace(/\.pdf$/i, '.png'));
      img.src = tmpCanvas.toDataURL('image/png');

    } catch (err) {
      setStage('load', 'err');
      log('PDF render failed: ' + err.message, 'err');
      toast('⚠️ Could not render PDF — try uploading as JPG instead');
    }
  };
  reader.readAsArrayBuffer(file);
}


// ══════════════════════════════════════════════════════
//  DYNAMIC SCRIPT LOADER
//  Injects a <script> tag and returns a Promise that
//  resolves when the script has loaded.
// ══════════════════════════════════════════════════════

function _loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src     = src;
    s.onload  = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}
