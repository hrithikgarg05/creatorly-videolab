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

function buildVideoPrompt(computed, caption, hashtags, niche) {
  return `You are a world-class TikTok and Instagram Reels Strategist. Your job is to deeply analyze the provided video frames and metadata to predict its viral potential. Do NOT give basic, generic advice (e.g., "show your face", "add cuts"). I need sophisticated, advanced content strategy.

### VIRAL CONTENT PLAYBOOK & RULES
1. **The Hook (0-3s):** Is there a visual pattern interrupt? Does the first frame create a 'Curiosity Gap'? Are they using a bold statement or visual anomaly?
2. **Retention Mechanics:** A viral video must have high 'Value Density' (no fluff). It should use pacing changes to reset the viewer's attention span.
3. **Loopability:** Does the ending seamlessly transition back to the beginning?
4. **Authenticity over Polish:** Sometimes, raw/lo-fi videos go viral faster than highly edited ones if the storytelling is authentic and relatable. Do not penalize "lower quality" visuals if the content is highly engaging or relatable.
5. **The Algorithm:** The algorithm rewards watch time, shares, and saves. Does this video evoke an emotion (funny, controversial, educational, relatable) that makes someone want to share it with a friend?

### TECHNICAL DATA
- Duration: ${computed.videoInfo?.duration?.toFixed(1)}s
- Cuts/scene changes: ${computed.computed.sceneCuts} (${computed.computed.cutsPerMinute} cuts/min)
- Average shot length: ${computed.computed.avgShotLength}s
- Loudness: ${computed.computed.loudnessLUFS ?? 'N/A'} LUFS
- Silence/Dead air gaps (>2s): ${computed.computed.silenceGaps}
- Total silence: ${computed.computed.silencePercent}% of video
- Format: ${computed.computed.aspectRatio} — ${computed.computed.isVertical ? 'VERTICAL' : 'NOT VERTICAL'}

### CREATOR METADATA
- Caption: "${caption || '(no caption provided)'}"
- Hashtags: "${hashtags || '(no hashtags provided)'}"
- Target Niche: ${niche || 'General / Lifestyle'}

### INSTRUCTIONS FOR SCORING
- Do NOT just look at the technical stats. A video with 0 cuts can go viral if the storytelling is incredible.
- A video with lots of cuts but no substance will flop. Grade based on SUBSTANCE, EMOTION, and VIRAL MECHANICS.
- Return EXACTLY this JSON structure, and nothing else.

{
  "transcript": "Your guess at the content/story based on visual context.",
  "thumbnail_frame": 0,
  "hook": {
    "score": 7,
    "sub_scores": { "first_frame_clarity": 8, "motion_in_first_second": 7, "face_presence": 10, "text_overlay": 6, "pattern_interrupt": 7, "curiosity_gap": 6, "why_should_i_care": 7 },
    "strengths": ["Advanced observation 1", "Advanced observation 2"],
    "improvements": ["Advanced, highly specific tip 1", "Advanced tip 2"]
  },
  "retention": {
    "score": 6,
    "sub_scores": { "pacing": 7, "scene_variety": 6, "dead_air_risk": 8, "intro_length": 5, "payoff_timing": 6, "loopability": 5, "end_drop_risk": 6 },
    "strengths": [],
    "improvements": []
  },
  "visual_quality": {
    "score": 7,
    "sub_scores": { "brightness": 8, "sharpness": 7, "framing": 8, "background_clutter": 6, "camera_stability": 7, "color_temperature": 7, "face_visibility": 9 },
    "strengths": [],
    "improvements": []
  },
  "audio_quality": {
    "score": 7,
    "sub_scores": { "speech_clarity": 8, "loudness_level": 7, "background_noise": 7, "silence_gaps": 8, "music_vocal_balance": 6 },
    "strengths": [],
    "improvements": []
  },
  "content_structure": {
    "score": 6,
    "sub_scores": { "problem_solution_clarity": 6, "storytelling_arc": 7, "cta_presence": 5, "value_density": 7, "emotional_intensity": 6, "specificity": 6, "jargon_level": 8 },
    "strengths": [],
    "improvements": []
  },
  "editing": {
    "score": 7,
    "sub_scores": { "cut_rhythm": 7, "visual_variety": 6, "zoom_punch_in_usage": 5, "transition_smoothness": 8, "repetitive_frames": 7, "thumbnail_worthy_moment": 8 },
    "strengths": [],
    "improvements": []
  },
  "text_subtitles": {
    "score": 6,
    "sub_scores": { "subtitle_presence": 5, "readability": 7, "safe_zone_placement": 6, "text_contrast": 7, "font_size": 6 },
    "strengths": [],
    "improvements": []
  },
  "compliance": {
    "score": 9,
    "flags": [],
    "warnings": [],
    "is_brand_safe": true
  },
  "overall_summary": "A highly analytical 2-3 sentence assessment of this video's viral potential based on advanced psychology and algorithm dynamics.",
  "predicted_performance": "below_average | average | above_average | viral_potential",
  "top_3_wins": ["Win 1", "Win 2", "Win 3"],
  "top_3_fixes": ["Fix 1", "Fix 2", "Fix 3"]
}`;
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
