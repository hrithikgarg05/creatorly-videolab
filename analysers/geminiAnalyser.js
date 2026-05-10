const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ─── Convert image to Gemini Part ────────────────────────────────────────────
function imageToGeminiPart(filePath, mimeType = 'image/jpeg') {
  const data = fs.readFileSync(filePath);
  return {
    inlineData: {
      data: data.toString('base64'),
      mimeType,
    },
  };
}

// ─── Build the master analysis prompt ────────────────────────────────────────
function buildVideoPrompt(computed, caption, hashtags, niche) {
  return `You are an expert Instagram Reels performance analyst and content strategist. I am providing you with 6 key frames from a video Reel, plus technical data about the video.

Your job is to deeply analyse this Reel and return a SINGLE valid JSON object. Do not include any text outside the JSON.

TECHNICAL DATA (from video processing):
- Duration: ${computed.videoInfo?.duration?.toFixed(1)}s
- Cuts/scene changes: ${computed.computed.sceneCuts} (${computed.computed.cutsPerMinute} cuts/min)
- Average shot length: ${computed.computed.avgShotLength}s
- Loudness: ${computed.computed.loudnessLUFS ?? 'N/A'} LUFS (${computed.computed.loudnessLabel})
- Silence/Dead air gaps (>2s): ${computed.computed.silenceGaps}
- Total silence: ${computed.computed.silencePercent}% of video
- Average brightness: ${computed.computed.avgBrightness ?? 'N/A'} (${computed.computed.brightnessLabel})
- Video format: ${computed.computed.aspectRatio} — ${computed.computed.isVertical ? 'VERTICAL (good for Reels)' : 'NOT VERTICAL (bad for Reels)'}

FRAMES PROVIDED (in order): Frame 0 = first frame, Frame 1 = 1 second in, Frame 2 = 3 seconds in, Frame 3 = 25% through, Frame 4 = midpoint, Frame 5 = near end.

CAPTION PROVIDED BY CREATOR:
"${caption || '(no caption provided)'}"

HASHTAGS PROVIDED:
"${hashtags || '(no hashtags provided)'}"

TARGET NICHE: ${niche || 'General / Lifestyle'}

Analyse all frames and data carefully. Return this EXACT JSON structure:

{
  "transcript": "Your best guess at what is said/shown in the video based on the frames and visual context",
  "thumbnail_frame": 0,
  "hook": {
    "score": 7,
    "sub_scores": {
      "first_frame_clarity": 8,
      "motion_in_first_second": 7,
      "face_presence": 10,
      "text_overlay": 6,
      "pattern_interrupt": 7,
      "curiosity_gap": 6,
      "why_should_i_care": 7
    },
    "strengths": ["Specific strength 1", "Specific strength 2"],
    "improvements": ["Specific actionable tip 1", "Specific actionable tip 2"]
  },
  "retention": {
    "score": 6,
    "sub_scores": {
      "pacing": 7,
      "scene_variety": 6,
      "dead_air_risk": 8,
      "intro_length": 5,
      "payoff_timing": 6,
      "loopability": 5,
      "end_drop_risk": 6
    },
    "strengths": [],
    "improvements": []
  },
  "visual_quality": {
    "score": 7,
    "sub_scores": {
      "brightness": 8,
      "sharpness": 7,
      "framing": 8,
      "background_clutter": 6,
      "camera_stability": 7,
      "color_temperature": 7,
      "face_visibility": 9
    },
    "strengths": [],
    "improvements": []
  },
  "audio_quality": {
    "score": 7,
    "sub_scores": {
      "speech_clarity": 8,
      "loudness_level": 7,
      "background_noise": 7,
      "silence_gaps": 8,
      "music_vocal_balance": 6
    },
    "strengths": [],
    "improvements": []
  },
  "content_structure": {
    "score": 6,
    "sub_scores": {
      "problem_solution_clarity": 6,
      "storytelling_arc": 7,
      "cta_presence": 5,
      "value_density": 7,
      "emotional_intensity": 6,
      "specificity": 6,
      "jargon_level": 8
    },
    "strengths": [],
    "improvements": []
  },
  "editing": {
    "score": 7,
    "sub_scores": {
      "cut_rhythm": 7,
      "visual_variety": 6,
      "zoom_punch_in_usage": 5,
      "transition_smoothness": 8,
      "repetitive_frames": 7,
      "thumbnail_worthy_moment": 8
    },
    "strengths": [],
    "improvements": []
  },
  "text_subtitles": {
    "score": 6,
    "sub_scores": {
      "subtitle_presence": 5,
      "readability": 7,
      "safe_zone_placement": 6,
      "text_contrast": 7,
      "font_size": 6
    },
    "strengths": [],
    "improvements": []
  },
  "compliance": {
    "score": 9,
    "flags": [],
    "warnings": [],
    "is_brand_safe": true
  },
  "overall_summary": "A 2-3 sentence honest assessment of this video's performance potential on Instagram Reels.",
  "predicted_performance": "below_average | average | above_average | viral_potential",
  "top_3_wins": ["Best thing about this video 1", "Best thing 2", "Best thing 3"],
  "top_3_fixes": ["Most impactful fix 1", "Fix 2", "Fix 3"]
}

Be specific and actionable. Reference what you actually see in the frames. Use the technical data to inform audio and pacing scores. Scores of 5 are average — be honest, not generous.`;
}

// ─── Analyse video frames with Gemini ────────────────────────────────────────
async function analyseWithGemini(ffmpegData, caption, hashtags, niche) {
  console.log('🤖 Starting Gemini Vision analysis...');

  const modelName = process.env.GEMINI_MODEL || 'gemini-1.5-flash-latest';
  const model = genAI.getGenerativeModel({ model: modelName });

  const imageParts = ffmpegData.framePaths
    .filter(p => fs.existsSync(p))
    .map(p => imageToGeminiPart(p));

  if (imageParts.length === 0) {
    throw new Error('No video frames could be extracted for analysis');
  }

  const prompt = buildVideoPrompt(ffmpegData, caption, hashtags, niche);

  const result = await model.generateContent([prompt, ...imageParts]);
  const responseText = result.response.text();

  // Extract JSON from response (Gemini sometimes wraps in markdown)
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Gemini did not return valid JSON');

  const analysis = JSON.parse(jsonMatch[0]);
  console.log('✅ Gemini analysis complete');
  return analysis;
}

module.exports = { analyseWithGemini };
