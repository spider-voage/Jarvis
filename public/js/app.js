// public/js/app.js
// Spider AI v2.0 — Modern intelligent assistant

(function() {
  'use strict';

  // ===== State =====
  const state = {
    token: localStorage.getItem('token'),
    user: null,
    conversations: [],
    currentConversationId: null,
    messages: [],
    settings: {},
    isStreaming: false,
    voiceMode: false,
    voiceSettings: {
      provider: 'elevenlabs',
      voiceId: '',
      speed: 1.0,
      volume: 1.0,
      micSensitivity: 0.5,
      continuous: false,
      autoDetectLang: true,
    },
    subscription: null,
    isMobile: window.innerWidth <= 768,
    sidebarOpen: false,
    pinnedChats: new Set(),
    searchQuery: '',
  };

  // ===== API Client =====
  const api = {
    base: '',
    headers() {
      const h = { 'Content-Type': 'application/json' };
      if (state.token) h.Authorization = `Bearer ${state.token}`;
      return h;
    },
    async get(path) {
      const res = await fetch(`${this.base}${path}`, { headers: this.headers() });
      if (!res.ok) throw new Error((await res.json()).error || 'Request failed');
      return res.json();
    },
    async post(path, body) {
      const res = await fetch(`${this.base}${path}`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Request failed');
      return res.json();
    },
    async put(path, body) {
      const res = await fetch(`${this.base}${path}`, {
        method: 'PUT',
        headers: this.headers(),
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Request failed');
      return res.json();
    },
    async patch(path, body) {
      const res = await fetch(`${this.base}${path}`, {
        method: 'PATCH',
        headers: this.headers(),
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Request failed');
      return res.json();
    },
    async del(path) {
      const res = await fetch(`${this.base}${path}`, {
        method: 'DELETE',
        headers: this.headers(),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Request failed');
      return res.json();
    },
    async stream(path, body, onChunk) {
      const res = await fetch(`${this.base}${path}?stream=true`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
      });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') return;
            try {
              const parsed = JSON.parse(data);
              onChunk(parsed);
            } catch {}
          }
        }
      }
    },
  };

  // ===== DOM Helpers =====
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function formatDate(dateStr) {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
    return d.toLocaleDateString();
  }

  // ===== Markdown Renderer =====
  function renderMarkdown(text) {
    if (!text) return '';

    // Escape HTML first
    let html = escapeHtml(text);

    // Code blocks
    html = html.replace(/```([\w]*)\n?([\s\S]*?)```/g, (match, lang, code) => {
      const language = lang || 'text';
      const highlighted = highlightCode(code.trim(), language);
      return `<div class="code-block"><div class="code-header"><span class="code-lang">${language}</span><button class="code-copy" onclick="copyCode(this)">Copy</button></div><pre><code class="language-${language}">${highlighted}</code></pre></div>`;
    });

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Headers
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

    // Bold and italic
    html = html.replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    html = html.replace(/__(.*?)__/g, '<strong>$1</strong>');
    html = html.replace(/_(.*?)_/g, '<em>$1</em>');

    // Blockquotes
    html = html.replace(/^> (.*$)/gim, '<blockquote>$1</blockquote>');

    // Tables
    html = html.replace(/(\|[^\n]+\|\n)(\|[\s\-:]+\|\n)((?:\|[^\n]+\|\n?)+)/g, (match, header, sep, rows) => {
      const headers = header.trim().split('|').filter(c => c.trim()).map(c => `<th>${c.trim()}</th>`).join('');
      const bodyRows = rows.trim().split('\n').map(row => {
        const cells = row.trim().split('|').filter(c => c.trim()).map(c => `<td>${c.trim()}</td>`).join('');
        return `<tr>${cells}</tr>`;
      }).join('');
      return `<table><thead><tr>${headers}</tr></thead><tbody>${bodyRows}</tbody></table>`;
    });

    // Lists
    html = html.replace(/(^|\n)((?:\s*- .+\n?)+)/g, (match, prefix, list) => {
      const items = list.trim().split('\n').map(line => {
        const content = line.replace(/^\s*- /, '');
        return `<li>${content}</li>`;
      }).join('');
      return `${prefix}<ul>${items}</ul>`;
    });

    html = html.replace(/(^|\n)((?:\s*\d+\. .+\n?)+)/g, (match, prefix, list) => {
      const items = list.trim().split('\n').map(line => {
        const content = line.replace(/^\s*\d+\. /, '');
        return `<li>${content}</li>`;
      }).join('');
      return `${prefix}<ol>${items}</ol>`;
    });

    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

    // Math (simple inline)
    html = html.replace(/\$\$([^$]+)\$\$/g, '<span class="math">$1</span>');
    html = html.replace(/\$([^$]+)\$/g, '<span class="math-inline">$1</span>');

    // Line breaks
    html = html.replace(/\n\n/g, '</p><p>');
    html = html.replace(/\n/g, '<br>');

    // Wrap in paragraphs if not already wrapped
    if (!html.startsWith('<')) {
      html = `<p>${html}</p>`;
    }

    return html;
  }

  function highlightCode(code, lang) {
    // Simple syntax highlighting
    let highlighted = escapeHtml(code);

    const patterns = [
      { regex: /\b(function|const|let|var|return|if|else|for|while|class|import|export|from|async|await|try|catch|throw|new|this|typeof|instanceof)\b/g, class: 'hl-keyword' },
      { regex: /"([^"\
]|\.)*"|'([^'\
]|\.)*'/g, class: 'hl-string' },
      { regex: /\b\d+\b/g, class: 'hl-number' },
      { regex: /\b(true|false|null|undefined)\b/g, class: 'hl-boolean' },
      { regex: /\/\/.*$|\/\*[\s\S]*?\*\//gm, class: 'hl-comment' },
      { regex: /\b([A-Z][a-zA-Z0-9]*)\b/g, class: 'hl-class' },
    ];

    for (const p of patterns) {
      highlighted = highlighted.replace(p.regex, match => `<span class="${p.class}">${match}</span>`);
    }

    return highlighted;
  }

  window.copyCode = function(btn) {
    const code = btn.closest('.code-block').querySelector('code').textContent;
    navigator.clipboard.writeText(code).then(() => {
      btn.textContent = 'Copied!';
      setTimeout(() => btn.textContent = 'Copy', 2000);
    });
  };

  // ===== Toast Notifications =====
  function showToast(message, type = 'info') {
    const container = $('.toast-container') || createToastContainer();
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        ${type === 'success' ? '<path d="M20 6L9 17l-5-5"/>' :
          type === 'error' ? '<circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/>' :
          '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>'}
      </svg>
      <span>${escapeHtml(message)}</span>
    `;
    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('toast-exit');
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  function createToastContainer() {
    const container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
    return container;
  }

  // ===== Auth =====
  async function initAuth() {
    // Always dismiss loading screen so auth/login is accessible
    const loader = document.querySelector('.loading-screen');
    if (loader) loader.classList.add('hidden');

    if (!state.token) {
      showAuthScreen();
      return;
    }
    try {
      const data = await api.get('/api/v1/auth/me');
      state.user = data.user;
      hideAuthScreen();
      initApp();
    } catch {
      localStorage.removeItem('token');
      state.token = null;
      showAuthScreen();
    }
  }

  function showAuthScreen() {
    const loader = document.querySelector('.loading-screen');
    if (loader) loader.classList.add('hidden');
    $('#auth-screen')?.classList.remove('hidden');
    $('#app-container')?.classList.add('hidden');
  }

  function hideAuthScreen() {
    $('#auth-screen')?.classList.add('hidden');
    $('#app-container')?.classList.remove('hidden');
  }

  async function handleLogin(e) {
    e.preventDefault();
    const email = $('#login-email').value;
    const password = $('#login-password').value;
    try {
      const data = await api.post('/api/v1/auth/login', { email, password });
      state.token = data.token;
      state.user = data.user;
      localStorage.setItem('token', data.token);
      hideAuthScreen();
      initApp();
      showToast('Welcome back!', 'success');
    } catch (err) {
      showLoginError(err.message);
    }
  }

  async function handleRegister(e) {
    e.preventDefault();
    const email = $('#register-email').value;
    const password = $('#register-password').value;
    const name = $('#register-name').value;
    try {
      const data = await api.post('/api/v1/auth/register', { email, password, name });
      state.token = data.token;
      state.user = data.user;
      localStorage.setItem('token', data.token);
      hideAuthScreen();
      initApp();
      showToast('Account created!', 'success');
    } catch (err) {
      showRegisterError(err.message);
    }
  }

  function showLoginError(msg) {
    const el = $('#login-error');
    el.textContent = msg;
    el.classList.add('visible');
  }

  function showRegisterError(msg) {
    const el = $('#register-error');
    el.textContent = msg;
    el.classList.add('visible');
  }

  function toggleAuthMode() {
    $('#login-form').classList.toggle('hidden');
    $('#register-form').classList.toggle('hidden');
  }

  // ===== Conversations =====
  async function loadConversations() {
    try {
      const search = state.searchQuery ? `?search=${encodeURIComponent(state.searchQuery)}` : '';
      const data = await api.get(`/api/v1/chat/conversations${search}`);
      state.conversations = data.conversations;
      renderConversations();
    } catch (err) {
      console.error('Failed to load conversations:', err);
    }
  }

  function renderConversations() {
    const list = $('.conversations-list');
    if (!list) return;
    list.innerHTML = '';

    const pinned = state.conversations.filter(c => c.pinned);
    const unpinned = state.conversations.filter(c => !c.pinned);

    if (pinned.length > 0) {
      const header = document.createElement('div');
      header.className = 'conv-section-header';
      header.textContent = 'Pinned';
      list.appendChild(header);
      pinned.forEach(c => list.appendChild(createConversationItem(c)));
    }

    if (unpinned.length > 0) {
      if (pinned.length > 0) {
        const header = document.createElement('div');
        header.className = 'conv-section-header';
        header.textContent = 'Recent';
        list.appendChild(header);
      }
      unpinned.forEach(c => list.appendChild(createConversationItem(c)));
    }
  }

  function createConversationItem(conv) {
    const el = document.createElement('div');
    el.className = `conversation-item ${conv.id === state.currentConversationId ? 'active' : ''}`;
    el.dataset.id = conv.id;
    el.innerHTML = `
      <div class="conv-icon">💬</div>
      <div class="conv-info">
        <div class="conv-title">${escapeHtml(conv.title)}</div>
        <div class="conv-date">${formatDate(conv.updated_at)}</div>
      </div>
      <div class="conv-actions">
        <button class="conv-pin" title="${conv.pinned ? 'Unpin' : 'Pin'}">📌</button>
        <button class="conv-export" title="Export">📥</button>
        <button class="conv-delete" title="Delete">🗑️</button>
      </div>
    `;

    el.addEventListener('click', (e) => {
      if (e.target.closest('.conv-actions')) return;
      selectConversation(conv.id);
    });

    el.querySelector('.conv-pin').addEventListener('click', (e) => {
      e.stopPropagation();
      togglePinConversation(conv.id, !conv.pinned);
    });

    el.querySelector('.conv-export').addEventListener('click', (e) => {
      e.stopPropagation();
      exportConversation(conv.id);
    });

    el.querySelector('.conv-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteConversation(conv.id);
    });

    return el;
  }

  async function selectConversation(id) {
    state.currentConversationId = id;
    renderConversations();
    await loadMessages(id);
    updateChatTitle();
    if (state.isMobile) toggleSidebar(false);
  }

  async function createNewConversation() {
    try {
      const data = await api.post('/api/v1/chat/conversations', { title: 'New chat' });
      state.currentConversationId = data.id;
      state.messages = [];
      await loadConversations();
      renderConversations();
      showWelcomeScreen(false);
      clearMessages();
      updateChatTitle('New chat');
    } catch (err) {
      showToast('Failed to create conversation', 'error');
    }
  }

  async function togglePinConversation(id, pinned) {
    try {
      await api.patch(`/api/v1/chat/conversations/${id}`, { pinned: pinned ? 1 : 0 });
      await loadConversations();
    } catch (err) {
      showToast('Failed to update conversation', 'error');
    }
  }

  async function deleteConversation(id) {
    if (!confirm('Delete this conversation? This cannot be undone.')) return;
    try {
      await api.del(`/api/v1/chat/conversations/${id}`);
      if (state.currentConversationId === id) {
        state.currentConversationId = null;
        state.messages = [];
        clearMessages();
        showWelcomeScreen(true);
      }
      await loadConversations();
      showToast('Conversation deleted', 'success');
    } catch (err) {
      showToast('Failed to delete conversation', 'error');
    }
  }

  async function exportConversation(id) {
    try {
      const format = confirm('Export as Markdown? (Cancel for JSON)') ? 'markdown' : 'json';
      const res = await fetch(`${api.base}/api/v1/chat/conversations/${id}/export?format=${format}`, {
        headers: api.headers(),
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `conversation-${id}.${format === 'json' ? 'json' : 'md'}`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Conversation exported', 'success');
    } catch (err) {
      showToast('Export failed', 'error');
    }
  }

  // ===== Messages =====
  async function loadMessages(conversationId) {
    try {
      const data = await api.get(`/api/v1/chat/conversations/${conversationId}/messages`);
      state.messages = data.messages;
      renderMessages();
    } catch (err) {
      console.error('Failed to load messages:', err);
    }
  }

  function renderMessages() {
    const container = $('.messages-container');
    if (!container) return;
    container.innerHTML = '';

    if (state.messages.length === 0) {
      showWelcomeScreen(true);
      return;
    }

    showWelcomeScreen(false);
    state.messages.forEach(msg => container.appendChild(createMessageElement(msg)));
    scrollToBottom();
  }

  function createMessageElement(msg, isStreaming = false) {
    const el = document.createElement('div');
    el.className = `message ${msg.role}`;
    el.dataset.id = msg.id;

    const avatar = msg.role === 'user'
      ? `<div class="message-avatar">${state.user?.name?.[0]?.toUpperCase() || 'U'}</div>`
      : `<div class="message-avatar"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg></div>`;

    const contentHtml = isStreaming ? escapeHtml(msg.content) : renderMarkdown(msg.content);

    el.innerHTML = `
      ${avatar}
      <div class="message-content-wrapper">
        <div class="message-content">${contentHtml}</div>
        ${msg.role === 'assistant' && !isStreaming ? `
          <div class="message-actions">
            <button class="msg-copy" title="Copy">📋 Copy</button>
            <button class="msg-regenerate" title="Regenerate">🔄 Regenerate</button>
            <button class="msg-edit" title="Edit">✏️ Edit</button>
          </div>
        ` : ''}
        ${msg.role === 'user' && !isStreaming ? `
          <div class="message-actions">
            <button class="msg-edit-user" title="Edit">✏️ Edit</button>
            <button class="msg-delete" title="Delete">🗑️ Delete</button>
          </div>
        ` : ''}
      </div>
    `;

    // Attach action handlers
    const copyBtn = el.querySelector('.msg-copy');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(msg.content).then(() => {
          showToast('Copied to clipboard', 'success');
        });
      });
    }

    const regenBtn = el.querySelector('.msg-regenerate');
    if (regenBtn) {
      regenBtn.addEventListener('click', () => regenerateMessage(msg.id));
    }

    const editBtn = el.querySelector('.msg-edit');
    if (editBtn) {
      editBtn.addEventListener('click', () => startEditMessage(msg));
    }

    const editUserBtn = el.querySelector('.msg-edit-user');
    if (editUserBtn) {
      editUserBtn.addEventListener('click', () => startEditUserMessage(msg));
    }

    const delBtn = el.querySelector('.msg-delete');
    if (delBtn) {
      delBtn.addEventListener('click', () => deleteMessage(msg.id));
    }

    return el;
  }

  function appendStreamingMessage() {
    const container = $('.messages-container');
    const msg = { role: 'assistant', content: '', id: 'streaming' };
    const el = createMessageElement(msg, true);
    el.id = 'streaming-message';
    container.appendChild(el);
    scrollToBottom();
    return el;
  }

  function updateStreamingMessage(content) {
    const el = $('#streaming-message');
    if (el) {
      el.querySelector('.message-content').innerHTML = renderMarkdown(content);
      scrollToBottom();
    }
  }

  function removeStreamingMessage() {
    $('#streaming-message')?.remove();
  }

  async function sendMessage(content) {
    if (!content.trim() || state.isStreaming) return;

    if (!state.currentConversationId) {
      await createNewConversation();
    }

    // Add user message to UI immediately
    const userMsg = { role: 'user', content, id: Date.now() };
    state.messages.push(userMsg);
    const container = $('.messages-container');
    container.appendChild(createMessageElement(userMsg));
    scrollToBottom();

    // Clear input
    const input = $('.chat-input');
    if (input) input.value = '';

    state.isStreaming = true;
    showTypingIndicator(true);

    try {
      const streamEl = appendStreamingMessage();
      let fullReply = '';

      await api.stream(
        `/api/v1/chat/conversations/${state.currentConversationId}/messages`,
        { content, stream: true },
        (chunk) => {
          if (chunk.chunk) {
            fullReply += chunk.chunk;
            updateStreamingMessage(fullReply);
          }
          if (chunk.error) {
            throw new Error(chunk.error);
          }
        }
      );

      removeStreamingMessage();
      // Reload messages to get proper IDs
      await loadMessages(state.currentConversationId);
      await loadConversations();
    } catch (err) {
      removeStreamingMessage();
      showToast(err.message || 'Failed to get response', 'error');
      // Add error message
      const errorMsg = { role: 'assistant', content: `Error: ${err.message}`, id: Date.now() + 1 };
      state.messages.push(errorMsg);
      container.appendChild(createMessageElement(errorMsg));
    } finally {
      state.isStreaming = false;
      showTypingIndicator(false);
      scrollToBottom();
    }
  }

  async function regenerateMessage(messageId) {
    if (state.isStreaming) return;
    state.isStreaming = true;
    showTypingIndicator(true);

    try {
      const streamEl = appendStreamingMessage();
      let fullReply = '';

      await api.stream(
        `/api/v1/chat/conversations/${state.currentConversationId}/regenerate`,
        { messageId, stream: true },
        (chunk) => {
          if (chunk.chunk) {
            fullReply += chunk.chunk;
            updateStreamingMessage(fullReply);
          }
        }
      );

      removeStreamingMessage();
      await loadMessages(state.currentConversationId);
    } catch (err) {
      removeStreamingMessage();
      showToast('Regeneration failed', 'error');
    } finally {
      state.isStreaming = false;
      showTypingIndicator(false);
    }
  }

  function startEditMessage(msg) {
    // For assistant messages, we can only copy or regenerate
    showToast('Use regenerate to get a new response', 'info');
  }

  function startEditUserMessage(msg) {
    const newContent = prompt('Edit your message:', msg.content);
    if (newContent && newContent !== msg.content) {
      editUserMessage(msg.id, newContent);
    }
  }

  async function editUserMessage(messageId, newContent) {
    try {
      await api.put(`/api/v1/chat/conversations/${state.currentConversationId}/messages/${messageId}`, {
        content: newContent,
      });
      // Resend to get new AI response
      await sendMessage(newContent);
    } catch (err) {
      showToast('Failed to edit message', 'error');
    }
  }

  async function deleteMessage(messageId) {
    if (!confirm('Delete this message?')) return;
    try {
      await api.del(`/api/v1/chat/conversations/${state.currentConversationId}/messages/${messageId}`);
      await loadMessages(state.currentConversationId);
      showToast('Message deleted', 'success');
    } catch (err) {
      showToast('Failed to delete message', 'error');
    }
  }

  function showTypingIndicator(show) {
    const container = $('.messages-container');
    let indicator = $('.typing-indicator');
    if (show) {
      if (!indicator) {
        indicator = document.createElement('div');
        indicator.className = 'typing-indicator';
        indicator.innerHTML = '<span></span><span></span><span></span>';
        container.appendChild(indicator);
        scrollToBottom();
      }
    } else {
      indicator?.remove();
    }
  }

  function clearMessages() {
    const container = $('.messages-container');
    if (container) container.innerHTML = '';
  }

  function scrollToBottom() {
    const container = $('.messages-container');
    if (container) container.scrollTop = container.scrollHeight;
  }

  function showWelcomeScreen(show) {
    const welcome = $('.welcome-screen');
    const messages = $('.messages-container');
    if (welcome) welcome.style.display = show ? 'flex' : 'none';
    if (messages) messages.style.display = show ? 'none' : 'flex';
  }

  function updateChatTitle(title) {
    const el = $('.chat-title');
    if (el) el.textContent = title || 'New chat';
  }

  // ===== Voice =====
  let mediaRecorder = null;
  let audioChunks = [];
  let isRecording = false;
  let recognition = null;
  let synth = window.speechSynthesis;
  let currentUtterance = null;
  let isSpeaking = false;

  function initVoice() {
    // Web Speech API for STT
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = (event) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        const input = $('.chat-input');
        if (input) input.value = transcript;
      };

      recognition.onend = () => {
        if (state.voiceMode && state.voiceSettings.continuous && !isSpeaking) {
          setTimeout(() => startVoiceInput(), 500);
        }
      };
    }
  }

  function startVoiceInput() {
    if (!recognition) {
      showToast('Voice input not supported in this browser', 'error');
      return;
    }
    if (isRecording) return;

    // Check voice access
    if (!state.subscription?.voice_enabled && state.user?.role !== 'admin') {
      showToast('Voice is a Pro feature. Upgrade to use voice input.', 'warning');
      return;
    }

    isRecording = true;
    $('.voice-btn')?.classList.add('recording');
    recognition.start();
  }

  function stopVoiceInput() {
    if (!isRecording) return;
    isRecording = false;
    $('.voice-btn')?.classList.remove('recording');
    recognition?.stop();
  }

  function toggleVoiceInput() {
    if (isRecording) {
      stopVoiceInput();
    } else {
      startVoiceInput();
    }
  }

  async function speakText(text) {
    if (!text) return;

    // Check voice access
    if (!state.subscription?.voice_enabled && state.user?.role !== 'admin') {
      return;
    }

    // Stop current speech
    if (isSpeaking) {
      stopSpeaking();
    }

    // Try server TTS first
    try {
      const res = await fetch(`${api.base}/api/v1/voice/tts`, {
        method: 'POST',
        headers: api.headers(),
        body: JSON.stringify({ text, voiceId: state.voiceSettings.voiceId, speed: state.voiceSettings.speed }),
      });

      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.volume = state.voiceSettings.volume;
        audio.playbackRate = state.voiceSettings.speed;

        currentUtterance = audio;
        isSpeaking = true;
        updateVoiceHUD('speaking');

        audio.onended = () => {
          isSpeaking = false;
          URL.revokeObjectURL(url);
          updateVoiceHUD('idle');
          if (state.voiceMode && state.voiceSettings.continuous) {
            setTimeout(() => startVoiceInput(), 500);
          }
        };

        audio.onerror = () => {
          isSpeaking = false;
          URL.revokeObjectURL(url);
          updateVoiceHUD('idle');
        };

        await audio.play();
        return;
      }
    } catch (err) {
      console.log('Server TTS failed, falling back to browser');
    }

    // Browser fallback
    if (!synth) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = state.voiceSettings.speed;
    utterance.volume = state.voiceSettings.volume;

    if (state.voiceSettings.autoDetectLang) {
      // Simple heuristic
      const lang = /^[\u0600-\u06FF]/.test(text) ? 'ar-SA' :
                   /^[\u4e00-\u9fff]/.test(text) ? 'zh-CN' :
                   /^[\u3040-\u309f\u30a0-\u30ff]/.test(text) ? 'ja-JP' :
                   /^[\uac00-\ud7af]/.test(text) ? 'ko-KR' :
                   /^[\u0400-\u04ff]/.test(text) ? 'ru-RU' : 'en-US';
      utterance.lang = lang;
    }

    currentUtterance = utterance;
    isSpeaking = true;
    updateVoiceHUD('speaking');

    utterance.onend = () => {
      isSpeaking = false;
      updateVoiceHUD('idle');
      if (state.voiceMode && state.voiceSettings.continuous) {
        setTimeout(() => startVoiceInput(), 500);
      }
    };

    synth.speak(utterance);
  }

  function stopSpeaking() {
    if (currentUtterance instanceof Audio) {
      currentUtterance.pause();
      currentUtterance.currentTime = 0;
    }
    if (synth) synth.cancel();
    isSpeaking = false;
    updateVoiceHUD('idle');
  }

  function updateVoiceHUD(status) {
    const hud = $('.voice-hud');
    const orb = $('.voice-orb');
    const statusText = $('.voice-status');
    if (!hud || !orb) return;

    orb.classList.remove('speaking', 'listening', 'idle');
    orb.classList.add(status);

    if (status === 'speaking') statusText.textContent = 'Speaking...';
    else if (status === 'listening') statusText.textContent = 'Listening...';
    else statusText.textContent = 'Ready';
  }

  function toggleVoiceMode() {
    state.voiceMode = !state.voiceMode;
    const hud = $('.voice-hud');
    if (hud) {
      hud.classList.toggle('active', state.voiceMode);
    }
    if (state.voiceMode) {
      startVoiceInput();
    } else {
      stopVoiceInput();
      stopSpeaking();
    }
  }

  // ===== Settings =====
  async function loadSettings() {
    try {
      const data = await api.get('/api/v1/profile');
      state.settings = data.settings || {};
      state.subscription = data.subscription;
      applySettings();
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  }

  function applySettings() {
    const s = state.settings;
    if (s.theme) document.documentElement.setAttribute('data-theme', s.theme);
    if (s.accent_color) {
      document.documentElement.style.setProperty('--accent-primary', s.accent_color);
    }
    if (s.voice_speed) state.voiceSettings.speed = parseFloat(s.voice_speed);
    if (s.voice_volume) state.voiceSettings.volume = parseFloat(s.voice_volume);
    if (s.voice_tts_voice_id) state.voiceSettings.voiceId = s.voice_tts_voice_id;
    if (s.language && s.language !== 'auto') {
      if (recognition) recognition.lang = s.language;
    }
  }

  async function saveSettings(updates) {
    try {
      await api.put('/api/v1/profile/settings', updates);
      Object.assign(state.settings, updates);
      applySettings();
      showToast('Settings saved', 'success');
    } catch (err) {
      showToast('Failed to save settings', 'error');
    }
  }

  // ===== Dashboard / Account =====
  async function loadDashboard() {
    try {
      const data = await api.get('/api/v1/subscriptions/dashboard');
      renderDashboard(data);
    } catch (err) {
      console.error('Failed to load dashboard:', err);
    }
  }

  function renderDashboard(data) {
    const container = $('#dashboard-content');
    if (!container) return;

    container.innerHTML = `
      <div class="dashboard-card">
        <h3>Current Plan</h3>
        <div class="plan-badge plan-${data.plan.slug}">${data.plan.name}</div>
        <p class="plan-status">Status: ${data.plan.status || 'Active'}</p>
        ${data.plan.slug === 'free' ? `
          <button class="btn btn-primary" onclick="showUpgradeModal()">Upgrade to Pro</button>
        ` : `
          <button class="btn btn-secondary" onclick="cancelSubscription()">Cancel Subscription</button>
        `}
      </div>
      <div class="dashboard-card">
        <h3>Usage Today</h3>
        <div class="usage-grid">
          <div class="usage-item">
            <span class="usage-value">${data.usage.messages_sent}</span>
            <span class="usage-label">Messages Sent</span>
          </div>
          <div class="usage-item">
            <span class="usage-value">${data.usage.messages_received}</span>
            <span class="usage-label">Messages Received</span>
          </div>
          <div class="usage-item">
            <span class="usage-value">${Math.round(data.usage.voice_minutes * 10) / 10}</span>
            <span class="usage-label">Voice Minutes</span>
          </div>
          <div class="usage-item">
            <span class="usage-value">${data.usage.remaining_messages}</span>
            <span class="usage-label">Remaining Today</span>
          </div>
        </div>
      </div>
      <div class="dashboard-card">
        <h3>Features</h3>
        <ul class="feature-list">
          <li class="${data.plan.voice_enabled ? 'enabled' : 'disabled'}">🎙️ Voice Conversations</li>
          <li class="${data.plan.advanced_models ? 'enabled' : 'disabled'}">🧠 Advanced AI Models</li>
          <li class="${data.plan.file_analysis ? 'enabled' : 'disabled'}">📁 File Analysis</li>
          <li class="${data.plan.slug !== 'free' ? 'enabled' : 'disabled'}">⚡ Priority Responses</li>
        </ul>
      </div>
    `;
  }

  // ===== UI Event Handlers =====
  function initEventListeners() {
    // Auth
    $('#login-form')?.addEventListener('submit', handleLogin);
    $('#register-form')?.addEventListener('submit', handleRegister);
    $('#toggle-auth')?.addEventListener('click', toggleAuthMode);

    // Chat input
    const chatInput = $('.chat-input');
    if (chatInput) {
      chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendMessage(chatInput.value);
        }
      });
    }

    $('.send-btn')?.addEventListener('click', () => {
      const input = $('.chat-input');
      if (input) sendMessage(input.value);
    });

    // Voice
    $('.voice-btn')?.addEventListener('click', toggleVoiceInput);
    $('#voice-close')?.addEventListener('click', toggleVoiceMode);
    $('#voice-stop')?.addEventListener('click', stopSpeaking);

    // Sidebar
    $('.menu-toggle')?.addEventListener('click', () => toggleSidebar());
    $('.new-chat-btn')?.addEventListener('click', createNewConversation);
    $('.sidebar-backdrop')?.addEventListener('click', () => toggleSidebar(false));

    // Search
    const searchInput = $('.sidebar-search input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        state.searchQuery = e.target.value;
        loadConversations();
      });
    }

    // Settings modal
    $('.settings-btn')?.addEventListener('click', () => {
      $('#settings-modal')?.classList.add('active');
      loadSettings();
    });
    $('.modal-close')?.addEventListener('click', () => {
      $('#settings-modal')?.classList.remove('active');
    });
    $('#settings-modal')?.addEventListener('click', (e) => {
      if (e.target === $('#settings-modal')) $('#settings-modal').classList.remove('active');
    });

    // Dashboard modal
    $('.dashboard-btn')?.addEventListener('click', () => {
      $('#dashboard-modal')?.classList.add('active');
      loadDashboard();
    });
    $('#dashboard-modal .modal-close')?.addEventListener('click', () => {
      $('#dashboard-modal')?.classList.remove('active');
    });

    // Settings controls
    $('#theme-select')?.addEventListener('change', (e) => saveSettings({ theme: e.target.value }));
    $('#accent-picker')?.addEventListener('input', (e) => saveSettings({ accent_color: e.target.value }));
    $('#voice-speed')?.addEventListener('input', (e) => {
      state.voiceSettings.speed = parseFloat(e.target.value);
      $('#voice-speed-value').textContent = e.target.value + 'x';
    });
    $('#voice-volume')?.addEventListener('input', (e) => {
      state.voiceSettings.volume = parseFloat(e.target.value);
      $('#voice-volume-value').textContent = Math.round(e.target.value * 100) + '%';
    });
    $('#language-select')?.addEventListener('change', (e) => saveSettings({ language: e.target.value }));
    $('#notifications-toggle')?.addEventListener('click', (e) => {
      const enabled = e.target.classList.toggle('active');
      saveSettings({ notifications_enabled: enabled ? 1 : 0 });
    });

    // Window resize
    window.addEventListener('resize', () => {
      state.isMobile = window.innerWidth <= 768;
    });
  }

  function toggleSidebar(force) {
    const sidebar = $('.sidebar');
    const backdrop = $('.sidebar-backdrop');
    if (!sidebar) return;

    const open = force !== undefined ? force : !sidebar.classList.contains('open');
    sidebar.classList.toggle('open', open);
    backdrop?.classList.toggle('active', open);
  }

  // ===== App Initialization =====
  async function initApp() {
    // Hide loading screen immediately so UI is interactive
    const loader = document.querySelector('.loading-screen');
    if (loader) loader.classList.add('hidden');

    await loadSettings();
    await loadConversations();
    initVoice();
    initEventListeners();

    // Show welcome screen if no conversation selected
    if (!state.currentConversationId) {
      showWelcomeScreen(true);
    }
  }

  // ===== Start =====
  document.addEventListener('DOMContentLoaded', () => {
    initAuth();
  });

})();
