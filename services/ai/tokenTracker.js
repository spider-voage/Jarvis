// services/ai/tokenTracker.js
const { db } = require('../../db/init');

// Rough token estimation: ~4 chars per token
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

class TokenTracker {
  async trackUsage({ userId, conversationId, messageId, model, inputText, outputText, latencyMs }) {
    const tokensInput = estimateTokens(inputText);
    const tokensOutput = estimateTokens(outputText);
    const totalTokens = tokensInput + tokensOutput;

    // Rough cost estimation (cents per 1K tokens)
    const pricing = {
      'openai/gpt-4o': { input: 0.5, output: 1.5 },
      'openai/gpt-4o-mini': { input: 0.015, output: 0.06 },
      'anthropic/claude-3.5-sonnet': { input: 0.3, output: 1.5 },
      'anthropic/claude-3-haiku': { input: 0.025, output: 0.125 },
      'google/gemini-pro': { input: 0.05, output: 0.2 },
      'meta-llama/llama-3.1-70b': { input: 0.04, output: 0.08 },
    };

    const rate = pricing[model] || pricing['openai/gpt-4o-mini'];
    const costCents = Math.round(
      (tokensInput / 1000) * rate.input +
      (tokensOutput / 1000) * rate.output
    );

    await db.execute({
      sql: `INSERT INTO ai_usage (user_id, conversation_id, message_id, model, tokens_input, tokens_output, cost_cents, latency_ms)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [userId, conversationId, messageId, model, tokensInput, tokensOutput, costCents, latencyMs],
    });

    // Update daily usage stats
    const today = new Date().toISOString().split('T')[0];
    await db.execute({
      sql: `INSERT INTO usage_stats (user_id, date, messages_received, tokens_input, tokens_output, api_calls)
            VALUES (?, ?, 1, ?, ?, 1)
            ON CONFLICT(user_id, date)
            DO UPDATE SET
              messages_received = messages_received + 1,
              tokens_input = tokens_input + excluded.tokens_input,
              tokens_output = tokens_output + excluded.tokens_output,
              api_calls = api_calls + 1`,
      args: [userId, today, tokensInput, tokensOutput],
    });

    return { tokensInput, tokensOutput, costCents };
  }

  async getDailyUsage(userId, date = null) {
    const targetDate = date || new Date().toISOString().split('T')[0];
    const result = await db.execute({
      sql: 'SELECT * FROM usage_stats WHERE user_id = ? AND date = ?',
      args: [userId, targetDate],
    });
    return result.rows[0] || { messages_sent: 0, messages_received: 0, tokens_input: 0, tokens_output: 0, voice_minutes_used: 0 };
  }

  async getUsageHistory(userId, days = 30) {
    const result = await db.execute({
      sql: `SELECT * FROM usage_stats WHERE user_id = ? AND date >= date('now', '-${days} days') ORDER BY date DESC`,
      args: [userId],
    });
    return result.rows;
  }
}

module.exports = new TokenTracker();
