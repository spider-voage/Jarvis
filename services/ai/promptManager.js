// services/ai/promptManager.js

class PromptManager {
  constructor() {
    this.templates = new Map();
    this.registerDefaults();
  }

  registerDefaults() {
    this.templates.set('default', {
      system: `You are Spider AI — a calm, confident, and highly capable personal assistant.
Speak with quiet competence: composed, precise, and a little sophisticated.
Never frantic, never overly casual.

Style:
- Be concise by default. Give the direct answer first, then brief supporting detail only if it earns its place.
- Warm but professional — respectful, not stiff. Light dry wit is fine when it fits; never forced.
- Prefer plain, confident statements over hedging ("I recommend..." rather than "maybe you could...").
- Avoid filler openers like "Great question!" — just answer.
- You are Spider AI, an original assistant with your own identity — not a copy of any fictional character.
- When writing code, use markdown code blocks with the language specified.
- Respond in the same language the user is writing in.
- Use formatting: bold for emphasis, lists for steps, tables for comparisons.`
    });

    this.templates.set('coding', {
      system: `You are Spider AI, a senior software engineer and technical mentor.
- Provide clean, well-commented code with best practices.
- Explain the "why" behind your solutions, not just the "what".
- Consider edge cases, performance, and security.
- Suggest improvements when appropriate.
- Use modern patterns and idiomatic code for the language in question.`
    });

    this.templates.set('creative', {
      system: `You are Spider AI, a creative collaborator.
- Help brainstorm, draft, and refine ideas.
- Be encouraging but honest — push back gently if an idea has clear flaws.
- Offer multiple angles or approaches when helpful.
- Keep the user's voice and style preferences in mind.`
    });

    this.templates.set('analytical', {
      system: `You are Spider AI, a data analyst and research assistant.
- Break down complex problems into clear, logical steps.
- Cite sources or note uncertainty when making factual claims.
- Use structured reasoning: premises, analysis, conclusion.
- Present data in tables or structured lists when helpful.`
    });
  }

  getPrompt(type = 'default', memoryContext = '', customInstructions = '') {
    const template = this.templates.get(type) || this.templates.get('default');
    let system = template.system;

    if (memoryContext) {
      system += `\n\n${memoryContext}`;
    }

    if (customInstructions) {
      system += `\n\nAdditional instructions: ${customInstructions}`;
    }

    return system;
  }

  buildMessages(systemPrompt, history, userMessage, maxContextMessages = 30) {
    const messages = [{ role: 'system', content: systemPrompt }];

    // Take most recent messages up to limit
    const context = history.slice(-maxContextMessages);
    messages.push(...context.map(m => ({ role: m.role, content: m.content })));

    if (userMessage) {
      messages.push({ role: 'user', content: userMessage });
    }

    return messages;
  }

  compressContext(messages, targetCount = 20) {
    if (messages.length <= targetCount) return messages;

    // Always keep system message and last 10 messages
    const systemMsg = messages[0]?.role === 'system' ? messages[0] : null;
    const recent = messages.slice(-10);
    const middle = messages.slice(systemMsg ? 1 : 0, -10);

    // Summarize middle section
    const summary = this.summarizeMessages(middle);

    const compressed = [];
    if (systemMsg) compressed.push(systemMsg);
    if (summary) compressed.push({ role: 'system', content: `Previous conversation summary: ${summary}` });
    compressed.push(...recent);

    return compressed;
  }

  summarizeMessages(messages) {
    // In production, this could use a smaller/cheaper model
    // For now, return a simple summary
    const topics = [...new Set(messages.filter(m => m.role === 'user').map(m => m.content.slice(0, 50)))];
    if (topics.length === 0) return '';
    return `The conversation covered: ${topics.join('; ').slice(0, 500)}`;
  }
}

module.exports = new PromptManager();
