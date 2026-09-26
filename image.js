/* =========================================================
   image.js — everything to do with photos
   ---------------------------------------------------------
   1. Shrinks uploaded photos so they fit in browser storage.
   2. Colour histogram: counts how much of each colour is in
      the photo. Two photos of the same blue bottle have
      similar histograms. Works everywhere, no internet needed.
   3. Detects the main colour → auto-fills the "Colour" field.
   4. AI (MobileNet, a pre-trained image-recognition model that
      runs inside the browser with TensorFlow.js):
        - guesses what the object is ("water bottle") → auto-tags
          and suggests a category
        - turns each photo into an "embedding" (1024 numbers).
          Photos of similar objects have similar embeddings.
      If the model can't load (no internet), the app still
      works using only the colour histogram.
   ========================================================= */

const ImageAI = (() => {
  let model = null;
  let status = 'loading'; // 'loading' | 'ready' | 'unavailable'
  const embeddings = new Map(); // item id → Float32Array
  const listeners = [];

  // ---- AI model ----------------------------------------------------------
  async function loadModel() {
    try {
      if (typeof mobilenet === 'undefined' || typeof tf === 'undefined') throw new Error('library not loaded');
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 25000));
      model = await Promise.race([mobilenet.load({ version: 2, alpha: 1.0 }), timeout]);
      status = 'ready';
    } catch (e) {
      console.warn('AI image model unavailable, using colour matching only:', e.message);
      status = 'unavailable';
    }
    listeners.forEach((fn) => fn(status));
  }

  function onStatus(fn) { listeners.push(fn); }

  // What the AI model's labels mean for our categories
  const LABEL_CATEGORY = [
    [/bottle|flask|cup|mug|tumbler/, 'Bottles'],
    [/wallet|purse/, 'Wallet & Money'],
    [/backpack|bag|sack|briefcase|suitcase/, 'Bags'],
    [/phone|laptop|notebook computer|computer|mouse|keyboard|ipod|remote|charger|modem|headphone|earphone|speaker|monitor|screen|hard disc|joystick|calculator/, 'Electronics'],
    [/key|padlock|lock/, 'Keys'],
    [/sunglass|glasses|spectacles|watch|necklace|ring|umbrella|hair slide|buckle/, 'Accessories'],
    [/jersey|sweatshirt|jacket|coat|shirt|cardigan|hat|cap|shoe|sneaker|sandal|sock|glove/, 'Clothing'],
    [/book|binder|envelope|pencil|pen|rule|comic/, 'Stationery & Books'],
  ];

  function categoryFromLabels(labels) {
    for (const label of labels) {
      for (const [re, cat] of LABEL_CATEGORY) if (re.test(label)) return cat;
    }
    return null;
  }

  async function classify(imgEl) {
    if (!model) return [];
    try {
      const preds = await model.classify(imgEl, 3);
      return preds.filter((p) => p.probability > 0.08).map((p) => p.className.split(',')[0].trim().toLowerCase());
    } catch (e) { return []; }
  }

  async function embed(imgEl) {
    if (!model) return null;
    try {
      const t = model.infer(imgEl, true);
      const data = await t.data();
      t.dispose();
      return data;
    } catch (e) { return null; }
  }

  // Compute embeddings for all items with photos (runs in the background)
  async function ensureEmbeddings(items) {
    if (!model) return false;
    let added = false;
    for (const it of items) {
      if (!it.image || embeddings.has(it.id)) continue;
      const img = await loadImage(it.image);
      const e = await embed(img);
      if (e) { embeddings.set(it.id, e); added = true; }
    }
    return added;
  }

  function embeddingSimilarity(idA, idB) {
    const a = embeddings.get(idA), b = embeddings.get(idB);
    if (!a || !b) return null;
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    const cos = dot / Math.sqrt(na * nb);
    // Unrelated photos still score ~0.3, so rescale 0.3..0.9 → 0..1
    return Math.max(0, Math.min(1, (cos - 0.3) / 0.6));
  }

  // ---- Basic image helpers -----------------------------------------------
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  // Shrink to max 400px so dozens of photos fit in localStorage
  function resize(img, max = 400) {
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.75);
  }

  function pixels(img, size = 48) {
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, size, size);
    return ctx.getImageData(0, 0, size, size).data;
  }

  // 4 levels each of R, G, B → 64 colour "bins"
  function histogram(img) {
    const px = pixels(img);
    const h = new Array(64).fill(0);
    let n = 0;
    for (let i = 0; i < px.length; i += 4) {
      const bin = (px[i] >> 6) * 16 + (px[i + 1] >> 6) * 4 + (px[i + 2] >> 6);
      h[bin]++; n++;
    }
    return h.map((v) => +(v / n).toFixed(4));
  }

  // Histogram intersection: 1 = identical colour mix, 0 = nothing in common
  function histogramSimilarity(a, b) {
    if (!a || !b) return 0;
    let s = 0;
    for (let i = 0; i < a.length; i++) s += Math.min(a[i], b[i]);
    return s;
  }

  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    return [h, max ? d / max : 0, max];
  }

  function colorName(r, g, b) {
    const [h, s, v] = rgbToHsv(r, g, b);
    if (v < 0.22) return 'Black';
    if (s < 0.15) return v > 0.8 ? 'White' : (v > 0.55 ? 'Silver' : 'Grey');
    if (h < 15 || h >= 340) return (v < 0.5 ? 'Brown' : (s < 0.5 ? 'Pink' : 'Red'));
    if (h < 40) return v < 0.6 ? 'Brown' : 'Orange';
    if (h < 65) return v < 0.6 ? 'Gold' : 'Yellow';
    if (h < 165) return 'Green';
    if (h < 255) return 'Blue';
    if (h < 290) return 'Purple';
    return 'Pink';
  }

  // Main colour = most common colour name in the CENTRE of the photo
  // (the object is usually in the middle, the background at the edges)
  function dominantColor(img) {
    const size = 40, px = pixels(img, size);
    const counts = {};
    for (let y = 8; y < 32; y++) {
      for (let x = 8; x < 32; x++) {
        const i = (y * size + x) * 4;
        const name = colorName(px[i], px[i + 1], px[i + 2]);
        counts[name] = (counts[name] || 0) + 1;
      }
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }

  // Everything we learn from a newly uploaded photo
  async function analyze(file) {
    const original = await loadImage(await fileToDataURL(file));
    const dataUrl = resize(original);
    const img = await loadImage(dataUrl);
    const labels = await classify(img);
    return {
      image: dataUrl,
      hist: histogram(img),
      color: dominantColor(img),
      aiTags: labels,
      suggestedCategory: categoryFromLabels(labels),
    };
  }

  return {
    loadModel, onStatus, get status() { return status; },
    analyze, ensureEmbeddings, embeddingSimilarity, histogramSimilarity,
    remember(id, emb) { embeddings.set(id, emb); },
    forget(id) { embeddings.delete(id); },
  };
})();
