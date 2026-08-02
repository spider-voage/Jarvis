// routes/v1/chat.js
const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { chatLimiter } = require('../../middleware/rateLimit');
const { auditLog } = require('../../middleware/security');
const aiService = require('../../services/ai');
const conversationManager = require('../../services/ai/conversationManager');
const subscriptionService = require('../../services/subscription');

const router = express.Router();
router.use(requireAuth);
router.use(chatLimiter);

// GET /api/v1/chat/conversations
router.get('/conversations', async (req, res) => {
  try {
    const search = req.query.search || null;
    const conversations = await conversationManager.getConversations(req.userId, search);
    res.json({ conversations });
  } catch (err) {
    console.error('[chat/conversations]', err);
    res.status(500).json({ error: 'Failed to load conversations' });
  }
});

// POST /api/v1/chat/conversations
router.post('/conversations', async (req, res) => {
  try {
    const title = (req.body && req.body.title) || 'New chat';
    const conv = await conversationManager.createConversation(req.userId, title);
    res.status(201).json(conv);
  } catch (err) {
    console.error('[chat/create-conversation]', err);
    res.status(500).json({ error: 'Failed to create conversation' });
  }
});

// GET /api/v1/chat/conversations/:id
router.get('/conversations/:id', async (req, res) => {
  try {
    const conv = await conversationManager.getConversation(req.userId, req.params.id);
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
    res.json(conv);
  } catch (err) {
    console.error('[chat/get-conversation]', err);
    res.status(500).json({ error: 'Failed to load conversation' });
  }
});

// PATCH /api/v1/chat/conversations/:id
router.patch('/conversations/:id', async (req, res) => {
  try {
    const updates = {};
    if (req.body.title !== undefined) updates.title = req.body.title;
    if (req.body.pinned !== undefined) updates.pinned = req.body.pinned ? 1 : 0;

    const ok = await conversationManager.updateConversation(req.userId, req.params.id, updates);
    if (!ok) return res.status(404).json({ error: 'Conversation not found' });
    res.json({ updated: true });
  } catch (err) {
    console.error('[chat/update-conversation]', err);
    res.status(500).json({ error: 'Failed to update conversation' });
  }
});

// DELETE /api/v1/chat/conversations/:id
router.delete('/conversations/:id', auditLog('chat.delete_conversation'), async (req, res) => {
  try {
    await conversationManager.deleteConversation(req.userId, req.params.id);
    res.json({ deleted: true });
  } catch (err) {
    console.error('[chat/delete-conversation]', err);
    res.status(500).json({ error: 'Failed to delete conversation' });
  }
});

// GET /api/v1/chat/conversations/:id/messages
router.get('/conversations/:id/messages', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;
    const messages = await conversationManager.getMessages(req.userId, req.params.id, limit, offset);
    res.json({ messages });
  } catch (err) {
    console.error('[chat/messages]', err);
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

// POST /api/v1/chat/conversations/:id/messages
router.post('/conversations/:id/messages', auditLog('chat.send_message'), async (req, res) => {
  try {
    const { content, stream = false, regenerate = false, editMessageId = null } = req.body || {};
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'content is required' });
    }

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      try {
        const generator = aiService.streamResponse(req.userId, req.params.id, content, { regenerate, editMessageId });
        for await (const chunk of generator) {
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }
      } catch (err) {
        res.write(`data: ${JSON.stringify({ error: err.message, done: true })}\n\n`);
      }
      res.end();
      return;
    }

    const result = await aiService.sendMessage(req.userId, req.params.id, content, { regenerate, editMessageId });
    res.json(result);
  } catch (err) {
    console.error('[chat/send]', err);
    res.status(500).json({ error: err.message || 'Failed to get a reply' });
  }
});

// PUT /api/v1/chat/conversations/:id/messages/:msgId
router.put('/conversations/:id/messages/:msgId', auditLog('chat.edit_message'), async (req, res) => {
  try {
    const { content } = req.body || {};
    if (!content) return res.status(400).json({ error: 'content is required' });

    await conversationManager.updateMessage(req.userId, req.params.id, req.params.msgId, content);
    res.json({ updated: true });
  } catch (err) {
    console.error('[chat/edit-message]', err);
    res.status(500).json({ error: 'Failed to edit message' });
  }
});

// DELETE /api/v1/chat/conversations/:id/messages/:msgId
router.delete('/conversations/:id/messages/:msgId', auditLog('chat.delete_message'), async (req, res) => {
  try {
    await conversationManager.deleteMessage(req.userId, req.params.id, req.params.msgId);
    res.json({ deleted: true });
  } catch (err) {
    console.error('[chat/delete-message]', err);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

// POST /api/v1/chat/conversations/:id/regenerate
router.post('/conversations/:id/regenerate', auditLog('chat.regenerate'), async (req, res) => {
  try {
    const { messageId } = req.body || {};
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      try {
        const generator = aiService.streamResponse(req.userId, req.params.id, '', { regenerate: true });
        for await (const chunk of generator) {
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }
      } catch (err) {
        res.write(`data: ${JSON.stringify({ error: err.message, done: true })}\n\n`);
      }
      res.end();
      return;
    }

    const result = await aiService.sendMessage(req.userId, req.params.id, '', { regenerate: true });
    res.json(result);
  } catch (err) {
    console.error('[chat/regenerate]', err);
    res.status(500).json({ error: err.message || 'Failed to regenerate' });
  }
});

// GET /api/v1/chat/conversations/:id/export
router.get('/conversations/:id/export', async (req, res) => {
  try {
    const format = req.query.format || 'json';
    const data = await conversationManager.exportConversation(req.userId, req.params.id, format);

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="conversation-${req.params.id}.json"`);
    } else if (format === 'markdown') {
      res.setHeader('Content-Type', 'text/markdown');
      res.setHeader('Content-Disposition', `attachment; filename="conversation-${req.params.id}.md"`);
    }

    res.send(data);
  } catch (err) {
    console.error('[chat/export]', err);
    res.status(500).json({ error: 'Failed to export conversation' });
  }
});

module.exports = router;
