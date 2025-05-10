const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const cors = require('cors');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;

// ✅ Allow CORS (replace * with your Vercel frontend URL for security)
app.use(cors({
  origin: '*', // or 'https://your-vercel-app.vercel.app'
}));

app.use(express.static('converted')); // Serve converted files

// ✅ Root route for Render health check
app.get('/', (req, res) => {
  res.send('🎧 MP4 to MP3 Backend is Live!');
});

// Ensure upload directories exist
['uploads', 'converted'].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
});

// Ensure conversionCount.json exists
const counterFilePath = path.join(__dirname, 'conversionCount.json');
if (!fs.existsSync(counterFilePath)) {
  fs.writeFileSync(counterFilePath, JSON.stringify({ count: 0, lastResetDate: new Date().toISOString() }));
}

// Conversion count logic
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

// Multer config
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

// POST /convert
app.post('/convert', upload.single('file'), (req, res) => {
  const { count, lastResetDate } = getConversionCount();
  const today = new Date().toISOString().split('T')[0];

  // Reset count daily
  if (today !== new Date(lastResetDate).toISOString().split('T')[0]) {
    updateConversionCount(0, new Date().toISOString());
  }

  if (count >= 3) {
    return res.status(403).json({ error: 'You’ve hit 3 free conversions today. Please upgrade to Pro.' });
  }

  const inputPath = req.file.path;
  const outputName = req.file.originalname.replace(path.extname(req.file.originalname), '.mp3');
  const outputPath = `converted/${outputName}`;

  ffmpeg(inputPath)
    .toFormat('mp3')
    .on('end', () => {
      updateConversionCount(count + 1, new Date().toISOString());

      // ✅ Use req.protocol + req.get('host') to get public Render URL
      const host = req.get('host');
      const downloadUrl = `${req.protocol}://${host}/download/${outputName}`;

      // Auto-delete files after 1 minute
      setTimeout(() => {
        try {
          fs.unlinkSync(inputPath);
          fs.unlinkSync(outputPath);
        } catch (err) {
          console.error('Cleanup error:', err);
        }
      }, 60000);

      res.json({ success: true, fileName: outputName, downloadUrl, count: count + 1 });
    })
    .on('error', (err) => {
      console.error('FFmpeg error:', err.message);
      fs.unlinkSync(inputPath);
      res.status(500).json({ error: 'Conversion failed. Try again later.' });
    })
    .save(outputPath);
});

// GET /conversionCount
app.get('/conversionCount', (req, res) => {
  const { count, lastResetDate } = getConversionCount();
  res.json({ totalCount: count, lastResetDate });
});

// GET /download/:filename
app.get('/download/:filename', (req, res) => {
  const fileName = req.params.filename;
  const filePath = path.join(__dirname, 'converted', fileName);

  fs.access(filePath, fs.constants.F_OK, (err) => {
    if (err) return res.status(404).json({ error: 'File not found' });

    res.setHeader('Content-Type', 'audio/mp3');
    res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
    res.sendFile(filePath);
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);
});
