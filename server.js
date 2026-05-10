const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { runFfmpegAnalysis } = require('./analysers/ffmpegHelper');
const { analyseWithGemini } = require('./analysers/geminiAnalyser');
const { analyseText } = require('./analysers/textAnalyser');

const app = express();
const PORT = process.env.PORT || 3001;

// ─── CORS ─────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: [
    'https://creatorlyai.in',
    'https://www.creatorlyai.in',
    'http://localhost:3000',
    'http://localhost:3001',
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
}));

app.use(express.json());

// ─── File Upload ──────────────────────────────────────────────────────────────
const upload = multer({
  dest: '/tmp/uploads/',
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm', 'video/x-matroska'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only video files (MP4, MOV, AVI, WEBM) are allowed'));
    }
  }
});

// ─── Cleanup helper ───────────────────────────────────────────────────────────
function cleanupFiles(videoPath, framesDir) {
  try {
    if (videoPath && fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
    if (framesDir && fs.existsSync(framesDir)) {
      fs.readdirSync(framesDir).forEach(f => fs.unlinkSync(path.join(framesDir, f)));
      fs.rmdirSync(framesDir);
    }
  } catch (e) {
    console.warn('Cleanup error:', e.message);
  }
}

// ─── Score aggregator ────────────────────────────────────────────────────────
function computeOverallScore(analysis) {
  const weights = {
    hook: 0.20,
    retention: 0.15,
    content_structure: 0.15,
    audio_quality: 0.10,
    visual_quality: 0.10,
    caption: 0.10,
    editing: 0.07,
    text_subtitles: 0.05,
    hashtags: 0.05,
    compliance: 0.03,
  };

  let total = 0;
  let totalWeight = 0;
  for (const [key, weight] of Object.entries(weights)) {
    const score = analysis[key]?.score;
    if (score !== null && score !== undefined) {
      total += score * weight;
      totalWeight += weight;
    }
  }

  return totalWeight > 0 ? Math.round((total / totalWeight) * 10) / 10 : null;
}

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'Creatorly Video Lab API', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Video Lab API is running' });
});

// ─── Main Analysis Endpoint ───────────────────────────────────────────────────
app.post('/api/analyse', upload.single('video'), async (req, res) => {
  const videoPath = req.file?.path;
  const framesDir = videoPath ? videoPath + '_frames' : null;

  try {
    if (!videoPath) {
      return res.status(400).json({ error: 'No video file uploaded' });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: 'GEMINI_API_KEY not configured on server' });
    }

    const caption = (req.body.caption || '').trim();
    const hashtags = (req.body.hashtags || '').trim();
    const niche = (req.body.niche || 'general').trim();

    console.log(`\n📥 New analysis request | Niche: ${niche} | File: ${req.file.originalname} (${(req.file.size / 1024 / 1024).toFixed(1)}MB)`);

    // 1. Run ffmpeg analysis (extract frames, audio stats, scene cuts)
    const ffmpegData = await runFfmpegAnalysis(videoPath, framesDir);

    if (ffmpegData.videoInfo.duration < 1) {
      return res.status(400).json({ error: 'Video is too short or could not be read' });
    }

    // 2. Run Gemini Vision analysis (uses extracted frames)
    const geminiAnalysis = await analyseWithGemini(ffmpegData, caption, hashtags, niche);

    // 3. Run text analysis (caption + hashtags)
    const textAnalysis = await analyseText({ caption, hashtags, niche });

    // 4. Merge everything into final result
    const finalResult = {
      ...geminiAnalysis,
      caption: textAnalysis.caption,
      hashtags: textAnalysis.hashtags,
      video_info: {
        duration: ffmpegData.videoInfo.duration,
        resolution: ffmpegData.computed.aspectRatio,
        is_vertical: ffmpegData.computed.isVertical,
        fps: ffmpegData.videoInfo.fps,
        has_audio: ffmpegData.videoInfo.hasAudio,
      },
      technical: ffmpegData.computed,
      overall_score: null, // computed below
      analysed_at: new Date().toISOString(),
    };

    finalResult.overall_score = computeOverallScore(finalResult);

    console.log(`✅ Analysis complete. Overall score: ${finalResult.overall_score}/10`);
    res.json({ success: true, results: finalResult });

  } catch (err) {
    console.error('❌ Analysis error:', err.message);
    res.status(500).json({ error: err.message || 'Analysis failed' });
  } finally {
    cleanupFiles(videoPath, framesDir);
  }
});

// ─── Error handler ────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large. Maximum size is 500MB.' });
  }
  res.status(400).json({ error: err.message });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Creatorly Video Lab API running on port ${PORT}`);
  console.log(`   Gemini API Key: ${process.env.GEMINI_API_KEY ? '✅ Set' : '❌ MISSING'}`);
});
