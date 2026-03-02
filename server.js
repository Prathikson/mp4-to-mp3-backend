const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const cors = require('cors');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;

// ── CORS ──────────────────────────────────────────────────────────
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // allow curl/Postman/mobile
    const clean = origin.replace(/\/$/, ''); // strip trailing slash
    const allowed = [
      'https://mp4-to-mp3-frontend.vercel.app',
      'https://mp4tomp3.xtoicstudio.com',
      'http://localhost:3000',
      'http://localhost:3001',
    ];
    if (allowed.includes(clean)) return callback(null, true);
    return callback(new Error('CORS blocked: ' + origin));
  },
  methods: ['GET', 'POST'],
}));

// ── Static files (serve converted audio) ─────────────────────────
app.use('/download', express.static(path.join(__dirname, 'converted')));

// ── Health check ──────────────────────────────────────────────────
app.get('/', (req, res) => res.send('MP4 to MP3 backend is live.'));

// ── Keep-alive (prevents Render free tier sleeping) ───────────────
setInterval(() => {
  require('https').get('https://mp4-to-mp3-backend-hu8o.onrender.com/').on('error', () => {});
}, 14 * 60 * 1000);

// ── Ensure directories ────────────────────────────────────────────
['uploads', 'converted'].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
});

// ── Conversion counter ────────────────────────────────────────────
const counterFile = path.join(__dirname, 'conversionCount.json');
if (!fs.existsSync(counterFile)) {
  fs.writeFileSync(counterFile, JSON.stringify({ count: 0, lastResetDate: new Date().toISOString() }));
}

const getCount = () => {
  try { return JSON.parse(fs.readFileSync(counterFile, 'utf8')); }
  catch { return { count: 0, lastResetDate: new Date().toISOString() }; }
};

const setCount = (count, date) => {
  fs.writeFileSync(counterFile, JSON.stringify({ count, lastResetDate: date }));
};

// ── Multer ────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname)),
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'video/mp4') cb(null, true);
    else cb(new Error('Only .mp4 files are allowed'));
  },
});

// ── Convert ───────────────────────────────────────────────────────
app.post('/convert', upload.single('file'), (req, res) => {
  let { count, lastResetDate } = getCount();

  // Reset daily counter
  const today = new Date().toISOString().split('T')[0];
  if (today !== new Date(lastResetDate).toISOString().split('T')[0]) {
    count = 0;
    setCount(0, new Date().toISOString());
  }

  const inputPath  = req.file.path;
  const outputName = Date.now() + '_' + req.file.originalname.replace(/\.mp4$/i, '.mp3');
  const outputPath = path.join('converted', outputName);

  ffmpeg(inputPath)
    .toFormat('mp3')
    .on('end', () => {
      setCount(count + 1, new Date().toISOString());

      // Auto-delete after 5 minutes
      setTimeout(() => {
        try { fs.unlinkSync(inputPath); } catch {}
        try { fs.unlinkSync(outputPath); } catch {}
      }, 5 * 60 * 1000);

      // Return fileName — the frontend builds the full URL itself
      // This avoids any protocol (http/https) mismatch issues
      res.json({
        success: true,
        fileName: outputName,
        count: count + 1,
      });
    })
    .on('error', err => {
      console.error('FFmpeg error:', err.message);
      try { fs.unlinkSync(inputPath); } catch {}
      res.status(500).json({ error: 'Conversion failed. Please try again.' });
    })
    .save(outputPath);
});

// ── Conversion count ──────────────────────────────────────────────
app.get('/conversionCount', (req, res) => {
  const { count, lastResetDate } = getCount();
  res.json({ totalCount: count, lastResetDate });
});

// ── Download ──────────────────────────────────────────────────────
app.get('/download/:filename', (req, res) => {
  const safeName = path.basename(req.params.filename);
  const filePath = path.join(__dirname, 'converted', safeName);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found or already deleted.' });
  }

  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
  res.sendFile(filePath, { root: __dirname }, err => {
    if (err) res.status(500).send('Download error');
  });
});

// ── Start ─────────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));