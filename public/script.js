const socket = io();

let currentMode = null; // Removed global default
let currentRoom = "";
let currentPrivateUser = "";
let unreadCounts = {};
let isLoginMode = true;

const STORAGE_KEY_USER = "chat_app_username";
const STORAGE_KEY_GROUP_PREFIX = "chat_history_group_";

let typingTimeout = null;
let isTyping = false;
const activeTypingUsers = new Set();

// --- INITIALIZATION & AUTH SESSION MANAGEMENT ---
window.onload = () => {
  checkAuthSession();

  // Set blank state until user selects a chat
  document.getElementById("active-chat-title").innerText =
    "Select a chat to start messaging";
  document.getElementById("chat-window").innerHTML = "";
};

async function checkAuthSession() {
  const token = localStorage.getItem("chat_app_token");

  if (!token) {
    showAuthModal();
    return;
  }

  try {
    const res = await fetch("/me", {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();

    if (res.ok && data.username) {
      localStorage.setItem(STORAGE_KEY_USER, data.username);
      setupLoggedInUser(data.username, token);
    } else {
      // Token invalid or expired
      clearUserSession();
      showAuthModal();
    }
  } catch (err) {
    console.error("Auth check failed:", err);
    const savedUser = localStorage.getItem(STORAGE_KEY_USER);
    if (savedUser) {
      setupLoggedInUser(savedUser, token);
    } else {
      showAuthModal();
    }
  }
}

function setupLoggedInUser(username, token) {
  document.getElementById("auth-modal").style.display = "none";
  
  // Show User Profile Bar in Sidebar
  const profileBar = document.getElementById("user-profile-bar");
  const userDisplay = document.getElementById("current-user-display");
  const userAvatar = document.getElementById("user-avatar-initial");

  if (profileBar && userDisplay && userAvatar) {
    profileBar.style.display = "flex";
    userDisplay.innerText = username;
    userAvatar.innerText = username.charAt(0).toUpperCase();
  }

  socket.emit("user_connected", { username, token });
  requestNotificationPermission();
}

function showAuthModal() {
  const profileBar = document.getElementById("user-profile-bar");
  if (profileBar) profileBar.style.display = "none";
  document.getElementById("auth-modal").style.display = "flex";
  switchAuthTab(true);
}

function clearUserSession() {
  localStorage.removeItem("chat_app_token");
  localStorage.removeItem(STORAGE_KEY_USER);
}

function logoutUser() {
  if (confirm("Are you sure you want to log out?")) {
    clearUserSession();
    location.reload();
  }
}

// --- AUTH MODAL TAB & FORM HANDLERS ---
function switchAuthTab(isLogin) {
  isLoginMode = isLogin;
  
  const tabLogin = document.getElementById("tab-login");
  const tabRegister = document.getElementById("tab-register");
  const confirmGroup = document.getElementById("confirm-password-group");
  const subtitle = document.getElementById("auth-subtitle");
  const submitBtnSpan = document.querySelector("#auth-action-btn span");
  const alertBox = document.getElementById("auth-error");

  alertBox.className = "auth-alert";
  alertBox.style.display = "none";
  alertBox.innerText = "";

  if (isLogin) {
    tabLogin.classList.add("active");
    tabRegister.classList.remove("active");
    confirmGroup.style.display = "none";
    document.getElementById("auth-confirm-password").required = false;
    subtitle.innerText = "Sign in to your account to continue";
    submitBtnSpan.innerText = "Login";
  } else {
    tabRegister.classList.add("active");
    tabLogin.classList.remove("active");
    confirmGroup.style.display = "block";
    document.getElementById("auth-confirm-password").required = true;
    subtitle.innerText = "Create a new ChatPata account";
    submitBtnSpan.innerText = "Create Account";
  }
}

function togglePasswordVisibility(inputId, iconEl) {
  const input = document.getElementById(inputId);
  if (input.type === "password") {
    input.type = "text";
    iconEl.classList.replace("fa-eye", "fa-eye-slash");
  } else {
    input.type = "password";
    iconEl.classList.replace("fa-eye-slash", "fa-eye");
  }
}

function showAuthAlert(msg, isSuccess = false) {
  const alertBox = document.getElementById("auth-error");
  alertBox.innerText = msg;
  alertBox.className = isSuccess ? "auth-alert success" : "auth-alert error";
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  
  const username = document.getElementById("auth-username").value.trim();
  const password = document.getElementById("auth-password").value.trim();
  const confirmPass = document.getElementById("auth-confirm-password").value.trim();

  if (!username || !password) {
    return showAuthAlert("Please fill in all required fields.");
  }

  if (!isLoginMode) {
    if (username.length < 3) {
      return showAuthAlert("Username must be at least 3 characters long.");
    }
    if (password.length < 6) {
      return showAuthAlert("Password must be at least 6 characters long.");
    }
    if (password !== confirmPass) {
      return showAuthAlert("Passwords do not match. Please re-enter.");
    }
  }

  const endpoint = isLoginMode ? "/login" : "/register";

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();

    if (!res.ok || data.error) {
      showAuthAlert(data.error || "Authentication failed.");
    } else if (!isLoginMode) {
      showAuthAlert("Account created successfully! Please log in.", true);
      setTimeout(() => switchAuthTab(true), 1200);
    } else {
      localStorage.setItem("chat_app_token", data.token);
      localStorage.setItem(STORAGE_KEY_USER, data.username);
      setupLoggedInUser(data.username, data.token);
    }
  } catch (error) {
    showAuthAlert("Server connection error. Please try again.");
  }
}

// 2. REQUEST DESKTOP NOTIFICATION PERMISSION
function requestNotificationPermission() {
  if (
    Notification.permission !== "granted" &&
    Notification.permission !== "denied"
  ) {
    Notification.requestPermission();
  }
}

function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12); // A5
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.22);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.22);
  } catch (e) {}
}

function showNotification(title, body) {
  if (Notification.permission === "granted") {
    new Notification(title, { body: body });
  }
}

function showToastNotification(title, message, iconClass = "fa-bell") {
  playNotificationSound();
  showNotification(title, message);

  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `
    <div style="width: 36px; height: 36px; background: var(--brand-yellow); border-radius: 10px; display: flex; align-items: center; justify-content: center; color: #111; font-size: 1.1rem; flex-shrink: 0;">
      <i class="fas ${iconClass}"></i>
    </div>
    <div style="display: flex; flex-direction: column;">
      <strong style="font-size: 0.88rem; color: #ffde59;">${title}</strong>
      <span style="font-size: 0.82rem; color: #eee; margin-top: 2px;">${message}</span>
    </div>`;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(-10px)";
    toast.style.transition = "all 0.3s ease";
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// --- DYNAMIC ROOM LOADING ---
socket.on("load_rooms", (rooms) => {
  const list = document.getElementById("dynamic-groups");
  if (list) list.innerHTML = "";
  rooms.forEach((room) => renderRoomInSidebar(room));
});

socket.on("new_room_created", (room) => {
  renderRoomInSidebar(room);
});

function renderRoomInSidebar(room) {
  const list = document.getElementById("dynamic-groups");
  if (!document.getElementById(`item-${room}`)) {
    const div = document.createElement("div");
    div.id = `item-${room}`;
    div.className = "chat-item";
    div.onclick = () => setMode("group", room);
    div.innerHTML = `
      <div class="avatar"><i class="fas fa-users" style="color: #666; font-size: 0.9rem;"></i></div>
      <div class="chat-info">
        <span class="chat-name">${room}</span>
        <span class="chat-preview">Group Chat</span>
      </div>
      <span class="unread-badge" id="badge-${room}"></span>`;
    list.appendChild(div);
  }
}

socket.on("group_success", (room) => {
  renderRoomInSidebar(room);
  if (currentMode === "group" && currentRoom === room) {
    const activeGroupEl = document.getElementById(`item-${room}`);
    if (activeGroupEl) activeGroupEl.classList.add("active");
  }
});

socket.on("group_error", (msg) => alert(msg));

// --- UI MODE SWITCHING ---
function setMode(mode, targetName = null) {
  stopTyping();
  activeTypingUsers.clear();
  updateTypingHeaderStatus();

  currentMode = mode;
  const user = localStorage.getItem(STORAGE_KEY_USER);

  if (mode === "group" && targetName) {
    currentRoom = targetName;
    socket.emit("join_group", { room: currentRoom, username: user });
    unreadCounts[currentRoom] = 0;
    updateBadge(currentRoom);
  }
  if (mode === "private" && targetName) {
    currentPrivateUser = targetName;
  }

  document.querySelectorAll(".chat-item").forEach((item) => {
    item.classList.remove("active");
  });

  const titleEl = document.getElementById("active-chat-title");
  const chatWindow = document.getElementById("chat-window");
  chatWindow.innerHTML = "";

  if (mode === "group") {
    const activeGroupEl = document.getElementById(`item-${currentRoom}`);
    if (activeGroupEl) activeGroupEl.classList.add("active");
    titleEl.innerText = `Group: ${currentRoom}`;
    loadMessagesFromStorage(currentRoom);
  } else if (mode === "private") {
    const activeUserEl = document.getElementById(
      `item-user-${currentPrivateUser}`,
    );
    if (activeUserEl) activeUserEl.classList.add("active");
    titleEl.innerText = `Chat with ${currentPrivateUser}`;
    loadMessagesFromStorage(`private_${currentPrivateUser}`);
    unreadCounts[currentPrivateUser] = 0;
    updateBadge(currentPrivateUser);
  }
}

// --- FILE PREVIEW LOGIC ---
const fileInput = document.getElementById("fileInput");
fileInput.addEventListener("change", () => {
  if (fileInput.files.length > 0) {
    document.getElementById("file-preview").style.display = "flex";
    document.getElementById("file-name").innerText = fileInput.files[0].name;
  }
});

function clearFile() {
  fileInput.value = "";
  document.getElementById("file-preview").style.display = "none";
}

function handleEnter(event) {
  if (event.key === "Enter") sendMessage();
}

function getBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = (error) => reject(error);
  });
}

// --- GROUP MANAGEMENT ---
function createGroup() {
  const room = document.getElementById("roomInput").value.trim();
  const user = localStorage.getItem(STORAGE_KEY_USER);
  if (!room) return alert("Enter a room name!");
  socket.emit("create_group", { room, username: user });
}

function joinGroup() {
  const room = document.getElementById("roomInput").value.trim();
  const user = localStorage.getItem(STORAGE_KEY_USER);
  if (!room) return alert("Enter a room name!");
  socket.emit("join_group", { room, username: user });
}

// --- SEND MESSAGE & OTP ---
async function sendMessage() {
  try {
    if (!currentMode)
      return alert("Please select a group or user to chat first!");

    const msgInput = document.getElementById("msgInput");
    const text = msgInput.value.trim();
    const file = fileInput.files[0];
    const user = localStorage.getItem(STORAGE_KEY_USER);

    if (!text && !file) return;

    if (/\b\d{6}\b/.test(text)) {
      const confirmed = await confirmOTPWarning();
      if (!confirmed) return;
    }

    let imageBase64 = null;
    if (file) {
      imageBase64 = await getBase64(file);
    }

    const msgId =
      Date.now().toString() + Math.random().toString(36).substr(2, 9);

    const payload = {
      id: msgId,
      username: user,
      text: text,
      image: imageBase64,
      room: currentMode === "group" ? currentRoom : null,
    };

    if (currentMode === "group") {
      if (!currentRoom) return alert("Join a group first!");
      socket.emit("group_message", payload);
    } else if (currentMode === "private") {
      if (!currentPrivateUser) return alert("Select a user first!");
      payload.targetUser = currentPrivateUser;
      socket.emit("private_message", payload);
    }

    stopTyping();
    msgInput.value = "";
    clearFile();
  } catch (error) {
    console.error("Error sending message to socket:", error);
  }
}

// --- MESSAGE CONTROLS ---
function deleteMessage(id) {
  if (!confirm("Delete this message?")) return;
  socket.emit("delete_message", { id, mode: currentMode, room: currentRoom });
}

function editMessage(id, oldText) {
  const newText = prompt("Edit your message:", oldText);
  if (newText !== null && newText !== oldText) {
    socket.emit("edit_message", {
      id,
      mode: currentMode,
      room: currentRoom,
      newText,
    });
  }
}

// --- STORAGE HELPERS ---
function getStorageKey(context) {
  return STORAGE_KEY_GROUP_PREFIX + context;
}

function updateStorage(context, callback) {
  const key = getStorageKey(context);
  let history = JSON.parse(localStorage.getItem(key) || "[]");
  history = callback(history);
  localStorage.setItem(key, JSON.stringify(history));
}

function loadMessagesFromStorage(context) {
  const key = getStorageKey(context);
  const history = JSON.parse(localStorage.getItem(key) || "[]");
  const chat = document.getElementById("chat-window");
  chat.innerHTML = "";
  history.forEach((msg) => appendMessage(msg));
}

// --- SOCKET EVENT HANDLERS ---
socket.on("history_response", (data) => {
  const roomName = typeof data === "object" && data.room ? data.room : currentRoom;
  const historyData = typeof data === "object" && data.history ? data.history : (Array.isArray(data) ? data : []);

  if (roomName) {
    localStorage.setItem(getStorageKey(roomName), JSON.stringify(historyData));
    if (currentMode === "group" && currentRoom === roomName) {
      document.getElementById("chat-window").innerHTML = "";
      historyData.forEach((msg) => appendMessage(msg));
    }
  }
});

socket.on("receive_group", (data) => {
  if (!data || !data.room) return;

  // 1. Always save to the target room's local history
  updateStorage(data.room, (history) => {
    history.push(data);
    if (history.length > 100) history.shift();
    return history;
  });

  // 2. If user is currently viewing this exact group, display it live
  if (currentMode === "group" && currentRoom === data.room) {
    appendMessage(data);
    // Play subtle chime when viewing the group
    const myName = localStorage.getItem(STORAGE_KEY_USER);
    if (data.username !== myName) playNotificationSound();
  } else {
    // Increment unread count & show popup toast + notification if sent by another user
    const myName = localStorage.getItem(STORAGE_KEY_USER);
    if (data.username !== myName) {
      unreadCounts[data.room] = (unreadCounts[data.room] || 0) + 1;
      updateBadge(data.room);
      const msgText = data.text ? data.text : "Sent an image";
      showToastNotification(`Group: ${data.room}`, `${data.username}: ${msgText}`, "fa-users");
    }
  }
});

socket.on("message_deleted", ({ id }) => {
  const el = document.getElementById(`msg-${id}`);
  if (el) el.remove();
  const context =
    currentMode === "group" ? currentRoom : `private_${currentPrivateUser}`;
  updateStorage(context, (history) => history.filter((m) => m.id !== id));
});

socket.on("message_updated", ({ id, newText }) => {
  const textEl = document.querySelector(`#msg-${id} .msg-text`);
  if (textEl) textEl.innerText = newText + " (edited)";
  const context =
    currentMode === "group" ? currentRoom : `private_${currentPrivateUser}`;
  updateStorage(context, (history) => {
    const msg = history.find((m) => m.id === id);
    if (msg) msg.text = newText;
    return history;
  });
});

socket.on("system_message", (data) => {
  const text = typeof data === "object" ? data.text : data;
  const room = typeof data === "object" ? data.room : null;

  if (!room || (currentMode === "group" && currentRoom === room)) {
    addSystemMessage(text);
  }
});

// --- TYPING INDICATORS LOGIC ---
function handleTypingInput() {
  if (!currentMode) return;
  const myName = localStorage.getItem(STORAGE_KEY_USER);
  const msgInput = document.getElementById("msgInput");
  if (!myName || !msgInput) return;

  if (!isTyping && msgInput.value.trim().length > 0) {
    isTyping = true;
    socket.emit("typing_start", {
      username: myName,
      mode: currentMode,
      room: currentRoom,
      targetUser: currentPrivateUser
    });
  }

  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    stopTyping();
  }, 2500);
}

function stopTyping() {
  if (!isTyping) return;
  isTyping = false;
  const myName = localStorage.getItem(STORAGE_KEY_USER);
  socket.emit("typing_stop", {
    username: myName,
    mode: currentMode,
    room: currentRoom,
    targetUser: currentPrivateUser
  });
}

socket.on("user_typing", (data) => {
  const myName = localStorage.getItem(STORAGE_KEY_USER);
  if (!data || data.username === myName) return;

  const isRelevantGroup = currentMode === "group" && data.mode === "group" && currentRoom === data.room;
  const isRelevantPrivate = currentMode === "private" && data.mode === "private" && currentPrivateUser === data.username;

  if (isRelevantGroup || isRelevantPrivate) {
    activeTypingUsers.add(data.username);
    updateTypingHeaderStatus();
  }
});

socket.on("user_stopped_typing", (data) => {
  if (!data) return;
  activeTypingUsers.delete(data.username);
  updateTypingHeaderStatus();
});

function updateTypingHeaderStatus() {
  const statusEl = document.getElementById("header-status");
  const chatWindow = document.getElementById("chat-window");

  // Remove existing body typing bubble if present
  const existingBubble = document.getElementById("body-typing-indicator");
  if (existingBubble) existingBubble.remove();

  if (activeTypingUsers.size > 0) {
    const names = Array.from(activeTypingUsers).join(", ");

    // 1. Keep header status clean
    if (statusEl) {
      statusEl.innerText = "online";
    }

    // 2. Render Animated Typing Bubble in Chat Window Body
    if (chatWindow) {
      const bubble = document.createElement("div");
      bubble.id = "body-typing-indicator";
      bubble.className = "message other typing-bubble-msg";
      bubble.innerHTML = `
        <span class="typing-bubble-header">${names}</span>
        <div class="typing-dots-wrapper">
          <span></span><span></span><span></span>
        </div>`;
      chatWindow.appendChild(bubble);
      chatWindow.scrollTop = chatWindow.scrollHeight;
    }
  } else {
    if (statusEl) {
      statusEl.innerText = "online";
    }
  }
}

// Attach typing input listener
document.addEventListener("DOMContentLoaded", () => {
  const msgInput = document.getElementById("msgInput");
  if (msgInput) {
    msgInput.addEventListener("input", handleTypingInput);
  }
});

// --- UI RENDERING ---
function appendMessage(data) {
  const chat = document.getElementById("chat-window");
  if (document.getElementById(`msg-${data.id}`)) return;

  const myName = localStorage.getItem(STORAGE_KEY_USER);
  const isMe = myName !== "" && data.username === myName;

  const div = document.createElement("div");
  div.id = `msg-${data.id}`;
  div.className = isMe ? "message self" : "message other";

  const time = new Date(data.timestamp || Date.now()).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  let content = `<div class="msg-header">
                    <span class="meta">${isMe ? "You" : data.username}</span>`;
  if (isMe) {
    const safeText = (data.text || "").replace(/'/g, "\\'");
    content += `
        <div class="msg-actions">
            <i class="fas fa-edit" onclick="editMessage('${data.id}', '${safeText}')"></i>
            <i class="fas fa-trash" onclick="deleteMessage('${data.id}')"></i>
        </div>`;
  }
  content += `</div>`;

  if (data.image) content += `<img src="${data.image}" class="msg-img" />`;
  if (data.text) content += `<div class="msg-text">${data.text}</div>`;

  content += `<span class="msg-meta">${time} ${isMe ? "✓✓" : ""}</span>`;

  div.innerHTML = content;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

function addSystemMessage(msg) {
  const chat = document.getElementById("chat-window");
  const div = document.createElement("div");
  div.className = "date-divider system-msg";
  div.innerHTML = `<span>${msg}</span>`;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

// --- DARK MODE TOGGLE ---
const themeToggleBtn = document.querySelector(".toggle-theme");
const currentTheme = localStorage.getItem("kotha_theme") || "light";

if (currentTheme === "dark") {
  document.body.classList.add("dark-theme");
  themeToggleBtn.classList.replace("fa-sun", "fa-moon");
}

themeToggleBtn.addEventListener("click", () => {
  document.body.classList.toggle("dark-theme");
  let theme = "light";
  if (document.body.classList.contains("dark-theme")) {
    theme = "dark";
    themeToggleBtn.classList.replace("fa-sun", "fa-moon");
  } else {
    themeToggleBtn.classList.replace("fa-moon", "fa-sun");
  }
  localStorage.setItem("kotha_theme", theme);
});

// --- OTP WARNING MODAL ---
function confirmOTPWarning() {
  return new Promise((resolve) => {
    const modal = document.getElementById("otp-modal");
    modal.style.display = "flex";
    document.getElementById("confirm-otp").onclick = () => {
      modal.style.display = "none";
      resolve(true);
    };
    document.getElementById("cancel-otp").onclick = () => {
      modal.style.display = "none";
      resolve(false);
    };
  });
}

// --- 1-ON-1 CHAT SOCKET EVENTS ---
socket.on("update_online_users", (users) => {
  const list = document.getElementById("online-users-list");
  list.innerHTML = "";
  const myName = localStorage.getItem(STORAGE_KEY_USER);

  users.forEach((user) => {
    if (user === myName) return;

    const div = document.createElement("div");
    div.id = `item-user-${user}`;
    div.className = "chat-item";
    div.onclick = () => setMode("private", user);

    div.innerHTML = `
      <div style="width: 12px; height: 12px; background: #27ae60; border-radius: 50%; margin: 0 15px 0 5px; flex-shrink: 0; box-shadow: 0 0 0 2px var(--bg-light);"></div>
      <div class="chat-info">
        <span class="chat-name">${user}</span>
        <span class="chat-preview">Online Now</span>
      </div>
      <span class="unread-badge" id="badge-${user}"></span>`;

    list.appendChild(div);
    updateBadge(user);
  });
});

socket.on("receive_private", (data) => {
  const myName = localStorage.getItem(STORAGE_KEY_USER);
  const otherPerson =
    data.username === myName ? data.targetUser : data.username;
  const storageContext = `private_${otherPerson}`;

  updateStorage(storageContext, (history) => {
    history.push(data);
    if (history.length > 100) history.shift();
    return history;
  });

  if (currentMode === "private" && currentPrivateUser === otherPerson) {
    appendMessage(data);
    if (data.username !== myName) playNotificationSound();
  } else if (data.username !== myName) {
    unreadCounts[otherPerson] = (unreadCounts[otherPerson] || 0) + 1;
    updateBadge(otherPerson);

    const notifBody = data.text ? data.text : "Sent an image";
    showToastNotification(`Message from ${data.username}`, notifBody, "fa-comment");
  }
});

function updateBadge(user) {
  const badge = document.getElementById(`badge-${user}`);
  if (badge) {
    const count = unreadCounts[user] || 0;
    if (count > 0) {
      badge.innerText = count;
      badge.style.display = "inline-block";
    } else {
      badge.style.display = "none";
    }
  }
}

// --- EMOJI PICKER LOGIC ---
const EMOJI_CATEGORIES = {
  smileys: ["😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "😊", "😇", "🙂", "🙃", "😉", "😌", "😍", "🥰", "😘", "😗", "😙", "😚", "😋", "😛", "😝", "😜", "🤪", "🤨", "🧐", "🤓", "😎", "🤩", "🥳", "😏", "😒", "😞", "😔", "😟", "😕", "🙁", "☹️", "😣", "😖", "😫", "😩", "🥺", "😢", "😭", "😤", "😠", "😡", "🤬", "🤯", "😳", "🥵", "🥶", "😱", "😨", "😰", "😥", "😓", "🤗", "🤔", "🤭", "🤫", "🤥", "😶", "😐", "😑", "😬", "🙄", "😯", "😦", "😧", "😮", "😲", "🥱", "😴", "🤤", "😪", "😵", "🤐", "🥴", "🤢", "🤮", "🤧", "😷", "🤒", "🤕"],
  gestures: ["👍", "👎", "👊", "✊", "🤛", "🤜", "🤞", "✌️", "🤟", "🤘", "👌", "🤏", "👈", "👉", "👆", "👇", "☝️", "✋", "🤚", "🖐", "🖖", "👋", "🤙", "💪", "🖕", "✍️", "🙏", "🤝", "🙌", "👏", "🤲"],
  hearts: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔", "❣️", "💕", "💞", "💓", "💗", "💖", "💘", "💝", "💟", "🔥", "✨", "🌟", "💫", "💥", "💯"],
  animals: ["🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯", "🦁", "🐮", "🐷", "🐸", "🐵", "🙈", "🙉", "🙊", "🐒", "🐔", "🐧", "🐦", "🐤", "🐣", "🐥", "🦆", "🦅", "🦉", "🦇", "🐺", "🐗", "🐴", "🦄", "🐝", "🐛", "🦋", "🐌", "🐞", "🐜", "🦟", "<ctrl42>", "🕷", "🕸", "🦂", "🐢", "🐍", "🦎", "🐙", "🦑", "🦐", "🦞", "🦀", "🐡", "🐠", "🐟", "🐬", "🐳", "🐋", "🦈"],
  food: ["🍏", "🍎", "🍐", "🍊", "🍋", "🍌", "🍉", "🍇", "🍓", "🫐", "🍈", "🍒", "🍑", "🥭", "🍍", "🥥", "🥝", "🍅", "🍆", "🥑", "🥦", "🥬", "🥒", "🌶", "🫑", "🌽", "🥕", "🫒", "🧄", "🧅", "🥔", "🍠", "🥐", "🥯", "🍞", "🥖", "🥨", "🧀", "🥚", "🍳", "🧈", "🥞", "🧇", "🥓", "🥩", "🍗", "🍖", "🦴", "🌭", "🍔", "🍟", "🍕", "🫓", "🥪", "🥙", "🧆", "🌮", "🌯", "🫔", "🥗", "🥘", "🫕", "🥫", "🍝", "🍜", "🍲", "🍛", "🍣", "🍱", "🥟", "🦪", "🍤", "🍙", "🍚", "🍘", "🍥", "🥠", "🥮", "🍢", "🍡", "🍧", "🍨", "🍦", "🥧", "🧁", "🍰", "🎂", "🍮", "🍭", "🍬", "🍫", "🍿", "🍩", "🍪", "🌰", "🥜", "🍯", "🥛", "☕️", "🍵", "🧃", "🥤", "🧋", "🍶", "🍺", "🍻", "🥂", "🍷", "🥃", "🍸", "🍹", "🧉", "🍾", "🧊"],
  objects: ["🎉", "🎊", "🎈", "🎂", "🎁", "🏆", "🥇", "🥈", "🥉", "🏅", "🎖", "🎟", "🎫", "🎭", "🎨", "🎬", "🎤", "🎧", "🎼", "🎵", "🎶", "🎷", "🎸", "🎹", "🎺", "🎻", "🥁", "📱", "📲", "💻", "⌨️", "🖥", "🖨", "🖱", "📷", "📸", "📹", "📺", "📻", "🎙", "⏳", "⌛️", "⏰", "⏱", "⏲", "💡", "🔦", "🕯", "📕", "📖", "📗", "📘", "📙", "📚", "📓", "📒", "📃", "📜", "📄", "📰", "🗞", "📑", "🔖", "🏷", "💰", "🪙", "💴", "💵", "💶", "💷", "💸", "💳", "🧾", "✉️", "📧", "📨", "📩", "📤", "📥", "📦", "📫", "📬", "📮", "📝", "✏️", "✒️", "🖋", "🖊", "🖌", "🖍"]
};

let currentEmojiCategory = "smileys";

function renderEmojiGrid(category = "smileys") {
  const grid = document.getElementById("emoji-grid");
  if (!grid) return;

  const emojis = EMOJI_CATEGORIES[category] || EMOJI_CATEGORIES.smileys;
  grid.innerHTML = "";

  emojis.forEach((emoji) => {
    const span = document.createElement("span");
    span.className = "emoji-item";
    span.innerText = emoji;
    span.onclick = (e) => {
      e.stopPropagation();
      insertEmoji(emoji);
    };
    grid.appendChild(span);
  });
}

function switchEmojiCategory(cat, btnEl) {
  currentEmojiCategory = cat;
  document.querySelectorAll(".emoji-cat-btn").forEach((b) => b.classList.remove("active"));
  if (btnEl) btnEl.classList.add("active");
  renderEmojiGrid(cat);
}

function insertEmoji(emoji) {
  const input = document.getElementById("msgInput");
  if (!input) return;

  const start = input.selectionStart || input.value.length;
  const end = input.selectionEnd || input.value.length;
  const text = input.value;

  input.value = text.substring(0, start) + emoji + text.substring(end);
  input.selectionStart = input.selectionEnd = start + emoji.length;
  input.focus();
}

function toggleEmojiPicker(event) {
  if (event) event.stopPropagation();
  const picker = document.getElementById("emoji-picker");
  if (!picker) return;

  if (picker.style.display === "none" || !picker.style.display) {
    picker.style.display = "flex";
    renderEmojiGrid(currentEmojiCategory);
  } else {
    picker.style.display = "none";
  }
}

document.addEventListener("click", (e) => {
  const picker = document.getElementById("emoji-picker");
  const toggleBtn = document.getElementById("emoji-toggle-btn");
  if (picker && picker.style.display === "flex") {
    if (!picker.contains(e.target) && (!toggleBtn || !toggleBtn.contains(e.target))) {
      picker.style.display = "none";
    }
  }
});
