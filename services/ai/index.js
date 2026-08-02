// services/ai/index.js
const { db } = require('../../db/init');
const conversationManager = require('./conversationManager');
const memoryManager = require('./memoryManager');
const promptManager = require('./promptManager');
const tokenTracker = require('./tokenTracker');

const DEFAULT_MODEL = process.env.AI_MODEL || 'openai/gpt-4o-mini';
const PRO_MODEL = process.env.AI_PRO_MODEL || 'openai/gpt-4o';
const MAX_TOKENS = parseInt(process.env.AI_MAX_TOKENS || '4096', 10);
const TEMPERATURE = parseFloat(process.env.AI_TEMPERATURE || '0.7');
const API_KEY = process.env.OPENROUTER_API_KEY;

class AIService {
  constructor() {
    this.requestQueue = new Map(); // userId -> Promise chain
    this.retryCount = 3;
    this.retryDelay = 1000;
  }

  async getModelForUser(userId) {
    const sub = await db.execute({
      sql: `SELECT p.advanced_models FROM subscriptions s
            JOIN subscription_plans p ON s.plan_id = p.id
            WHERE s.user_id = ? AND s.status = 'active'`,
      args: [userId],
    });
    const hasPro = sub.rows[0]?.advanced_models === 1;
    return hasPro ? PRO_MODEL : DEFAULT_MODEL;
  }

  async checkMessageLimit(userId) {
    const today = new Date().toISOString().split('T')[0];
    const result = await db.execute({
      sql: `SELECT p.daily_message_limit, COALESCE(u.messages_sent, 0) as used
            FROM users usr
            LEFT JOIN subscriptions s ON s.user_id = usr.id AND s.status = 'active'
            LEFT JOIN subscription_plans p ON COALESCE(s.plan_id, 1) = p.id
            LEFT JOIN usage_stats u ON u.user_id = usr.id AND u.date = ?
            WHERE usr.id = ?`,
      args: [today, userId],
    });

    const row = result.rows[0];
    if (!row) return { allowed: false, limit: 0, used: 0 };
    const limit = row.daily_message_limit || 50;
    const used = row.used || 0;
    return { allowed: used < limit, limit, used, remaining: Math.max(0, limit - used) };
  }

  async sendMessage(userId, conversationId, content, options = {}) {
    const { stream = false, regenerate = false, editMessageId = null } = options;

    // Check rate limit
    const limitCheck = await this.checkMessageLimit(userId);
    if (!limitCheck.allowed) {
      throw new Error(`Daily message limit reached (${limitCheck.limit}/${limitCheck.limit}). Upgrade to Pro for unlimited messages.`);
    }

    // Queue requests per user to prevent race conditions
    const queueKey = `${userId}`;
    const current = this.requestQueue.get(queueKey) || Promise.resolve();
    const next = current.then(async () => {
      return this._processMessage(userId, conversationId, content, { stream, regenerate, editMessageId });
    }).finally(() => {
      if (this.requestQueue.get(queueKey) === next) {
        this.requestQueue.delete(queueKey);
      }
    });
    this.requestQueue.set(queueKey, next);
    return next;
  }

  async _processMessage(userId, conversationId, content, options) {
    const { stream, regenerate, editMessageId } = options;
    const model = await this.getModelForUser(userId);

    // Get or create conversation
    let conv = await conversationManager.getConversation(userId, conversationId);
    if (!conv) {
      const created = await conversationManager.createConversation(userId);
      conversationId = created.id;
      conv = await conversationManager.getConversation(userId, conversationId);
    }

    // Save user message (or update if editing)
    let userMessageId;
    if (editMessageId) {
      await conversationManager.updateMessage(userId, conversationId, editMessageId, content);
      // Delete all messages after the edited one
      await db.execute({
        sql: 'DELETE FROM messages WHERE conversation_id = ? AND id > ?',
        args: [conversationId, editMessageId],
      });
      userMessageId = editMessageId;
    } else if (!regenerate) {
      const msg = await conversationManager.addMessage(userId, conversationId, 'user', content);
      userMessageId = msg.id;

      // Auto-generate title on first message
      const msgCount = await db.execute({
        sql: 'SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?',
        args: [conversationId],
      });
      if (msgCount.rows[0].count <= 2 && conv.title === 'New chat') {
        await conversationManager.generateTitle(userId, conversationId, content);
      }
    }

    // Build context
    const history = await conversationManager.getMessages(userId, conversationId, 100);
    const memoryContext = await memoryManager.buildMemoryContext(userId, 20);
    const systemPrompt = promptManager.getPrompt('default', memoryContext);

    // Compress if too long
    const maxContext = (await this._getPlanLimit(userId, 'max_context_messages')) || 30;
    let aiMessages = promptManager.buildMessages(systemPrompt, history, null, maxContext);
    aiMessages = promptManager.compressContext(aiMessages, maxContext);

    if (stream) {
      return { stream: true, conversationId, model };
    }

    // Non-streaming
    const startTime = Date.now();
    const reply = await this._callAIWithRetry(aiMessages, model);
    const latencyMs = Date.now() - startTime;

    const assistantMsg = await conversationManager.addMessage(userId, conversationId, 'assistant', reply, model);

    // Track usage
    const inputText = aiMessages.map(m => m.content).join('\n');
    await tokenTracker.trackUsage({
      userId, conversationId, messageId: assistantMsg.id,
      model, inputText, outputText: reply, latencyMs,
    });

    // Update sent message count
    const today = new Date().toISOString().split('T')[0];
    await db.execute({
      sql: `INSERT INTO usage_stats (user_id, date, messages_sent) VALUES (?, ?, 1)
            ON CONFLICT(user_id, date) DO UPDATE SET messages_sent = messages_sent + 1`,
      args: [userId, today],
    });

    return { reply, conversationId, messageId: assistantMsg.id, model };
  }

  async *streamResponse(userId, conversationId, content, options = {}) {
    const { regenerate = false, editMessageId = null } = options;
    const model = await this.getModelForUser(userId);

    let conv = await conversationManager.getConversation(userId, conversationId);
    if (!conv) {
      const created = await conversationManager.createConversation(userId);
      conversationId = created.id;
      conv = await conversationManager.getConversation(userId, conversationId);
    }

    // Save user message
    if (!regenerate && !editMessageId) {
      await conversationManager.addMessage(userId, conversationId, 'user', content);
    }

    const history = await conversationManager.getMessages(userId, conversationId, 100);
    const memoryContext = await memoryManager.buildMemoryContext(userId, 20);
    const systemPrompt = promptManager.getPrompt('default', memoryContext);

    const maxContext = (await this._getPlanLimit(userId, 'max_context_messages')) || 30;
    let aiMessages = promptManager.buildMessages(systemPrompt, history, null, maxContext);
    aiMessages = promptManager.compressContext(aiMessages, maxContext);

    const startTime = Date.now();
    let fullReply = '';
    let error = null;

    try {
      const stream = await this._callAIStream(aiMessages, model);
      for await (const chunk of stream) {
        fullReply += chunk;
        yield { chunk, done: false };
      }
      yield { chunk: '', done: true };
    } catch (err) {
      error = err;
      yield { error: err.message, done: true };
    }

    const latencyMs = Date.now() - startTime;

    if (fullReply.trim()) {
      const assistantMsg = await conversationManager.addMessage(userId, conversationId, 'assistant', fullReply, model);
      const inputText = aiMessages.map(m => m.content).join('\n');
      await tokenTracker.trackUsage({
        userId, conversationId, messageId: assistantMsg.id,
        model, inputText, outputText: fullReply, latencyMs,
      });
    }

    // Update sent count
    const today = new Date().toISOString().split('T')[0];
    await db.execute({
      sql: `INSERT INTO usage_stats (user_id, date, messages_sent) VALUES (?, ?, 1)
            ON CONFLICT(user_id, date) DO UPDATE SET messages_sent = messages_sent + 1`,
      args: [userId, today],
    });

    if (error) throw error;
  }

  async _getPlanLimit(userId, field) {
    const result = await db.execute({
      sql: `SELECT p.${field} FROM subscriptions s
            JOIN subscription_plans p ON s.plan_id = p.id
            WHERE s.user_id = ? AND s.status = 'active'`,
      args: [userId],
    });
    return result.rows[0]?.[field];
  }

  async _callAIWithRetry(messages, model, attempt = 1) {
    try {
      return await this._callAI(messages, model);
    } catch (err) {
      if (attempt < this.retryCount && this._isRetryable(err)) {
        await this._delay(this.retryDelay * attempt);
        return this._callAIWithRetry(messages, model, attempt + 1);
      }
      throw err;
    }
  }

  _isRetryable(err) {
    const retryable = ['ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN'];
    return retryable.includes(err.code) || (err.status >= 500 && err.status < 600);
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async _callAI(messages) {
    if (!API_KEY) throw new Error('OPENROUTER_API_KEY is not configured');

    const model = messages._model || DEFAULT_MODEL;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
        'HTTP-Referer': process.env.APP_URL || 'https://spider-ai.app',
        'X-Title': 'Spider AI',
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      const err = new Error(`AI request failed (${response.status}): ${text}`);
      err.status = response.status;
      throw err;
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '(no response)';
  }

  async *_callAIStream(messages) {
    if (!API_KEY) throw new Error('OPENROUTER_API_KEY is not configured');

    const model = messages._model || DEFAULT_MODEL;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
        'HTTP-Referer': process.env.APP_URL || 'https://spider-ai.app',
        'X-Title': 'Spider AI',
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        stream: true,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      const err = new Error(`AI stream failed (${response.status}): ${text}`);
      err.status = response.status;
      throw err;
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
}

module.exports = new AIService();
