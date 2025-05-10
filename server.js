const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const cors = require('cors');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.static('converted')); // Serve converted files

// Ensure upload directories exist
['uploads', 'converted'].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
});

// Ensure conversionCount.json exists
const counterFilePath = path.join(__dirname, 'conversionCount.json');
if (!fs.existsSync(counterFilePath)) {
  fs.writeFileSync(counterFilePath, JSON.stringify({ count: 0, lastResetDate: new Date().toISOString() }));
}

// Read conversion count from file
const getConversionCount = () => {
  try {
    const data = JSON.parse(fs.readFileSync(counterFilePath, 'utf8'));
    return data;
  } catch (err) {
    console.error('Error reading conversion count:', err);
    return { count: 0, lastResetDate: new Date().toISOString() };
  }
};

// Update conversion count in the file
const updateConversionCount = (count, resetDate) => {
  try {
    fs.writeFileSync(counterFilePath, JSON.stringify({ count, lastResetDate: resetDate }));
  } catch (err) {
    console.error('Error updating conversion count:', err);
  }
};

// Multer storage config
const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + path.extname(file.originalname);
    cb(null, uniqueName);
  },
});

// File filter for mp4 only
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'video/mp4') cb(null, true);
    else cb(new Error('Only .mp4 files are allowed!'), false);
  },
});

// POST /convert route
app.post('/convert', upload.single('file'), (req, res) => {
  const { count, lastResetDate } = getConversionCount();
  const today = new Date().toISOString().split('T')[0];

  // Reset count if it's a new day
  if (today !== new Date(lastResetDate).toISOString().split('T')[0]) {
    updateConversionCount(0, new Date().toISOString());
  }

  // Check if the user has exceeded the conversion limit
  if (count >= 3) {
    return res.status(403).json({ error: 'You’ve hit 3 free conversions today. Please upgrade to Pro.' });
  }

  const inputPath = req.file.path;
  const outputName = req.file.originalname.replace(path.extname(req.file.originalname), '.mp3');
  const outputPath = `converted/${outputName}`;

  ffmpeg(inputPath)
    .toFormat('mp3')
    .on('end', () => {
      // Increment conversion count
      const updatedCount = count + 1;
      updateConversionCount(updatedCount, new Date().toISOString());

      // Send the download URL for the MP3 file
      const downloadUrl = `http://localhost:${PORT}/download/${outputName}`;
      
      // Clean up the uploaded MP4 file and the converted MP3 file after 5 minutes
      setTimeout(() => {
        try {
          fs.unlinkSync(inputPath); // Remove MP4 file
          fs.unlinkSync(outputPath); // Remove MP3 file
        } catch (err) {
          console.error('Error deleting files:', err);
        }
      }, 1000 * 60 * 1); // Wait 1 minute (1000 ms)

      res.json({ success: true, fileName: outputName, downloadUrl });
    })
    .on('error', (err) => {
      console.error('FFmpeg error:', err.message);
      fs.unlinkSync(inputPath); // Remove MP4 file on error as well
      res.status(500).json({ error: 'Conversion failed. Try again later.' });
    })
    .save(outputPath);
});

// Route to get the current global conversion count
app.get('/conversionCount', (req, res) => {
  const { count, lastResetDate } = getConversionCount();
  res.json({ count, lastResetDate });
});

// Add a route to serve the MP3 files with proper download headers
app.get('/download/:filename', (req, res) => {
  const fileName = req.params.filename;
  const filePath = path.join(__dirname, 'converted', fileName);

  fs.access(filePath, fs.constants.F_OK, (err) => {
    if (err) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Set headers to force file download
    res.setHeader('Content-Type', 'audio/mp3');
    res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);

    // Send the file to the client for download
    res.sendFile(filePath);
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server is running at http://localhost:${PORT}`);
});
