const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ─── Flesch Reading Ease (no API needed) ─────────────────────────────────────
function fleschReadingEase(text) {
  if (!text) return 0;
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0).length || 1;
  const words = text.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return 0;
  const syllables = words.reduce((count, word) => {
    return count + Math.max(1, word.toLowerCase().replace(/[^a-z]/g, '').replace(/[aeiou]{2,}/g, 'a').split('').filter(c => 'aeiou'.includes(c)).length);
  }, 0);
  const score = 206.835 - 1.015 * (words.length / sentences) - 84.6 * (syllables / words.length);
  return Math.round(Math.max(0, Math.min(100, score)));
}

// ─── Overbroad hashtag detection ─────────────────────────────────────────────
const OVERBROAD_HASHTAGS = new Set([
  'love', 'instagood', 'photooftheday', 'beautiful', 'happy', 'cute', 'tbt',
  'like4like', 'followme', 'picoftheday', 'follow', 'me', 'selfie', 'summer',
  'art', 'instadaily', 'friends', 'repost', 'nature', 'girl', 'fun', 'style',
  'smile', 'food', 'instalike', 'likeforlike', 'family', 'photo', 'life', 'beauty'
]);

// ─── Analyse caption & hashtags with Gemini text ─────────────────────────────
async function analyseText({ caption, hashtags, niche }) {
  console.log('📝 Starting text analysis...');

  const captionWords = caption ? caption.split(/\s+/).length : 0;
  const hashtagList = hashtags ? hashtags.match(/#\w+/g) || [] : [];
  const overbroadTags = hashtagList.filter(h => OVERBROAD_HASHTAGS.has(h.replace('#', '').toLowerCase()));
  const fleschScore = fleschReadingEase(caption);
  const emojiCount = (caption?.match(/\p{Emoji}/gu) || []).length;
  const hasCTA = /\b(comment|share|save|follow|link in bio|click|dm|check|tag|tell me|what do you|let me know|drop a)\b/i.test(caption || '');
  const hasQuestion = /\?/.test(caption || '');

  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  const prompt = `You are an Instagram content strategist. Analyse this caption and hashtags for an Instagram Reel in the "${niche}" niche.

CAPTION:
"${caption || '(empty)'}"

HASHTAGS:
"${hashtags || '(empty)'}"

COMPUTED METRICS:
- Word count: ${captionWords}
- Emoji count: ${emojiCount}
- Has CTA: ${hasCTA}
- Has question (comment bait): ${hasQuestion}
- Flesch readability score: ${fleschScore}/100 (higher = easier to read)
- Overbroad hashtags detected: ${overbroadTags.join(', ') || 'none'}
- Total hashtags: ${hashtagList.length}

Return ONLY valid JSON in this exact structure:
{
  "caption": {
    "score": 7,
    "sub_scores": {
      "hook_strength": 7,
      "cta_quality": 6,
      "readability": 8,
      "length_appropriateness": 7,
      "emoji_balance": 6,
      "comment_bait": 5,
      "keyword_coverage": 6
    },
    "strengths": ["specific strength"],
    "improvements": ["specific actionable tip"]
  },
  "hashtags": {
    "score": 6,
    "sub_scores": {
      "niche_relevance": 7,
      "competition_mix": 5,
      "count_appropriateness": 8,
      "overbroad_risk": 6
    },
    "overbroad_tags": ${JSON.stringify(overbroadTags.map(h => h.replace('#', '')))},
    "suggested_replacements": ["better hashtag 1", "better hashtag 2"],
    "strengths": [],
    "improvements": []
  }
}`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in text response');
    const parsed = JSON.parse(jsonMatch[0]);
    console.log('✅ Text analysis complete');
    return parsed;
  } catch (err) {
    console.warn('Text analysis failed, returning defaults:', err.message);
    return {
      caption: { score: null, improvements: ['Could not analyse caption'], strengths: [] },
      hashtags: { score: null, improvements: ['Could not analyse hashtags'], strengths: [], overbroad_tags: overbroadTags }
    };
  }
}

module.exports = { analyseText };
