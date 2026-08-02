// routes/chat.js
const express = require('express');
const { db } = require('../db/init');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const MODEL = process.env.AI_MODEL || 'openai/gpt-4o-mini';
const MAX_TOKENS = parseInt(process.env.AI_MAX_TOKENS || '2048', 10);
const TEMPERATURE = parseFloat(process.env.AI_TEMPERATURE || '0.7');

router.get('/conversations', async (req, res) => {
  try {
    const result = await db.execute({
      sql: `SELECT id, title, created_at, updated_at FROM conversations
            WHERE user_id = ? ORDER BY updated_at DESC`,
      args: [req.userId],
    });
    res.json({ conversations: result.rows });
  } catch (err) {
    console.error('[chat/conversations]', err);
    res.status(500).json({ error: 'Failed to load conversations' });
  }
});

router.post('/conversations', async (req, res) => {
  try {
    const title = (req.body && req.body.title) || 'New chat';
    const result = await db.execute({
      sql: 'INSERT INTO conversations (user_id, title) VALUES (?, ?)',
      args: [req.userId, title],
    });
    res.status(201).json({ id: Number(result.lastInsertRowid), title });
  } catch (err) {
    console.error('[chat/create-conversation]', err);
    res.status(500).json({ error: 'Failed to create conversation' });
  }
});

router.delete('/conversations/:id', async (req, res) => {
  try {
    const owns = await ownsConversation(req.userId, req.params.id);
    if (!owns) return res.status(404).json({ error: 'Conversation not found' });
    await db.execute({
      sql: 'DELETE FROM conversations WHERE id = ?',
      args: [req.params.id],
    });
    res.json({ deleted: true });
  } catch (err) {
    console.error('[chat/delete-conversation]', err);
    res.status(500).json({ error: 'Failed to delete conversation' });
  }
});

router.patch('/conversations/:id', async (req, res) => {
  try {
    const owns = await ownsConversation(req.userId, req.params.id);
    if (!owns) return res.status(404).json({ error: 'Conversation not found' });
    const { title } = req.body || {};
    if (!title) return res.status(400).json({ error: 'title is required' });
    await db.execute({
      sql: "UPDATE conversations SET title = ?, updated_at = datetime('now') WHERE id = ?",
      args: [title, req.params.id],
    });
    res.json({ updated: true });
  } catch (err) {
    console.error('[chat/rename-conversation]', err);
    res.status(500).json({ error: 'Failed to rename conversation' });
  }
});

router.get('/conversations/:id/messages', async (req, res) => {
  try {
    const owns = await ownsConversation(req.userId, req.params.id);
    if (!owns) return res.status(404).json({ error: 'Conversation not found' });

    const result = await db.execute({
      sql: `SELECT id, role, content, created_at FROM messages
            WHERE conversation_id = ? ORDER BY id ASC`,
      args: [req.params.id],
    });
    res.json({ messages: result.rows });
  } catch (err) {
    console.error('[chat/messages]', err);
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

router.delete('/conversations/:id/messages/:msgId', async (req, res) => {
  try {
    const owns = await ownsConversation(req.userId, req.params.id);
    if (!owns) return res.status(404).json({ error: 'Conversation not found' });
    await db.execute({
      sql: 'DELETE FROM messages WHERE id = ? AND conversation_id = ?',
      args: [req.params.msgId, req.params.id],
    });
    res.json({ deleted: true });
  } catch (err) {
    console.error('[chat/delete-message]', err);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

router.post('/conversations/:id/messages', async (req, res) => {
  try {
    const { content } = req.body || {};
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'content is required' });
    }

    const conversationId = req.params.id;
    const owns = await ownsConversation(req.userId, conversationId);
    if (!owns) return res.status(404).json({ error: 'Conversation not found' });

    await db.execute({
      sql: 'INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)',
      args: [conversationId, 'user', content],
    });

    const isStream = req.query.stream === 'true';

    const history = await db.execute({
      sql: `SELECT role, content FROM messages WHERE conversation_id = ?
            ORDER BY id DESC LIMIT 30`,
      args: [conversationId],
    });
    const orderedHistory = history.rows.reverse();

    const memoryResult = await db.execute({
      sql: 'SELECT key, value FROM memories WHERE user_id = ?',
      args: [req.userId],
    });

    const systemPrompt = buildSystemPrompt(memoryResult.rows);
    const aiMessages = [
      { role: 'system', content: systemPrompt },
      ...orderedHistory.map(m => ({ role: m.role, content: m.content })),
    ];

    if (isStream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      let fullReply = '';
      try {
        const stream = await callAIStream(aiMessages);
        for await (const chunk of stream) {
          fullReply += chunk;
          res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
        }
        res.write('data: [DONE]\n\n');
      } catch (err) {
        console.error('[chat/stream]', err);
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      } finally {
        if (fullReply.trim()) {
          await db.execute({
            sql: 'INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)',
            args: [conversationId, 'assistant', fullReply],
          });
          await db.execute({
            sql: "UPDATE conversations SET updated_at = datetime('now') WHERE id = ?",
            args: [conversationId],
          });
        }
        res.end();
      }
    } else {
      const reply = await callAI(aiMessages);
      await db.execute({
        sql: 'INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)',
        args: [conversationId, 'assistant', reply],
      });
      await db.execute({
        sql: "UPDATE conversations SET updated_at = datetime('now') WHERE id = ?",
        args: [conversationId],
      });
      res.json({ reply });
    }
  } catch (err) {
    console.error('[chat/send]', err);
    res.status(500).json({ error: err.message || 'Failed to get a reply' });
  }
});

async function ownsConversation(userId, conversationId) {
  const result = await db.execute({
    sql: 'SELECT id FROM conversations WHERE id = ? AND user_id = ?',
    args: [conversationId, userId],
  });
  return result.rows.length > 0;
}

function buildSystemPrompt(memories) {
  let prompt = [
    'You are Spider AI — a calm, confident, and highly capable personal assistant.',
    'Speak with quiet competence: composed, precise, and a little sophisticated,',
    'the way a top-tier assistant would sound. Never frantic, never overly casual.',
    '',
    'Style:',
    '- Be concise by default. Give the direct answer first, then brief supporting detail only if it earns its place.',
    '- Warm but professional — respectful, not stiff. Light dry wit is fine when it fits; never forced.',
    '- Prefer plain, confident statements over hedging ("I recommend..." rather than "maybe you could...").',
    '- Avoid filler openers like "Great question!" — just answer.',
    '- You are Spider AI, an original assistant with your own identity — not a copy of any fictional character.',
    '- When writing code, use markdown code blocks with the language specified.',
    '- Respond in the same language the user is writing in.',
  ].join('\n');

  if (memories.length > 0) {
    const facts = memories.map(m => `- ${m.key}: ${m.value}`).join('\n');
    prompt += `\n\nKnown facts about this user (use only when relevant):\n${facts}`;
  }
  return prompt;
}

async function callAI(messages) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not configured on the server');

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': process.env.APP_URL || 'https://spider-ai.app',
      'X-Title': 'Spider AI',
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AI request failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '(no response)';
}

async function* callAIStream(messages) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not configured');

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': process.env.APP_URL || 'https://spider-ai.app',
      'X-Title': 'Spider AI',
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      stream: true,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AI stream failed (${response.status}): ${text}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') return;
      try {
        const parsed = JSON.parse(data);
        const chunk = parsed.choices?.[0]?.delta?.content;
        if (chunk) yield chunk;
      } catch (e) {
        // ignore malformed JSON in stream
      }
    }
  }
}

module.exports = router;
