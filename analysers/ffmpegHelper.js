const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const ffprobeStatic = require('ffprobe-static');
const fs = require('fs');
const path = require('path');

ffmpeg.setFfmpegPath(ffmpegStatic);
ffmpeg.setFfprobePath(ffprobeStatic.path);

// ─── Get Video Metadata ───────────────────────────────────────────────────────
function getVideoInfo(videoPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) return reject(err);
      const videoStream = metadata.streams.find(s => s.codec_type === 'video');
      const audioStream = metadata.streams.find(s => s.codec_type === 'audio');
      resolve({
        duration: metadata.format.duration || 0,
        size: metadata.format.size || 0,
        fps: eval(videoStream?.r_frame_rate || '30/1'),
        width: videoStream?.width || 0,
        height: videoStream?.height || 0,
        hasAudio: !!audioStream,
        audioCodec: audioStream?.codec_name || null,
        videoCodec: videoStream?.codec_name || null,
      });
    });
  });
}

// ─── Extract Key Frames ───────────────────────────────────────────────────────
// Extract 6 frames: 0s, 1s, 3s, 25%, 50%, 90% of duration
function extractFrames(videoPath, duration, outputDir) {
  const timestamps = [
    0,                              // very first frame
    1,                              // 1 second in (hook)
    Math.min(3, duration * 0.1),   // 3 seconds (hook end)
    duration * 0.25,                // 25% through
    duration * 0.5,                 // midpoint
    duration * 0.9,                 // near end
  ].map(t => Math.min(t, duration - 0.1));

  const framePaths = timestamps.map((_, i) => path.join(outputDir, `frame_${i}.jpg`));

  return Promise.all(
    timestamps.map((ts, i) =>
      new Promise((resolve, reject) => {
        ffmpeg(videoPath)
          .screenshots({
            timestamps: [ts],
            filename: `frame_${i}.jpg`,
            folder: outputDir,
            size: '720x?', // maintain aspect ratio, max 720px wide
          })
          .on('end', () => resolve(framePaths[i]))
          .on('error', (err) => {
            console.warn(`Frame ${i} extraction failed:`, err.message);
            resolve(null); // Don't fail the whole analysis for one frame
          });
      })
    )
  );
}

// ─── Scene Change Detection ───────────────────────────────────────────────────
function detectSceneChanges(videoPath) {
  return new Promise((resolve) => {
    const scenes = [];
    ffmpeg(videoPath)
      .outputOptions([
        '-vf', 'select=\'gt(scene,0.35)\',showinfo',
        '-f', 'null',
      ])
      .output('/dev/null')
      .on('stderr', (line) => {
        const match = line.match(/pts_time:([\d.]+)/);
        if (match) scenes.push(parseFloat(match[1]));
      })
      .on('end', () => resolve(scenes))
      .on('error', () => resolve([])) // Fallback: no scene data
      .run();
  });
}

// ─── Audio Loudness (LUFS) ────────────────────────────────────────────────────
function getAudioLoudness(videoPath) {
  return new Promise((resolve) => {
    let loudnessData = { inputI: null, inputTP: null, inputLRA: null };
    ffmpeg(videoPath)
      .audioFilters('loudnorm=print_format=json')
      .format('null')
      .output('/dev/null')
      .on('stderr', (line) => {
        try {
          if (line.includes('"input_i"')) {
            const json = line.substring(line.indexOf('{'));
            const parsed = JSON.parse(json);
            loudnessData = {
              inputI: parseFloat(parsed.input_i),       // Integrated loudness (LUFS)
              inputTP: parseFloat(parsed.input_tp),     // True peak
              inputLRA: parseFloat(parsed.input_lra),  // Loudness range
            };
          }
        } catch (_) {}
      })
      .on('end', () => resolve(loudnessData))
      .on('error', () => resolve(loudnessData))
      .run();
  });
}

// ─── Silence Detection ────────────────────────────────────────────────────────
function detectSilence(videoPath, duration) {
  return new Promise((resolve) => {
    const silenceGaps = [];
    let totalSilence = 0;
    ffmpeg(videoPath)
      .audioFilters('silencedetect=noise=-40dB:d=0.5')
      .format('null')
      .output('/dev/null')
      .on('stderr', (line) => {
        const startMatch = line.match(/silence_start: ([\d.]+)/);
        const endMatch = line.match(/silence_end: ([\d.]+)/);
        const durMatch = line.match(/silence_duration: ([\d.]+)/);
        if (startMatch && endMatch && durMatch) {
          const gap = parseFloat(durMatch[1]);
          silenceGaps.push({ start: parseFloat(startMatch[1]), duration: gap });
          totalSilence += gap;
        }
      })
      .on('end', () => resolve({
        gaps: silenceGaps,
        totalSilenceSecs: Math.round(totalSilence * 10) / 10,
        silencePercent: duration > 0 ? Math.round((totalSilence / duration) * 100) : 0,
        deadAirCount: silenceGaps.filter(g => g.duration > 2).length,
      }))
      .on('error', () => resolve({ gaps: [], totalSilenceSecs: 0, silencePercent: 0, deadAirCount: 0 }))
      .run();
  });
}

// ─── Video Brightness / Sharpness ────────────────────────────────────────────
function getVideoStats(videoPath) {
  return new Promise((resolve) => {
    let brightnessValues = [];
    ffmpeg(videoPath)
      .outputOptions(['-vf', 'signalstats,metadata=print:file=-', '-f', 'null'])
      .output('/dev/null')
      .on('stderr', (line) => {
        const match = line.match(/YAVG=([\d.]+)/);
        if (match) brightnessValues.push(parseFloat(match[1]));
      })
      .on('end', () => {
        if (brightnessValues.length === 0) return resolve({ avgBrightness: null, brightnessVariance: null });
        const avg = brightnessValues.reduce((a, b) => a + b, 0) / brightnessValues.length;
        const variance = brightnessValues.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / brightnessValues.length;
        resolve({
          avgBrightness: Math.round(avg),
          brightnessVariance: Math.round(variance),
        });
      })
      .on('error', () => resolve({ avgBrightness: null, brightnessVariance: null }))
      .run();
  });
}

// ─── Main ffmpeg Analyser ─────────────────────────────────────────────────────
async function runFfmpegAnalysis(videoPath, framesOutputDir) {
  console.log('🎬 Starting ffmpeg analysis...');

  const [info, scenes, loudness, silence, videoStats] = await Promise.all([
    getVideoInfo(videoPath),
    detectSceneChanges(videoPath),
    getVideoInfo(videoPath).then(i => i.hasAudio ? getAudioLoudness(videoPath) : Promise.resolve({})),
    getVideoInfo(videoPath).then(i => i.hasAudio ? detectSilence(videoPath, i.duration) : Promise.resolve({ gaps: [], totalSilenceSecs: 0, silencePercent: 0, deadAirCount: 0 })),
    getVideoStats(videoPath),
  ]);

  // Recalculate loudness properly
  const [loudnessReal, silenceReal] = await Promise.all([
    info.hasAudio ? getAudioLoudness(videoPath) : Promise.resolve({ inputI: null, inputTP: null }),
    info.hasAudio ? detectSilence(videoPath, info.duration) : Promise.resolve({ gaps: [], totalSilenceSecs: 0, silencePercent: 0, deadAirCount: 0 }),
  ]);

  // Extract frames
  fs.mkdirSync(framesOutputDir, { recursive: true });
  const framePaths = await extractFrames(videoPath, info.duration, framesOutputDir);
  const validFrames = framePaths.filter(f => f && fs.existsSync(f));

  // Calculate pacing metrics
  const cutsPerMinute = info.duration > 0 ? (scenes.length / info.duration) * 60 : 0;
  const avgShotLength = scenes.length > 0 ? info.duration / (scenes.length + 1) : info.duration;

  // Brightness interpretation
  let brightnessLabel = 'Unknown';
  if (videoStats.avgBrightness !== null) {
    if (videoStats.avgBrightness < 60) brightnessLabel = 'Too Dark';
    else if (videoStats.avgBrightness < 100) brightnessLabel = 'Slightly Dark';
    else if (videoStats.avgBrightness < 180) brightnessLabel = 'Well Lit';
    else if (videoStats.avgBrightness < 220) brightnessLabel = 'Bright';
    else brightnessLabel = 'Overexposed';
  }

  // Loudness interpretation
  let loudnessLabel = 'Unknown';
  if (loudnessReal.inputI !== null) {
    if (loudnessReal.inputI < -30) loudnessLabel = 'Too Quiet';
    else if (loudnessReal.inputI < -20) loudnessLabel = 'Slightly Quiet';
    else if (loudnessReal.inputI < -12) loudnessLabel = 'Good Level';
    else if (loudnessReal.inputI < -6) loudnessLabel = 'Slightly Loud';
    else loudnessLabel = 'Too Loud / Clipping Risk';
  }

  console.log(`✅ ffmpeg done. Duration: ${info.duration}s, Cuts: ${scenes.length}, Frames: ${validFrames.length}`);

  return {
    videoInfo: info,
    framePaths: validFrames,
    computed: {
      sceneCuts: scenes.length,
      cutsPerMinute: Math.round(cutsPerMinute * 10) / 10,
      avgShotLength: Math.round(avgShotLength * 10) / 10,
      loudnessLUFS: loudnessReal.inputI,
      loudnessLabel,
      truePeakDB: loudnessReal.inputTP,
      silenceGaps: silenceReal.deadAirCount,
      silencePercent: silenceReal.silencePercent,
      totalSilenceSecs: silenceReal.totalSilenceSecs,
      avgBrightness: videoStats.avgBrightness,
      brightnessLabel,
      aspectRatio: info.width && info.height ? `${info.width}x${info.height}` : 'Unknown',
      isVertical: info.height > info.width,
    }
  };
}

module.exports = { runFfmpegAnalysis };
