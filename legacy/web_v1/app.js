(() => {
  const EVENTS = {
    CLIENT: {
      REGISTER: 'client:register',
      SEND_ROOM_TEXT: 'client:send-room-text',
      SEND_ROOM_MEDIA: 'client:send-room-media',
      SEND_DM_TEXT: 'client:send-dm-text',
      JOIN_ROOM: 'client:join-room',
      LEAVE_ROOM: 'client:leave-room',
      OTP_CONFIRM: 'client:otp-confirm'
    },
    SERVER: {
      REGISTERED: 'server:registered',
      USER_JOINED: 'server:user-joined',
      USER_LEFT: 'server:user-left',
      ROOM_MESSAGE: 'server:room-message',
      ROOM_MEDIA: 'server:room-media',
      DIRECT_MESSAGE: 'server:direct-message',
      SYSTEM: 'server:system',
      OTP_CONFIRM_REQUEST: 'server:otp-confirm-request',
      USER_LIST: 'server:user-list',
      ROOM_LIST: 'server:room-list'
    }
  };

  const el = {
    loginCard: document.getElementById('loginCard'),
    chatShell: document.getElementById('chatShell'),
    loginForm: document.getElementById('loginForm'),
    username: document.getElementById('username'),
    password: document.getElementById('password'),
    authSubmitBtn: document.getElementById('authSubmitBtn'),
    authToggleBtn: document.getElementById('authToggleBtn'),
    authStatus: document.getElementById('authStatus'),
    welcomeText: document.getElementById('welcomeText'),
    activeRoomLabel: document.getElementById('activeRoomLabel'),
    messages: document.getElementById('messages'),
    userList: document.getElementById('userList'),
    roomList: document.getElementById('roomList'),
    roomInput: document.getElementById('roomInput'),
    joinBtn: document.getElementById('joinBtn'),
    leaveBtn: document.getElementById('leaveBtn'),
    setRoomBtn: document.getElementById('setRoomBtn'),
    dmForm: document.getElementById('dmForm'),
    dmUser: document.getElementById('dmUser'),
    dmText: document.getElementById('dmText'),
    messageForm: document.getElementById('messageForm'),
    messageInput: document.getElementById('messageInput'),
    fileForm: document.getElementById('fileForm'),
    fileRoom: document.getElementById('fileRoom'),
    fileInput: document.getElementById('fileInput'),
    confirmForm: document.getElementById('confirmForm'),
    confirmId: document.getElementById('confirmId'),
    confirmDecision: document.getElementById('confirmDecision'),
    serverHint: document.getElementById('serverHint')
  };

  let socket = null;
  let currentRoom = 'lobby';
  let isLoginMode = true;
  const STORAGE = {
    username: 'chatpata_auth_username',
    token: 'chatpata_auth_token'
  };

  el.serverHint.textContent = window.location.origin;

  function ts(value) {
    return new Date(value || Date.now()).toLocaleTimeString();
  }

  function setActiveRoom(room) {
    currentRoom = room;
    el.activeRoomLabel.textContent = `Active room: ${room}`;
    if (!el.fileRoom.value) el.fileRoom.value = room;
  }

  function addMessage(meta, text, type = '') {
    const row = document.createElement('div');
    row.className = `msg ${type}`.trim();
    row.innerHTML = `<div class="meta">${meta}</div><div>${text}</div>`;
    el.messages.appendChild(row);
    el.messages.scrollTop = el.messages.scrollHeight;
  }

  function escapeHtml(text) {
    return String(text)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function setAuthStatus(text, isError = false) {
    el.authStatus.textContent = text;
    el.authStatus.style.color = isError ? 'var(--danger)' : 'var(--muted)';
  }

  function setAuthMode(loginMode) {
    isLoginMode = loginMode;
    el.authSubmitBtn.textContent = isLoginMode ? 'Login & Connect' : 'Register';
    el.authToggleBtn.textContent = isLoginMode ? 'Need an account? Register' : 'Have an account? Login';
  }

  async function authRequest(path, body) {
    const resp = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const payload = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(payload.error || 'Auth request failed.');
    }
    return payload;
  }

  function connect(username, token = '') {
    socket = io();

    socket.on('connect', () => {
      addMessage(`[${ts()}] system`, 'Connected to server.', 'system');
      socket.emit(EVENTS.CLIENT.REGISTER, { username, token });
    });

    socket.on(EVENTS.SERVER.REGISTERED, (payload) => {
      el.loginCard.classList.add('hidden');
      el.chatShell.classList.remove('hidden');
      el.welcomeText.textContent = `Welcome, ${payload.username}`;
      setActiveRoom(payload.defaultRoom || 'lobby');
      addMessage(`[${ts(payload.ts)}] system`, `Registered as ${payload.username}.`, 'system');
    });

    socket.on(EVENTS.SERVER.SYSTEM, (msg) => {
      addMessage(`[${ts(msg.ts)}] system`, escapeHtml(msg.message), 'system');

      if (String(msg.message || '').startsWith('Registration failed')) {
        setAuthStatus(msg.message, true);
        socket.disconnect();
      }
    });

    socket.on(EVENTS.SERVER.USER_JOINED, (evt) => {
      addMessage(`[${ts(evt.ts)}] room:${evt.room}`, `${escapeHtml(evt.username)} joined`, 'system');
    });

    socket.on(EVENTS.SERVER.USER_LEFT, (evt) => {
      addMessage(`[${ts(evt.ts)}] disconnect`, `${escapeHtml(evt.username)} left`, 'system');
    });

    socket.on(EVENTS.SERVER.ROOM_MESSAGE, (msg) => {
      const suffix = msg.privacyConfirmed ? ' (privacy-confirmed)' : '';
      addMessage(
        `[${ts(msg.ts)}] [${escapeHtml(msg.room)}] ${escapeHtml(msg.from)}`,
        `${escapeHtml(msg.text)}${suffix}`
      );
    });

    socket.on(EVENTS.SERVER.ROOM_MEDIA, (msg) => {
      const bytes = atob(msg.media.base64 || '').length;
      addMessage(
        `[${ts(msg.ts)}] [${escapeHtml(msg.room)}] ${escapeHtml(msg.from)}`,
        `Media: ${escapeHtml(msg.media.name)} (${escapeHtml(msg.media.mimeType)}, ${bytes} bytes)`
      );
    });

    socket.on(EVENTS.SERVER.DIRECT_MESSAGE, (dm) => {
      addMessage(
        `[${ts(dm.ts)}] DM ${escapeHtml(dm.from)} -> ${escapeHtml(dm.to)}`,
        escapeHtml(dm.text)
      );
    });

    socket.on(EVENTS.SERVER.OTP_CONFIRM_REQUEST, (req) => {
      el.confirmId.value = req.requestId;
      addMessage(`[${ts(req.ts)}] privacy-check`, `${escapeHtml(req.prompt)} ID=${escapeHtml(req.requestId)}`, 'error');
    });

    socket.on(EVENTS.SERVER.USER_LIST, (users) => {
      el.userList.innerHTML = '';
      (Array.isArray(users) ? users : []).forEach((u) => {
        const li = document.createElement('li');
        li.textContent = u;
        el.userList.appendChild(li);
      });
    });

    socket.on(EVENTS.SERVER.ROOM_LIST, (rooms) => {
      el.roomList.innerHTML = '';
      (Array.isArray(rooms) ? rooms : []).forEach((r) => {
        const li = document.createElement('li');
        li.textContent = `${r.name} (${r.members})`;
        el.roomList.appendChild(li);
      });
    });

    socket.on('disconnect', () => {
      addMessage(`[${ts()}] system`, 'Disconnected from server.', 'error');
    });
  }

  async function handleAuthSubmit() {
    const username = el.username.value.trim();
    const password = el.password.value.trim();
    if (!username || !password) {
      setAuthStatus('Username and password are required.', true);
      return;
    }

    try {
      if (isLoginMode) {
        const data = await authRequest('/api/auth/login', { username, password });
        localStorage.setItem(STORAGE.username, data.username);
        localStorage.setItem(STORAGE.token, data.token);
        setAuthStatus('Login successful. Connecting...');
        connect(data.username, data.token);
      } else {
        await authRequest('/api/auth/register', { username, password });
        setAuthMode(true);
        setAuthStatus('Registration successful. Please login now.');
      }
    } catch (err) {
      setAuthStatus(err.message || 'Authentication failed.', true);
    }
  }

  el.loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await handleAuthSubmit();
  });

  el.authToggleBtn.addEventListener('click', () => {
    setAuthMode(!isLoginMode);
    setAuthStatus(isLoginMode ? 'Use your account to continue.' : 'Create a new account.');
  });

  el.joinBtn.addEventListener('click', () => {
    const room = el.roomInput.value.trim().toLowerCase();
    if (!room || !socket) return;
    socket.emit(EVENTS.CLIENT.JOIN_ROOM, { room });
    setActiveRoom(room);
  });

  el.leaveBtn.addEventListener('click', () => {
    const room = el.roomInput.value.trim().toLowerCase();
    if (!room || !socket) return;
    socket.emit(EVENTS.CLIENT.LEAVE_ROOM, { room });
    if (currentRoom === room) setActiveRoom('lobby');
  });

  el.setRoomBtn.addEventListener('click', () => {
    const room = el.roomInput.value.trim().toLowerCase();
    if (!room) return;
    setActiveRoom(room);
  });

  el.messageForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!socket) return;
    const text = el.messageInput.value.trim();
    if (!text) return;
    socket.emit(EVENTS.CLIENT.SEND_ROOM_TEXT, { room: currentRoom, text });
    el.messageInput.value = '';
  });

  el.dmForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!socket) return;
    const to = el.dmUser.value.trim();
    const text = el.dmText.value.trim();
    if (!to || !text) return;
    socket.emit(EVENTS.CLIENT.SEND_DM_TEXT, { to, text });
    el.dmText.value = '';
  });

  el.fileForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!socket) return;
    const room = (el.fileRoom.value.trim() || currentRoom).toLowerCase();
    const file = el.fileInput.files[0];
    if (!file || !room) return;

    const base64 = await file.arrayBuffer().then((buf) => {
      let binary = '';
      const bytes = new Uint8Array(buf);
      bytes.forEach((b) => {
        binary += String.fromCharCode(b);
      });
      return btoa(binary);
    });

    socket.emit(EVENTS.CLIENT.SEND_ROOM_MEDIA, {
      room,
      media: {
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        base64
      }
    });

    el.fileInput.value = '';
  });

  el.confirmForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!socket) return;
    const requestId = el.confirmId.value.trim();
    const decision = el.confirmDecision.value;
    if (!requestId) return;
    socket.emit(EVENTS.CLIENT.OTP_CONFIRM, {
      requestId,
      approve: decision === 'yes'
    });
  });

  setAuthMode(true);
  const savedUsername = localStorage.getItem(STORAGE.username);
  const savedToken = localStorage.getItem(STORAGE.token);
  if (savedUsername && savedToken) {
    el.username.value = savedUsername;
    setAuthStatus('Using saved login session...');
    connect(savedUsername, savedToken);
  }
})();
