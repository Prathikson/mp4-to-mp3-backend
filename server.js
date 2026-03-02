const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const cors = require('cors');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
  origin: (origin, callback) => {
    // Allow no-origin requests (mobile apps, Postman, curl)
    if (!origin) return callback(null, true);

    const allowed = [
      'https://mp4-to-mp3-frontend.vercel.app',
      'https://mp4tomp3.xtoicstudio.com',
      'http://localhost:3000',
      'http://localhost:3001',
    ];

    // Strip trailing slash before comparing
    const clean = origin.replace(/\/$/, '');
    if (allowed.includes(clean)) {
      callback(null, true);
    } else {
      callback(new Error('CORS not allowed from: ' + origin));
    }
  },
  methods: ['POST', 'GET'],
}));

app.use(express.static('converted'));

// Root health check
app.get('/', (req, res) => {
  res.send('MP4 to MP3 Backend is Live!');
});

// Keep-alive self-ping to prevent Render free tier from sleeping
setInterval(() => {
  require('https').get('https://mp4-to-mp3-backend-hu8o.onrender.com/').on('error', () => {});
}, 14 * 60 * 1000);

// Ensure necessary directories exist
['uploads', 'converted'].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
});

// Conversion counter
const counterFilePath = path.join(__dirname, 'conversionCount.json');
if (!fs.existsSync(counterFilePath)) {
  fs.writeFileSync(counterFilePath, JSON.stringify({ count: 0, lastResetDate: new Date().toISOString() }));
}

const getConversionCount = () => {
  try {
    return JSON.parse(fs.readFileSync(counterFilePath, 'utf8'));
  } catch {
    return { count: 0, lastResetDate: new Date().toISOString() };
  }
};

const updateConversionCount = (count, resetDate) => {
  fs.writeFileSync(counterFilePath, JSON.stringify({ count, lastResetDate: resetDate }));
};

// Multer setup
const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + path.extname(file.originalname);
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'video/mp4') cb(null, true);
    else cb(new Error('Only .mp4 files are allowed!'), false);
  },
});

// Convert route
app.post('/convert', upload.single('file'), (req, res) => {
  let { count, lastResetDate } = getConversionCount();
  const today = new Date().toISOString().split('T')[0];

  // Reset daily counter if it's a new day
  if (today !== new Date(lastResetDate).toISOString().split('T')[0]) {
    count = 0;
    updateConversionCount(0, new Date().toISOString());
  }

  if (count >= 3) {
    return res.status(403).json({ error: "You've hit 3 free conversions today. Please upgrade to Pro." });
  }

  const inputPath = req.file.path;
  const outputName = req.file.originalname.replace(path.extname(req.file.originalname), '.mp3');
  const outputPath = `converted/${outputName}`;

  ffmpeg(inputPath)
    .toFormat('mp3')
    .on('end', () => {
      updateConversionCount(count + 1, new Date().toISOString());

      const host = req.get('host');
      const isLocal = host.includes('localhost') || host.includes('127.0.0.1');
      const protocol = isLocal ? 'http' : 'https';
      const downloadUrl = `${protocol}://${host}/download/${encodeURIComponent(outputName)}`;

      // Auto-delete files after 5 minutes
      setTimeout(() => {
        try { fs.unlinkSync(inputPath); } catch {}
        try { fs.unlinkSync(outputPath); } catch {}
      }, 1000 * 60 * 5);

      res.json({ success: true, fileName: outputName, downloadUrl, count: count + 1 });
    })
    .on('error', (err) => {
      console.error('FFmpeg error:', err.message);
      try { fs.unlinkSync(inputPath); } catch {}
      res.status(500).json({ error: 'Conversion failed. Try again later.' });
    })
    .save(outputPath);
});

// Conversion count route
app.get('/conversionCount', (req, res) => {
  const { count, lastResetDate } = getConversionCount();
  res.json({ totalCount: count, lastResetDate });
});

// Download route
app.get('/download/:filename', (req, res) => {
  const safeName = path.basename(req.params.filename);
  const filePath = path.join(__dirname, 'converted', safeName);

  fs.access(filePath, fs.constants.F_OK, (err) => {
    if (err) {
      console.error('Download error: File not found', safeName);
      return res.status(404).json({ error: 'File not found' });
    }

    res.setHeader('Content-Type', 'audio/mp3');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    res.sendFile(filePath, (err) => {
      if (err) {
        console.error('SendFile error:', err);
        res.status(500).send('Download error');
      }
    });
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});