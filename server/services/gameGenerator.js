// server/services/gameGenerator.js
// Calls the Claude API to generate a {quiz, sort, match} game kit for a topic.
// Used by the teacher "assign topic" route. Same prompt/parsing approach as
// the original standalone prototype, just packaged as a reusable function.

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

function buildPrompt(topic) {
  return `You are creating educational mini-games for 4th grade students (age 9-10) about this science topic: "${topic}".

Generate content for exactly 3 games. Respond with ONLY valid JSON, no preamble, no markdown code fences, no explanation. The JSON must match this exact structure:

{
  "topic": "string - a clean display title for the topic",
  "quiz": {
    "title": "string - fun title for the quiz game",
    "questions": [
      {
        "question": "string",
        "options": ["string", "string", "string", "string"],
        "correctIndex": 0,
        "explanation": "string - one simple sentence explaining the answer, kid-friendly"
      }
    ]
  },
  "sort": {
    "title": "string - fun title for the sorting game",
    "categories": [
      { "id": "string-no-spaces", "label": "string", "emoji": "single emoji" }
    ],
    "items": [
      { "text": "string - a fact or example", "emoji": "single emoji", "categoryId": "must match a category id above" }
    ]
  },
  "match": {
    "title": "string - fun title for the matching game",
    "pairs": [
      { "term": "string - short word or phrase", "definition": "string - simple kid-friendly definition" }
    ]
  }
}

Requirements:
- quiz: exactly 5 questions, each with exactly 4 options
- sort: exactly 3-4 categories, and 8-10 items total spread across them
- match: exactly 6 term/definition pairs
- Language must be simple, concrete, and appropriate for 9-10 year olds
- Be scientifically accurate
- Make it engaging and age-appropriate, not dry or textbook-like
- Output ONLY the JSON object, nothing else`;
}

// Basic shape validation so a malformed model response fails loudly and
// clearly, rather than corrupting the database or breaking the frontend
// renderer later with a confusing error far from the actual cause.
function validateGameKitShape(data) {
  if (!data || typeof data !== 'object') throw new Error('Not an object');
  if (!data.quiz || !Array.isArray(data.quiz.questions) || data.quiz.questions.length === 0) {
    throw new Error('Missing or empty quiz.questions');
  }
  if (!data.sort || !Array.isArray(data.sort.categories) || !Array.isArray(data.sort.items)) {
    throw new Error('Missing sort.categories or sort.items');
  }
  if (!data.match || !Array.isArray(data.match.pairs) || data.match.pairs.length === 0) {
    throw new Error('Missing or empty match.pairs');
  }
  for (const q of data.quiz.questions) {
    if (!Array.isArray(q.options) || typeof q.correctIndex !== 'number') {
      throw new Error('Malformed quiz question');
    }
  }
  for (const item of data.sort.items) {
    const validCategory = data.sort.categories.some(c => c.id === item.categoryId);
    if (!validCategory) throw new Error(`Sort item references unknown category: ${item.categoryId}`);
  }
}

async function generateGameKit(topic) {
  if (!ANTHROPIC_API_KEY) {
    const err = new Error('ANTHROPIC_API_KEY not configured');
    err.userFacing = 'The server is not configured with an API key yet.';
    throw err;
  }

  let response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        messages: [{ role: 'user', content: buildPrompt(topic) }],
      }),
    });
  } catch (networkErr) {
    const err = new Error('Network error calling Anthropic API: ' + networkErr.message);
    err.userFacing = 'Could not reach the AI service. Please try again.';
    throw err;
  }

  if (!response.ok) {
    const errText = await response.text();
    const err = new Error(`Anthropic API returned ${response.status}: ${errText}`);
    err.userFacing = 'The AI service had a problem generating this topic. Please try again.';
    throw err;
  }

  const data = await response.json();
  const textBlock = data.content?.find(block => block.type === 'text');

  if (!textBlock) {
    const err = new Error('No text block in Anthropic response');
    err.userFacing = 'No content was returned. Please try again.';
    throw err;
  }

  // Defensive: strip stray markdown fences even though the prompt asks for none
  const cleaned = textBlock.text.replace(/^```json\s*|^```\s*|```\s*$/gm, '').trim();

  let gameData;
  try {
    gameData = JSON.parse(cleaned);
  } catch (parseErr) {
    const err = new Error('Failed to parse model output as JSON: ' + cleaned.slice(0, 300));
    err.userFacing = 'Got an unexpected response shape. Please try again.';
    throw err;
  }

  try {
    validateGameKitShape(gameData);
  } catch (shapeErr) {
    const err = new Error('Generated game kit failed shape validation: ' + shapeErr.message);
    err.userFacing = 'The generated games were incomplete. Please try again.';
    throw err;
  }

  return gameData;
}

module.exports = { generateGameKit };
