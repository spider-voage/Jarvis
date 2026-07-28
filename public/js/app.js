// ============================================
// Spider AI — Main Application
// ============================================

(function() {
  'use strict';

  // ============================================
  // Configuration
  // ============================================
  const CONFIG = {
    API_BASE: '',
    RETRY_ATTEMPTS: 3,
    RETRY_DELAY: 1000,
    STREAMING: true,
    MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
    DEBOUNCE_MS: 300,
  };

  // ============================================
  // State
  // ============================================
  const state = {
    token: null,
    user: null,
    conversations: [],
    currentConversationId: null,
    messages: [],
    isLoading: false,
    isStreaming: false,
    settings: {
      theme: 'dark',
      accentColor: '#00d4ff',
      ttsProvider: 'elevenlabs',
      voiceId: '',
      voiceSpeed: 1.0,
      voiceVolume: 1.0,
      micSensitivity: 0.5,
      language: 'auto',
      notifications: true,
      handsFree: false,
    },
    voice: {
      isListening: false,
      isSpeaking: false,
      recognition: null,
      audioContext: null,
      analyser: null,
      mediaStream: null,
      audioPlayer: null,
      handsFreeTimer: null,
    },
    particles: [],
    shortcuts: {},
  };

  // ============================================
  // DOM Cache
  // ============================================
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // ============================================
  // API Client
  // ============================================
  async function api(path, options = {}) {
    const url = `${CONFIG.API_BASE}/api${path}`;
    const opts = {
      headers: {
        'Content-Type': 'application/json',
        ...(state.token ? { 'Authorization': `Bearer ${state.token}` } : {}),
        ...(options.headers || {}),
      },
      ...options,
    };
    if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) {
      opts.body = JSON.stringify(opts.body);
    }

    let lastError;
    for (let attempt = 0; attempt < CONFIG.RETRY_ATTEMPTS; attempt++) {
      try {
        const res = await fetch(url, opts);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          if (res.status === 401) {
            logout();
            throw new Error('Session expired. Please sign in again.');
          }
          throw new Error(data.error || `Request failed (${res.status})`);
        }
        if (res.headers.get('content-type')?.includes('application/json')) {
          return await res.json();
        }
        return res;
      } catch (err) {
        lastError = err;
        if (attempt < CONFIG.RETRY_ATTEMPTS - 1) {
          await delay(CONFIG.RETRY_DELAY * (attempt + 1));
        }
      }
    }
    throw lastError;
  }

  function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ============================================
  // Auth
  // ============================================
  async function initAuth() {
    const saved = localStorage.getItem('spider_token');
    if (saved) {
      state.token = saved;
      try {
        const data = await api('/auth/me');
        state.user = data.user;
        showApp();
        return;
      } catch (e) {
        localStorage.removeItem('spider_token');
        state.token = null;
      }
    }
    showAuth();
  }

  async function login(email, password) {
    const data = await api('/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('spider_token', data.token);
    showApp();
    toast('Welcome back!', 'success');
  }

  async function register(name, email, password) {
    const data = await api('/auth/register', {
      method: 'POST',
      body: { name, email, password },
    });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('spider_token', data.token);
    showApp();
    toast('Account created successfully!', 'success');
  }

  function logout() {
    state.token = null;
    state.user = null;
    state.conversations = [];
    state.messages = [];
    state.currentConversationId = null;
    localStorage.removeItem('spider_token');
    showAuth();
    toast('Signed out', 'info');
  }

  // ============================================
  // UI Transitions
  // ============================================
  function showAuth() {
    $('#auth-screen').classList.remove('hidden');
    $('#app-container').style.display = 'none';
    $('#loading-screen').classList.add('hidden');
  }

  function showApp() {
    $('#auth-screen').classList.add('hidden');
    $('#app-container').style.display = 'flex';
    $('#loading-screen').classList.add('hidden');
    updateUserInfo();
    loadConversations();
    loadSettings();
  }

  function updateUserInfo() {
    if (!state.user) return;
    $('#user-name').textContent = state.user.name || state.user.email.split('@')[0];
    $('#user-email').textContent = state.user.email;
    $('#user-avatar').textContent = (state.user.name || state.user.email).charAt(0).toUpperCase();
  }

  // ============================================
  // Conversations
  // ============================================
  async function loadConversations() {
    try {
      const data = await api('/chat/conversations');
      state.conversations = data.conversations || [];
      renderConversations();
    } catch (err) {
      toast('Failed to load conversations', 'error');
    }
  }

  async function createConversation(title) {
    try {
      const data = await api('/chat/conversations', {
        method: 'POST',
        body: { title: title || 'New chat' },
      });
      state.conversations.unshift(data);
      renderConversations();
      selectConversation(data.id);
      return data.id;
    } catch (err) {
      toast('Failed to create conversation', 'error');
      return null;
    }
  }

  async function deleteConversation(id) {
    try {
      await api(`/chat/conversations/${id}`, { method: 'DELETE' });
      state.conversations = state.conversations.filter(c => c.id !== id);
      renderConversations();
      if (state.currentConversationId === id) {
        state.currentConversationId = null;
        state.messages = [];
        showWelcome();
      }
      toast('Conversation deleted', 'info');
    } catch (err) {
      toast('Failed to delete conversation', 'error');
    }
  }

  async function renameConversation(id, title) {
    try {
      await api(`/chat/conversations/${id}`, {
        method: 'PATCH',
        body: { title },
      });
      const conv = state.conversations.find(c => c.id === id);
      if (conv) conv.title = title;
      renderConversations();
      if (state.currentConversationId === id) {
        $('#chat-title').textContent = title;
      }
    } catch (err) {
      toast('Failed to rename conversation', 'error');
    }
  }

  async function loadMessages(conversationId) {
    try {
      const data = await api(`/chat/conversations/${conversationId}/messages`);
      state.messages = data.messages || [];
      renderMessages();
    } catch (err) {
      toast('Failed to load messages', 'error');
    }
  }

  function selectConversation(id) {
    state.currentConversationId = id;
    const conv = state.conversations.find(c => c.id === id);
    $('#chat-title').textContent = conv ? conv.title : 'New Chat';
    renderConversations();
    loadMessages(id);
    if (window.innerWidth <= 768) {
      $('#sidebar').classList.remove('open');
      $('#sidebar-backdrop').classList.remove('active');
    }
  }

  function showWelcome() {
    $('#messages-container').innerHTML = `
      <div class="welcome-screen">
        <div class="welcome-orb">
          <div class="orb-glow"></div>
          <svg viewBox="0 0 100 100" fill="none">
            <circle cx="50" cy="50" r="45" stroke="url(#grad3)" stroke-width="2" opacity="0.5"/>
            <circle cx="50" cy="50" r="35" stroke="url(#grad3)" stroke-width="1.5" opacity="0.3" stroke-dasharray="4 4"/>
            <circle cx="50" cy="50" r="22" fill="url(#grad3)" opacity="0.9"/>
            <defs>
              <linearGradient id="grad3" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:#00d4ff"/>
                <stop offset="100%" style="stop-color:#00f0ff"/>
              </linearGradient>
            </defs>
          </svg>
        </div>
        <h2>Spider AI</h2>
        <p>Your calm, intelligent, and capable voice companion. Start typing or press the microphone to speak.</p>
        <div class="welcome-shortcuts">
          <div class="shortcut-chip" data-prompt="Explain quantum computing in simple terms">Quantum Computing</div>
          <div class="shortcut-chip" data-prompt="Write a Python function to sort a list">Python Code</div>
          <div class="shortcut-chip" data-prompt="Help me plan a productive day">Daily Plan</div>
          <div class="shortcut-chip" data-prompt="Tell me a fascinating science fact">Science Fact</div>
        </div>
      </div>
    `;
    attachWelcomeListeners();
  }

  // ============================================
  // Chat
  // ============================================
  async function sendMessage(content, options = {}) {
    if (!content.trim() || state.isLoading) return;

    if (!state.currentConversationId) {
      const id = await createConversation(content.slice(0, 40));
      if (!id) return;
    }

    // Add user message to UI immediately
    const userMsg = { id: Date.now(), role: 'user', content, created_at: new Date().toISOString() };
    state.messages.push(userMsg);
    renderMessages();
    scrollToBottom();

    $('#chat-input').value = '';
    $('#chat-input').style.height = 'auto';
    state.isLoading = true;
    updateSendButton();

    // Show typing indicator
    showTypingIndicator();

    try {
      if (CONFIG.STREAMING) {
        await streamMessage(content);
      } else {
        await fetchMessage(content);
      }
    } catch (err) {
      hideTypingIndicator();
      toast(err.message || 'Failed to get response', 'error');
      // Remove the user message on error so user can retry
      state.messages.pop();
      renderMessages();
    } finally {
      state.isLoading = false;
      updateSendButton();
    }
  }

  async function fetchMessage(content) {
    const data = await api(`/chat/conversations/${state.currentConversationId}/messages`, {
      method: 'POST',
      body: { content },
    });
    hideTypingIndicator();
    state.messages.push({
      id: Date.now() + 1,
      role: 'assistant',
      content: data.reply,
      created_at: new Date().toISOString(),
    });
    renderMessages();
    scrollToBottom();

    if (state.settings.ttsProvider !== 'disabled') {
      speak(data.reply);
    }
  }

  async function streamMessage(content) {
    const url = `${CONFIG.API_BASE}/api/chat/conversations/${state.currentConversationId}/messages?stream=true`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`,
      },
      body: JSON.stringify({ content }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Stream failed (${res.status})`);
    }

    hideTypingIndicator();

    const assistantMsg = {
      id: Date.now() + 1,
      role: 'assistant',
      content: '',
      created_at: new Date().toISOString(),
    };
    state.messages.push(assistantMsg);
    renderMessages();

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const dataStr = trimmed.slice(5).trim();
        if (dataStr === '[DONE]') continue;
        try {
          const parsed = JSON.parse(dataStr);
          if (parsed.chunk) {
            fullText += parsed.chunk;
            assistantMsg.content = fullText;
            updateLastMessage(fullText);
            scrollToBottom();
          }
          if (parsed.error) throw new Error(parsed.error);
        } catch (e) {
          // ignore malformed
        }
      }
    }

    renderMessages();
    scrollToBottom();

    if (state.settings.ttsProvider !== 'disabled' && fullText.trim()) {
      speak(fullText);
    }
  }

  function showTypingIndicator() {
    const container = $('#messages-container');
    const welcome = container.querySelector('.welcome-screen');
    if (welcome) welcome.remove();

    const existing = container.querySelector('.typing-indicator');
    if (existing) existing.remove();

    const el = document.createElement('div');
    el.className = 'message assistant typing-indicator';
    el.innerHTML = `
      <div class="message-avatar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg></div>
      <div class="message-content">
        <span></span><span></span><span></span>
      </div>
    `;
    container.appendChild(el);
    scrollToBottom();
  }

  function hideTypingIndicator() {
    const el = $('#messages-container').querySelector('.typing-indicator');
    if (el) el.remove();
  }

  function updateLastMessage(text) {
    const msgs = $('#messages-container').querySelectorAll('.message.assistant');
    const last = msgs[msgs.length - 1];
    if (last) {
      const content = last.querySelector('.message-content');
      if (content) content.innerHTML = renderMarkdown(text);
    }
  }

  function scrollToBottom() {
    const container = $('#messages-container');
    container.scrollTop = container.scrollHeight;
  }

  // ============================================
  // Markdown & Syntax Highlighting
  // ============================================
  function renderMarkdown(text) {
    if (!text) return '';
    let html = escapeHtml(text);

    // Code blocks
    html = html.replace(/```([a-z]*)\n?([\s\S]*?)```/g, (match, lang, code) => {
      const highlighted = highlightCode(code.trim(), lang);
      return `<pre><code class="language-${lang || 'text'}">${highlighted}</code></pre>`;
    });

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Headers
    html = html.replace(/^#### (.*$)/gim, '<h4>$1</h4>');
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

    // Bold & Italic
    html = html.replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    html = html.replace(/__(.*?)__/g, '<strong>$1</strong>');
    html = html.replace(/_(.*?)_/g, '<em>$1</em>');

    // Blockquote
    html = html.replace(/^> (.*$)/gim, '<blockquote>$1</blockquote>');

    // Lists
    html = html.replace(/^\s*[-*+] (.*$)/gim, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');

    // Ordered lists
    html = html.replace(/^\s*\d+\. (.*$)/gim, '<li>$1</li>');

    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

    // Horizontal rule
    html = html.replace(/^---+$/gim, '<hr/>');

    // Tables (simple)
    html = html.replace(/\|(.+?)\|/g, (match, content) => {
      const cells = content.split('|').map(c => c.trim()).filter(Boolean);
      if (cells.length === 0) return match;
      return '<td>' + cells.join('</td><td>') + '</td>';
    });

    // Paragraphs
    html = html.split('\n\n').map(p => {
      p = p.trim();
      if (!p) return '';
      if (p.startsWith('<')) return p;
      return `<p>${p.replace(/\n/g, '<br/>')}</p>`;
    }).join('\n');

    return html;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function highlightCode(code, lang) {
    // Simple regex-based syntax highlighting
    const patterns = {
      js: [
        { regex: /\b(const|let|var|function|return|if|else|for|while|class|import|export|from|async|await|try|catch|throw|new|this|typeof|instanceof)\b/g, class: 'keyword' },
        { regex: /\b(true|false|null|undefined)\b/g, class: 'boolean' },
        { regex: /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, class: 'string' },
        { regex: /\b\d+\b/g, class: 'number' },
        { regex: /\b[A-Z][a-zA-Z0-9]*\b/g, class: 'class' },
        { regex: /\/\/.*/g, class: 'comment' },
        { regex: /\/\*[\s\S]*?\*\//g, class: 'comment' },
      ],
      py: [
        { regex: /\b(def|class|if|elif|else|for|while|return|import|from|as|try|except|raise|with|lambda|and|or|not|in|is|None|True|False)\b/g, class: 'keyword' },
        { regex: /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, class: 'string' },
        { regex: /\b\d+\b/g, class: 'number' },
        { regex: /#.*/g, class: 'comment' },
      ],
      html: [
        { regex: /&lt;\/?[a-zA-Z][^&gt;]*&gt;/g, class: 'tag' },
        { regex: /[a-zA-Z-]+=(?:(?:"[^"]*")|(?:'[^']*'))/g, class: 'attr' },
      ],
      css: [
        { regex: /[a-zA-Z-]+\s*:/g, class: 'property' },
        { regex: /#[a-fA-F0-9]{3,8}\b/g, class: 'color' },
        { regex: /\b\d+(?:px|em|rem|%|vh|vw|pt|pc|in|cm|mm|ex|ch)\b/g, class: 'unit' },
        { regex: /\/\*[\s\S]*?\*\//g, class: 'comment' },
      ],
    };

    const p = patterns[lang] || patterns.js;
    let highlighted = escapeHtml(code);

    // Apply highlighting with non-overlapping matches
    const tokens = [];
    for (const { regex, class: cls } of p) {
      let match;
      const re = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
      while ((match = re.exec(code)) !== null) {
        tokens.push({ start: match.index, end: match.index + match[0].length, class: cls, text: match[0] });
      }
    }

    // Sort and remove overlaps
    tokens.sort((a, b) => a.start - b.start);
    const filtered = [];
    for (const t of tokens) {
      if (!filtered.some(f => t.start < f.end && t.end > f.start)) {
        filtered.push(t);
      }
    }

    // Rebuild
    let result = '';
    let last = 0;
    for (const t of filtered.sort((a, b) => a.start - b.start)) {
      result += escapeHtml(code.slice(last, t.start));
      result += `<span class="hl-${t.class}">${escapeHtml(t.text)}</span>`;
      last = t.end;
    }
    result += escapeHtml(code.slice(last));

    return result || highlighted;
  }

  // ============================================
  // Message Actions
  // ============================================
  function copyMessage(id) {
    const msg = state.messages.find(m => m.id === id);
    if (!msg) return;
    navigator.clipboard.writeText(msg.content).then(() => {
      toast('Copied to clipboard', 'success');
    });
  }

  function editMessage(id) {
    const msg = state.messages.find(m => m.id === id);
    if (!msg || msg.role !== 'user') return;
    const newContent = prompt('Edit message:', msg.content);
    if (newContent && newContent !== msg.content) {
      msg.content = newContent;
      renderMessages();
      // Re-send
      sendMessage(newContent);
    }
  }

  async function deleteMessage(id) {
    try {
      await api(`/chat/conversations/${state.currentConversationId}/messages/${id}`, {
        method: 'DELETE',
      });
      state.messages = state.messages.filter(m => m.id !== id);
      renderMessages();
    } catch (err) {
      toast('Failed to delete message', 'error');
    }
  }

  async function regenerateMessage(id) {
    const idx = state.messages.findIndex(m => m.id === id);
    if (idx < 0) return;
    // Find the preceding user message
    let userIdx = idx - 1;
    while (userIdx >= 0 && state.messages[userIdx].role !== 'user') userIdx--;
    if (userIdx < 0) return;

    const userContent = state.messages[userIdx].content;
    // Remove the assistant message
    state.messages = state.messages.slice(0, idx);
    renderMessages();
    await sendMessage(userContent);
  }

  // ============================================
  // Voice — Text to Speech (Server-side)
  // ============================================
  async function speak(text) {
    if (state.settings.ttsProvider === 'disabled') return;
    if (state.voice.isSpeaking) {
      stopSpeaking();
    }

    state.voice.isSpeaking = true;
    updateVoiceOrb();

    try {
      const res = await api('/voice/tts', {
        method: 'POST',
        body: {
          text: text.slice(0, 4000),
          voiceId: state.settings.voiceId,
          speed: state.settings.voiceSpeed,
          provider: state.settings.ttsProvider,
        },
      });

      // res is a Response object from fetch when not JSON
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.volume = state.settings.voiceVolume;

      state.voice.audioPlayer = audio;

      audio.addEventListener('ended', () => {
        state.voice.isSpeaking = false;
        updateVoiceOrb();
        URL.revokeObjectURL(url);
        // Hands-free: auto-listen after speaking
        if (state.settings.handsFree && !state.voice.isListening) {
          startListening();
        }
      });

      audio.addEventListener('error', () => {
        state.voice.isSpeaking = false;
        updateVoiceOrb();
        toast('Voice playback failed', 'error');
      });

      await audio.play();
    } catch (err) {
      state.voice.isSpeaking = false;
      updateVoiceOrb();
      console.error('TTS error:', err);
      // Fallback: browser speech synthesis
      if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = state.settings.voiceSpeed;
        utterance.volume = state.settings.voiceVolume;
        utterance.onend = () => {
          state.voice.isSpeaking = false;
          updateVoiceOrb();
          if (state.settings.handsFree && !state.voice.isListening) {
            startListening();
          }
        };
        window.speechSynthesis.speak(utterance);
      }
    }
  }

  function stopSpeaking() {
    if (state.voice.audioPlayer) {
      state.voice.audioPlayer.pause();
      state.voice.audioPlayer = null;
    }
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    state.voice.isSpeaking = false;
    updateVoiceOrb();
  }

  // ============================================
  // Voice — Speech to Text (Web Speech API)
  // ============================================
  function initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('Web Speech API not supported');
      return false;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = state.settings.language === 'auto' ? 'en-US' : state.settings.language;

    recognition.onstart = () => {
      state.voice.isListening = true;
      updateVoiceOrb();
      showVoiceHUD();
    };

    recognition.onresult = (event) => {
      let final = '';
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += transcript + ' ';
        } else {
          interim += transcript;
        }
      }
      if (final.trim()) {
        $('#chat-input').value = final.trim();
      } else if (interim) {
        $('#chat-input').value = interim;
      }
    };

    recognition.onerror = (event) => {
      if (event.error === 'no-speech') return;
      console.error('Speech recognition error:', event.error);
      toast(`Voice error: ${event.error}`, 'error');
      stopListening();
    };

    recognition.onend = () => {
      if (state.voice.isListening) {
        // Auto-restart if still in listening mode (hands-free)
        try { recognition.start(); } catch(e) {}
      } else {
        hideVoiceHUD();
        const text = $('#chat-input').value.trim();
        if (text) {
          sendMessage(text);
        }
      }
    };

    state.voice.recognition = recognition;
    return true;
  }

  function startListening() {
    if (state.voice.isListening) return;
    if (!state.voice.recognition) {
      if (!initSpeechRecognition()) {
        toast('Voice input not supported in this browser', 'warning');
        return;
      }
    }
    try {
      state.voice.recognition.start();
    } catch (e) {
      toast('Could not start microphone', 'error');
    }
  }

  function stopListening() {
    state.voice.isListening = false;
    if (state.voice.recognition) {
      try { state.voice.recognition.stop(); } catch(e) {}
    }
    updateVoiceOrb();
    hideVoiceHUD();
  }

  function toggleListening() {
    if (state.voice.isListening) {
      stopListening();
    } else {
      startListening();
    }
  }

  // ============================================
  // Voice HUD
  // ============================================
  function showVoiceHUD() {
    $('#voice-hud').classList.add('active');
    $('#voice-status').textContent = state.voice.isSpeaking ? 'Speaking...' : 'Listening...';
    $('#voice-substatus').textContent = state.voice.isSpeaking
      ? 'Spider AI is responding'
      : 'Say something or press space to stop';
    initWaveform();
  }

  function hideVoiceHUD() {
    $('#voice-hud').classList.remove('active');
    stopWaveform();
  }

  function updateVoiceOrb() {
    const orb = $('#voice-orb');
    orb.classList.remove('speaking', 'listening');
    if (state.voice.isSpeaking) {
      orb.classList.add('speaking');
      $('#voice-status').textContent = 'Speaking...';
    } else if (state.voice.isListening) {
      orb.classList.add('listening');
      $('#voice-status').textContent = 'Listening...';
    }
  }

  // ============================================
  // Waveform Visualization
  // ============================================
  let waveformInterval = null;

  function initWaveform() {
    const container = $('#waveform');
    container.innerHTML = '';
    const barCount = 40;
    for (let i = 0; i < barCount; i++) {
      const bar = document.createElement('div');
      bar.className = 'waveform-bar';
      bar.style.height = '4px';
      container.appendChild(bar);
    }

    // Try to get real microphone data
    if (!state.voice.audioContext) {
      navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
          state.voice.mediaStream = stream;
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          const source = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);
          state.voice.audioContext = ctx;
          state.voice.analyser = analyser;
        })
        .catch(() => {
          // Fallback: animated bars
        });
    }

    waveformInterval = setInterval(() => {
      const bars = container.querySelectorAll('.waveform-bar');
      if (state.voice.analyser && state.voice.isListening) {
        const data = new Uint8Array(state.voice.analyser.frequencyBinCount);
        state.voice.analyser.getByteFrequencyData(data);
        const step = Math.floor(data.length / bars.length);
        bars.forEach((bar, i) => {
          const val = data[i * step] || 0;
          const height = Math.max(4, (val / 255) * 60);
          bar.style.height = `${height}px`;
        });
      } else if (state.voice.isSpeaking) {
        // Simulate speaking waveform
        bars.forEach(bar => {
          const height = 4 + Math.random() * 40;
          bar.style.height = `${height}px`;
        });
      } else {
        bars.forEach(bar => {
          bar.style.height = '4px';
        });
      }
    }, 50);
  }

  function stopWaveform() {
    if (waveformInterval) {
      clearInterval(waveformInterval);
      waveformInterval = null;
    }
    if (state.voice.mediaStream) {
      state.voice.mediaStream.getTracks().forEach(t => t.stop());
      state.voice.mediaStream = null;
    }
    if (state.voice.audioContext) {
      state.voice.audioContext.close();
      state.voice.audioContext = null;
      state.voice.analyser = null;
    }
  }

  // ============================================
  // Settings
  // ============================================
  function loadSettings() {
    const saved = localStorage.getItem('spider_settings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        Object.assign(state.settings, parsed);
      } catch (e) {}
    }
    applySettings();
  }

  function saveSettings() {
    localStorage.setItem('spider_settings', JSON.stringify(state.settings));
    // Also sync to server
    api('/settings', {
      method: 'PUT',
      body: {
        theme: state.settings.theme,
        accent_color: state.settings.accentColor,
        voice_tts_provider: state.settings.ttsProvider,
        voice_tts_voice_id: state.settings.voiceId,
        voice_speed: state.settings.voiceSpeed,
        voice_volume: state.settings.voiceVolume,
        mic_sensitivity: state.settings.micSensitivity,
        language: state.settings.language,
        notifications_enabled: state.settings.notifications ? 1 : 0,
      },
    }).catch(() => {});
  }

  function applySettings() {
    // Theme
    const theme = state.settings.theme;
    if (theme === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
    document.documentElement.style.setProperty('--accent-primary', state.settings.accentColor);

    // Update UI controls
    $('#setting-theme').value = state.settings.theme;
    $('#setting-accent').value = state.settings.accentColor;
    $('#setting-tts-provider').value = state.settings.ttsProvider;
    $('#setting-voice-speed').value = state.settings.voiceSpeed;
    $('#voice-speed-value').textContent = state.settings.voiceSpeed + 'x';
    $('#setting-voice-volume').value = state.settings.voiceVolume;
    $('#voice-volume-value').textContent = Math.round(state.settings.voiceVolume * 100) + '%';
    $('#setting-mic-sens').value = state.settings.micSensitivity;
    $('#mic-sens-value').textContent = Math.round(state.settings.micSensitivity * 100) + '%';
    $('#setting-language').value = state.settings.language;
    $('#setting-handsfree').classList.toggle('active', state.settings.handsFree);
    $('#setting-notifications').classList.toggle('active', state.settings.notifications);

    // Update voice list based on provider
    updateVoiceList();

    // Update theme icon
    updateThemeIcon();
  }

  function updateVoiceList() {
    const select = $('#setting-voice');
    const voices = state.settings.ttsProvider === 'elevenlabs'
      ? [
          { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel' },
          { id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi' },
          { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella' },
          { id: 'ErXwobaYiN019PkySvjV', name: 'Antoni' },
          { id: 'MF3mGyEYCl7XYWbV9V6O', name: 'Elli' },
          { id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh' },
          { id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold' },
          { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam' },
        ]
      : [
          { id: 'alloy', name: 'Alloy' },
          { id: 'echo', name: 'Echo' },
          { id: 'fable', name: 'Fable' },
          { id: 'onyx', name: 'Onyx' },
          { id: 'nova', name: 'Nova' },
          { id: 'shimmer', name: 'Shimmer' },
        ];

    select.innerHTML = voices.map(v =>
      `<option value="${v.id}" ${state.settings.voiceId === v.id ? 'selected' : ''}>${v.name}</option>`
    ).join('');
    if (!state.settings.voiceId && voices.length > 0) {
      state.settings.voiceId = voices[0].id;
    }
  }

  function updateThemeIcon() {
    const theme = document.documentElement.getAttribute('data-theme');
    const icon = $('#theme-icon');
    if (theme === 'light') {
      icon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
    } else {
      icon.innerHTML = '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
    }
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    state.settings.theme = next;
    applySettings();
    saveSettings();
  }

  function openSettings() {
    $('#settings-modal').classList.add('active');
    updateVoiceList();
  }

  function closeSettings() {
    $('#settings-modal').classList.remove('active');
  }

  // ============================================
  // Renderers
  // ============================================
  function renderConversations() {
    const list = $('#conversations-list');
    const search = ($('#conv-search').value || '').toLowerCase();
    const filtered = state.conversations.filter(c =>
      (c.title || '').toLowerCase().includes(search)
    );

    list.innerHTML = filtered.map(conv => `
      <div class="conversation-item ${conv.id === state.currentConversationId ? 'active' : ''}"
           data-id="${conv.id}">
        <div class="conv-icon">💬</div>
        <div class="conv-info">
          <div class="conv-title">${escapeHtml(conv.title || 'New chat')}</div>
          <div class="conv-date">${formatDate(conv.updated_at)}</div>
        </div>
        <div class="conv-actions">
          <button class="conv-rename" title="Rename">✏️</button>
          <button class="conv-delete" title="Delete">🗑️</button>
        </div>
      </div>
    `).join('');

    // Attach listeners
    list.querySelectorAll('.conversation-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.conv-actions')) return;
        selectConversation(Number(item.dataset.id));
      });
    });
    list.querySelectorAll('.conv-rename').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = Number(btn.closest('.conversation-item').dataset.id);
        const conv = state.conversations.find(c => c.id === id);
        const newTitle = prompt('Rename conversation:', conv?.title || 'New chat');
        if (newTitle) renameConversation(id, newTitle);
      });
    });
    list.querySelectorAll('.conv-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = Number(btn.closest('.conversation-item').dataset.id);
        if (confirm('Delete this conversation?')) deleteConversation(id);
      });
    });
  }

  function renderMessages() {
    const container = $('#messages-container');
    if (state.messages.length === 0) {
      showWelcome();
      return;
    }

    container.innerHTML = state.messages.map(msg => `
      <div class="message ${msg.role}" data-id="${msg.id}">
        <div class="message-avatar">
          ${msg.role === 'user'
            ? (state.user?.name || state.user?.email || 'U').charAt(0).toUpperCase()
            : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>'
          }
        </div>
        <div>
          <div class="message-content">${renderMarkdown(msg.content)}</div>
          <div class="message-actions">
            <button onclick="window.spiderApp.copyMessage(${msg.id})" title="Copy">📋 Copy</button>
            ${msg.role === 'user' ? `<button onclick="window.spiderApp.editMessage(${msg.id})" title="Edit">✏️ Edit</button>` : ''}
            ${msg.role === 'assistant' ? `<button onclick="window.spiderApp.regenerateMessage(${msg.id})" title="Regenerate">🔄 Regenerate</button>` : ''}
            <button onclick="window.spiderApp.deleteMessage(${msg.id})" title="Delete">🗑️ Delete</button>
          </div>
        </div>
      </div>
    `).join('');

    scrollToBottom();
  }

  function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
    return d.toLocaleDateString();
  }

  function updateSendButton() {
    const btn = $('#send-btn');
    btn.disabled = state.isLoading;
    btn.innerHTML = state.isLoading
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';
  }

  // ============================================
  // Toast Notifications
  // ============================================
  function toast(message, type = 'info', duration = 4000) {
    if (!state.settings.notifications) return;
    const container = $('#toast-container');
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.innerHTML = `
      <span>${escapeHtml(message)}</span>
    `;
    container.appendChild(el);

    setTimeout(() => {
      el.classList.add('toast-exit');
      setTimeout(() => el.remove(), 300);
    }, duration);
  }

  // ============================================
  // Particles
  // ============================================
  function initParticles() {
    const canvas = $('#particle-canvas');
    const ctx = canvas.getContext('2d');
    let width, height;

    function resize() {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    const particleCount = Math.min(50, Math.floor(window.innerWidth / 30));
    state.particles = [];
    for (let i = 0; i < particleCount; i++) {
      state.particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        radius: Math.random() * 2 + 0.5,
        opacity: Math.random() * 0.5 + 0.1,
      });
    }

    function animate() {
      ctx.clearRect(0, 0, width, height);
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent-primary').trim() || '#00d4ff';

      state.particles.forEach((p, i) => {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > width) p.vx *= -1;
        if (p.y < 0 || p.y > height) p.vy *= -1;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = accent;
        ctx.globalAlpha = p.opacity;
        ctx.fill();

        // Connect nearby particles
        for (let j = i + 1; j < state.particles.length; j++) {
          const p2 = state.particles[j];
          const dx = p.x - p2.x;
          const dy = p.y - p2.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 120) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.strokeStyle = accent;
            ctx.globalAlpha = (1 - dist / 120) * 0.15;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      });

      ctx.globalAlpha = 1;
      requestAnimationFrame(animate);
    }
    animate();
  }

  // ============================================
  // Event Listeners
  // ============================================
  function attachEventListeners() {
    // Auth forms
    $('#login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      $('#auth-error').classList.remove('visible');
      try {
        await login($('#login-email').value, $('#login-password').value);
      } catch (err) {
        $('#auth-error').textContent = err.message;
        $('#auth-error').classList.add('visible');
      }
    });

    $('#register-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      $('#auth-error').classList.remove('visible');
      try {
        await register($('#reg-name').value, $('#reg-email').value, $('#reg-password').value);
      } catch (err) {
        $('#auth-error').textContent = err.message;
        $('#auth-error').classList.add('visible');
      }
    });

    $('#show-register').addEventListener('click', () => {
      $('#auth-form-container').style.display = 'none';
      $('#register-form-container').style.display = 'block';
      $('#auth-error').classList.remove('visible');
    });

    $('#show-login').addEventListener('click', () => {
      $('#register-form-container').style.display = 'none';
      $('#auth-form-container').style.display = 'block';
      $('#auth-error').classList.remove('visible');
    });

    // Chat input
    const input = $('#chat-input');
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 200) + 'px';
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage(input.value);
      }
    });

    $('#send-btn').addEventListener('click', () => sendMessage(input.value));

    // Voice button (push-to-talk)
    const voiceBtn = $('#voice-btn');
    let spacePressed = false;

    voiceBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (!state.voice.isListening) startListening();
    });
    voiceBtn.addEventListener('mouseup', () => {
      if (state.voice.isListening) stopListening();
    });
    voiceBtn.addEventListener('mouseleave', () => {
      if (state.voice.isListening) stopListening();
    });
    voiceBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (!state.voice.isListening) startListening();
    });
    voiceBtn.addEventListener('touchend', () => {
      if (state.voice.isListening) stopListening();
    });

    // Space bar push-to-talk
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !spacePressed && document.activeElement !== input && !e.repeat) {
        spacePressed = true;
        e.preventDefault();
        if (!state.voice.isListening) startListening();
      }
    });
    document.addEventListener('keyup', (e) => {
      if (e.code === 'Space' && spacePressed) {
        spacePressed = false;
        if (state.voice.isListening) stopListening();
      }
    });

    // Voice HUD controls
    $('#voice-stop-btn').addEventListener('click', () => {
      if (state.voice.isSpeaking) stopSpeaking();
      if (state.voice.isListening) stopListening();
    });
    $('#voice-cancel-btn').addEventListener('click', () => {
      stopSpeaking();
      stopListening();
      $('#chat-input').value = '';
    });

    // Voice toggle button (hands-free mode switch)
    $('#voice-toggle-btn').addEventListener('click', () => {
      state.settings.handsFree = !state.settings.handsFree;
      saveSettings();
      toast(state.settings.handsFree ? 'Hands-free mode enabled' : 'Hands-free mode disabled', 'info');
    });

    // Sidebar
    $('#new-chat-btn').addEventListener('click', () => {
      state.currentConversationId = null;
      state.messages = [];
      showWelcome();
      renderConversations();
      input.focus();
    });

    $('#menu-toggle').addEventListener('click', () => {
      $('#sidebar').classList.toggle('open');
      $('#sidebar-backdrop').classList.toggle('active');
    });

    $('#sidebar-backdrop').addEventListener('click', () => {
      $('#sidebar').classList.remove('open');
      $('#sidebar-backdrop').classList.remove('active');
    });

    $('#conv-search').addEventListener('input', renderConversations);

    // Settings
    $('#settings-btn').addEventListener('click', openSettings);
    $('#settings-close').addEventListener('click', closeSettings);
    $('#settings-modal').addEventListener('click', (e) => {
      if (e.target === $('#settings-modal')) closeSettings();
    });

    // Theme toggle
    $('#theme-toggle-btn').addEventListener('click', toggleTheme);

    // Logout
    $('#logout-btn').addEventListener('click', logout);

    // Settings controls
    $('#setting-theme').addEventListener('change', (e) => {
      state.settings.theme = e.target.value;
      applySettings();
      saveSettings();
    });

    $('#setting-accent').addEventListener('input', (e) => {
      state.settings.accentColor = e.target.value;
      applySettings();
      saveSettings();
    });

    $('#setting-tts-provider').addEventListener('change', (e) => {
      state.settings.ttsProvider = e.target.value;
      updateVoiceList();
      saveSettings();
    });

    $('#setting-voice').addEventListener('change', (e) => {
      state.settings.voiceId = e.target.value;
      saveSettings();
    });

    $('#setting-voice-speed').addEventListener('input', (e) => {
      state.settings.voiceSpeed = parseFloat(e.target.value);
      $('#voice-speed-value').textContent = state.settings.voiceSpeed + 'x';
      saveSettings();
    });

    $('#setting-voice-volume').addEventListener('input', (e) => {
      state.settings.voiceVolume = parseFloat(e.target.value);
      $('#voice-volume-value').textContent = Math.round(state.settings.voiceVolume * 100) + '%';
      if (state.voice.audioPlayer) {
        state.voice.audioPlayer.volume = state.settings.voiceVolume;
      }
      saveSettings();
    });

    $('#setting-mic-sens').addEventListener('input', (e) => {
      state.settings.micSensitivity = parseFloat(e.target.value);
      $('#mic-sens-value').textContent = Math.round(state.settings.micSensitivity * 100) + '%';
      saveSettings();
    });

    $('#setting-language').addEventListener('change', (e) => {
      state.settings.language = e.target.value;
      if (state.voice.recognition) {
        state.voice.recognition.lang = state.settings.language === 'auto' ? 'en-US' : state.settings.language;
      }
      saveSettings();
    });

    $('#setting-handsfree').addEventListener('click', () => {
      state.settings.handsFree = !state.settings.handsFree;
      $('#setting-handsfree').classList.toggle('active');
      saveSettings();
    });

    $('#setting-notifications').addEventListener('click', () => {
      state.settings.notifications = !state.settings.notifications;
      $('#setting-notifications').classList.toggle('active');
      saveSettings();
    });

    // Export/Import settings
    $('#export-settings-btn').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(state.settings, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'spider-ai-settings.json';
      a.click();
      URL.revokeObjectURL(url);
      toast('Settings exported', 'success');
    });

    $('#import-settings-btn').addEventListener('click', () => {
      $('#import-settings-file').click();
    });

    $('#import-settings-file').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const parsed = JSON.parse(ev.target.result);
          Object.assign(state.settings, parsed);
          applySettings();
          saveSettings();
          toast('Settings imported', 'success');
        } catch (err) {
          toast('Invalid settings file', 'error');
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    });

    $('#clear-data-btn').addEventListener('click', () => {
      if (confirm('Clear all local data? This cannot be undone.')) {
        localStorage.removeItem('spider_settings');
        localStorage.removeItem('spider_token');
        toast('Local data cleared', 'info');
        location.reload();
      }
    });

    // Drag & drop file upload
    const inputWrapper = $('#input-wrapper');
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      inputWrapper.addEventListener(eventName, preventDefaults, false);
      document.body.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }

    inputWrapper.addEventListener('dragenter', () => inputWrapper.classList.add('drag-over'));
    inputWrapper.addEventListener('dragleave', () => inputWrapper.classList.remove('drag-over'));
    inputWrapper.addEventListener('drop', (e) => {
      inputWrapper.classList.remove('drag-over');
      const files = e.dataTransfer.files;
      handleFiles(files);
    });

    $('#attach-btn').addEventListener('click', () => $('#file-input').click());
    $('#file-input').addEventListener('change', (e) => handleFiles(e.target.files));

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Focus input with /
      if (e.key === '/' && document.activeElement !== input && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        input.focus();
      }
      // New chat Ctrl+N
      if (e.key === 'n' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        $('#new-chat-btn').click();
      }
      // Settings Ctrl+,
      if (e.key === ',' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        openSettings();
      }
      // Theme toggle Ctrl+Shift+L
      if (e.key === 'L' && e.shiftKey && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        toggleTheme();
      }
      // Escape to close modals
      if (e.key === 'Escape') {
        closeSettings();
        if (state.voice.isListening || state.voice.isSpeaking) {
          stopSpeaking();
          stopListening();
        }
      }
    });

    // System theme change listener
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (state.settings.theme === 'system') {
        document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
        updateThemeIcon();
      }
    });
  }

  function attachWelcomeListeners() {
    document.querySelectorAll('.shortcut-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        $('#chat-input').value = chip.dataset.prompt;
        sendMessage(chip.dataset.prompt);
      });
    });
  }

  function handleFiles(files) {
    if (!files.length) return;
    Array.from(files).forEach(file => {
      if (file.size > CONFIG.MAX_FILE_SIZE) {
        toast(`File too large: ${file.name}`, 'error');
        return;
      }
      // For images, show preview and mention in chat
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e) => {
          const msg = `[Image uploaded: ${file.name}]\n\n![${file.name}](${e.target.result})`;
          sendMessage(msg);
        };
        reader.readAsDataURL(file);
      } else {
        const reader = new FileReader();
        reader.onload = (e) => {
          const content = e.target.result;
          const msg = `[File uploaded: ${file.name}]\n\n\`\`\`${file.name.split('.').pop()}\n${content.slice(0, 5000)}\n\`\`\``;
          sendMessage(msg);
        };
        reader.readAsText(file);
      }
    });
  }

  // ============================================
  // PWA & Service Worker
  // ============================================
  function initPWA() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }

  // ============================================
  // Initialization
  // ============================================
  function init() {
    attachEventListeners();
    initParticles();
    initPWA();
    initAuth();

    // Hide loading after a brief moment
    setTimeout(() => {
      $('#loading-screen').classList.add('hidden');
    }, 800);
  }

  // Expose API for inline handlers
  window.spiderApp = {
    copyMessage,
    editMessage,
    deleteMessage,
    regenerateMessage,
  };

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
