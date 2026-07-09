const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { requireAuth } = require('../auth');

const router = express.Router();

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are the narrator of NETRUNNER, a gritty cyberpunk hacker RPG set in a neon-drenched dystopia.
Write in second person, present tense. Use hacker/cyberpunk slang naturally.
Keep responses to 2-3 sentences max. Be vivid, terse, cinematic.
No markdown, no asterisks. Plain text only.`;

// POST /api/narrate
router.post('/', requireAuth, async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt required' });

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = message.content?.[0]?.text || '// Signal lost.';
    res.json({ text });
  } catch (err) {
    console.error('[Narrate]', err.message);
    res.status(500).json({ text: '// ERROR: Neural uplink unstable.' });
  }
});

module.exports = router;
