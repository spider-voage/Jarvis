// services/ai/memoryManager.js
const { db } = require('../../db/init');

class MemoryManager {
  async getMemories(userId) {
    const result = await db.execute({
      sql: 'SELECT id, key, value, updated_at FROM memories WHERE user_id = ? ORDER BY updated_at DESC',
      args: [userId],
    });
    return result.rows;
  }

  async getMemory(userId, key) {
    const result = await db.execute({
      sql: 'SELECT value FROM memories WHERE user_id = ? AND key = ?',
      args: [userId, key],
    });
    return result.rows[0]?.value || null;
  }

  async setMemory(userId, key, value) {
    await db.execute({
      sql: `INSERT INTO memories (user_id, key, value, updated_at)
            VALUES (?, ?, ?, datetime('now'))
            ON CONFLICT(user_id, key)
            DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      args: [userId, key, value],
    });
    return { key, value };
  }

  async deleteMemory(userId, key) {
    await db.execute({
      sql: 'DELETE FROM memories WHERE user_id = ? AND key = ?',
      args: [userId, key],
    });
    return true;
  }

  async buildMemoryContext(userId, maxMemories = 20) {
    const memories = await db.execute({
      sql: `SELECT key, value FROM memories WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?`,
      args: [userId, maxMemories],
    });

    if (memories.rows.length === 0) return '';

    const facts = memories.rows.map(m => `- ${m.key}: ${m.value}`).join('\n');
    return `Known facts about this user (use only when relevant):\n${facts}`;
  }

  async extractMemoriesFromConversation(userId, messages) {
    // Simple heuristic: look for explicit memory statements
    // In production, this could use an LLM call
    const memoryPatterns = [
      /my name is (\w+)/i,
      /i work as?(?: an?)? (.+)/i,
      /i live in (.+)/i,
      /my favorite (.+) is (.+)/i,
      /i prefer (.+)/i,
    ];

    const extracted = [];
    for (const msg of messages) {
      if (msg.role !== 'user') continue;
      for (const pattern of memoryPatterns) {
        const match = msg.content.match(pattern);
        if (match) {
          const key = match[0].split(' is ')[0].toLowerCase().trim();
          const value = match[match.length - 1].trim();
          if (key && value && key.length < 100 && value.length < 500) {
            extracted.push({ key, value });
          }
        }
      }
    }

    for (const mem of extracted) {
      await this.setMemory(userId, mem.key, mem.value);
    }

    return extracted;
  }
}

module.exports = new MemoryManager();
