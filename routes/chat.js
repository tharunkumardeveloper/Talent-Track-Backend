/**
 * Groq chat proxy.
 *
 * The app used to call Groq directly with a key the user pasted into Settings.
 * Making that "global" by baking a key into the client would put it in the APK,
 * where anyone can unzip and read it - Vite inlines VITE_* vars into the bundle.
 *
 * So the key lives here instead, in a Render environment variable. The app calls
 * this route, users configure nothing, and the key never ships.
 */

const express = require('express');
const router = express.Router();

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

/**
 * Chosen by measurement, not preference: fast (~800ms), and it answers in plain
 * prose. The obvious alternatives were rejected - qwen3.6 leaks <think> blocks
 * into the reply and gpt-oss-20b returns empty content for short prompts.
 */
const MODEL = process.env.GROQ_MODEL || 'groq/compound-mini';

/** Requests per window, per IP. Enough for real use, not enough to farm. */
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60 * 1000;

/** ip -> { count, resetAt }. In-memory: single instance, and it resets on deploy. */
const buckets = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const bucket = buckets.get(ip);

  if (!bucket || now > bucket.resetAt) {
    buckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  bucket.count++;
  return bucket.count > RATE_LIMIT;
}

// Stop the map growing without bound on a long-lived instance.
setInterval(() => {
  const now = Date.now();
  for (const [ip, b] of buckets) if (now > b.resetAt) buckets.delete(ip);
}, 5 * 60 * 1000).unref?.();

router.post('/chat', async (req, res) => {
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    // Explicit, so a missing env var is not mistaken for a model failure.
    return res.status(503).json({
      success: false,
      error: 'Chat is not configured on this server',
      code: 'no_api_key',
    });
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
  if (rateLimited(ip)) {
    return res.status(429).json({ success: false, error: 'Too many messages. Wait a moment.' });
  }

  const { message, history = [], systemPrompt } = req.body || {};
  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ success: false, error: 'message is required' });
  }

  try {
    const messages = [
      { role: 'system', content: systemPrompt || 'You are a friendly fitness coach. Answer in one or two short sentences.' },
      // Only recent turns: long histories cost latency for little benefit, and
      // cap the payload a client can push through this proxy.
      ...history.slice(-6).map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: String(m.content || '').slice(0, 2000),
      })),
      { role: 'user', content: message.slice(0, 2000) },
    ];

    const upstream = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, messages, max_tokens: 300, temperature: 0.7 }),
      signal: AbortSignal.timeout(20000),
    });

    if (!upstream.ok) {
      const detail = (await upstream.text()).slice(0, 200);
      console.warn('Groq upstream error:', upstream.status, detail);
      return res.status(502).json({ success: false, error: 'The coach is unavailable right now' });
    }

    const json = await upstream.json();
    const reply = json?.choices?.[0]?.message?.content?.trim();
    if (!reply) {
      return res.status(502).json({ success: false, error: 'Empty response from the model' });
    }

    res.json({ success: true, message: reply });
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    console.error('Chat proxy error:', err?.message);
    res.status(timedOut ? 504 : 500).json({
      success: false,
      error: timedOut ? 'The coach took too long to answer' : 'Chat failed',
    });
  }
});

module.exports = router;
