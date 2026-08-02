// services/ai/conversationManager.js
const { db } = require('../../db/init');

class ConversationManager {
  async createConversation(userId, title = 'New chat') {
    const result = await db.execute({
      sql: 'INSERT INTO conversations (user_id, title) VALUES (?, ?)',
      args: [userId, title],
    });
    return { id: Number(result.lastInsertRowid), title };
  }

  async getConversations(userId, search = null) {
    let sql = `SELECT id, title, pinned, created_at, updated_at FROM conversations
               WHERE user_id = ?`;
    const args = [userId];

    if (search) {
      sql += ` AND (title LIKE ? OR id IN (
        SELECT conversation_id FROM messages WHERE content LIKE ?
      ))`;
      args.push(`%${search}%`, `%${search}%`);
    }

    sql += ` ORDER BY pinned DESC, updated_at DESC`;

    const result = await db.execute({ sql, args });
    return result.rows;
  }

  async getConversation(userId, conversationId) {
    const result = await db.execute({
      sql: 'SELECT * FROM conversations WHERE id = ? AND user_id = ?',
      args: [conversationId, userId],
    });
    return result.rows[0] || null;
  }

  async updateConversation(userId, conversationId, updates) {
    const allowed = ['title', 'pinned'];
    const sets = [];
    const args = [];

    for (const key of allowed) {
      if (updates[key] !== undefined) {
        sets.push(`${key} = ?`);
        args.push(updates[key]);
      }
    }

    if (sets.length === 0) return false;

    args.push(conversationId, userId);
    await db.execute({
      sql: `UPDATE conversations SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
      args,
    });
    return true;
  }

  async deleteConversation(userId, conversationId) {
    await db.execute({
      sql: 'DELETE FROM conversations WHERE id = ? AND user_id = ?',
      args: [conversationId, userId],
    });
    return true;
  }

  async getMessages(userId, conversationId, limit = 100, offset = 0) {
    const owns = await this.getConversation(userId, conversationId);
    if (!owns) throw new Error('Conversation not found');

    const result = await db.execute({
      sql: `SELECT id, role, content, model, tokens_used, created_at FROM messages
            WHERE conversation_id = ? ORDER BY id ASC LIMIT ? OFFSET ?`,
      args: [conversationId, limit, offset],
    });
    return result.rows;
  }

  async addMessage(userId, conversationId, role, content, model = null, tokensUsed = 0) {
    const owns = await this.getConversation(userId, conversationId);
    if (!owns) throw new Error('Conversation not found');

    const result = await db.execute({
      sql: 'INSERT INTO messages (conversation_id, role, content, model, tokens_used) VALUES (?, ?, ?, ?, ?)',
      args: [conversationId, role, content, model, tokensUsed],
    });

    await db.execute({
      sql: "UPDATE conversations SET updated_at = datetime('now') WHERE id = ?",
      args: [conversationId],
    });

    return { id: Number(result.lastInsertRowid) };
  }

  async updateMessage(userId, conversationId, messageId, content) {
    const owns = await this.getConversation(userId, conversationId);
    if (!owns) throw new Error('Conversation not found');

    await db.execute({
      sql: 'UPDATE messages SET content = ? WHERE id = ? AND conversation_id = ?',
      args: [content, messageId, conversationId],
    });
    return true;
  }

  async deleteMessage(userId, conversationId, messageId) {
    const owns = await this.getConversation(userId, conversationId);
    if (!owns) throw new Error('Conversation not found');

    await db.execute({
      sql: 'DELETE FROM messages WHERE id = ? AND conversation_id = ?',
      args: [messageId, conversationId],
    });
    return true;
  }

  async generateTitle(userId, conversationId, firstMessage) {
    const title = firstMessage.slice(0, 60) + (firstMessage.length > 60 ? '...' : '');
    await this.updateConversation(userId, conversationId, { title });
    return title;
  }

  async exportConversation(userId, conversationId, format = 'json') {
    const conv = await this.getConversation(userId, conversationId);
    if (!conv) throw new Error('Conversation not found');

    const messages = await this.getMessages(userId, conversationId, 10000);

    if (format === 'json') {
      return JSON.stringify({
        title: conv.title,
        created_at: conv.created_at,
        updated_at: conv.updated_at,
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
          created_at: m.created_at,
        })),
      }, null, 2);
    }

    if (format === 'markdown') {
      let md = `# ${conv.title}\n\n`;
      md += `*Exported on ${new Date().toISOString()}*\n\n`;
      for (const m of messages) {
        const label = m.role === 'user' ? '**You**' : '**Spider AI**';
        md += `${label}\n${m.content}\n\n---\n\n`;
      }
      return md;
    }

    throw new Error('Unsupported export format');
  }
}

module.exports = new ConversationManager();
