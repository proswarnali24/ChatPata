const socket = io();

let currentMode = null; // Removed global default
let currentRoom = "";
let currentPrivateUser = "";
let unreadCounts = {};
let isLoginMode = true;

const STORAGE_KEY_USER = "chat_app_username";
const STORAGE_KEY_GROUP_PREFIX = "chat_history_group_";

// --- INITIALIZATION & AUTH ---
window.onload = () => {
  const token = localStorage.getItem("chat_app_token");
  const savedUser = localStorage.getItem(STORAGE_KEY_USER);

  if (token && savedUser) {
    socket.emit("user_connected", savedUser);
    requestNotificationPermission();
  } else {
    document.getElementById("auth-modal").style.display = "flex";
  }

  // Set blank state until user selects a chat
  document.getElementById("active-chat-title").innerText =
    "Select a chat to start messaging";
  document.getElementById("chat-window").innerHTML = "";
};

// 2. REQUEST DESKTOP NOTIFICATION PERMISSION
function requestNotificationPermission() {
  if (
    Notification.permission !== "granted" &&
    Notification.permission !== "denied"
  ) {
    Notification.requestPermission();
  }
}

function showNotification(title, body) {
  if (Notification.permission === "granted") {
    new Notification(title, { body: body });
  }
}

function toggleAuthMode() {
  isLoginMode = !isLoginMode;
  document.getElementById("auth-title").innerText = isLoginMode
    ? "Login to Chat"
    : "Register Account";
  document.getElementById("auth-action-btn").innerText = isLoginMode
    ? "Login"
    : "Register";
  document.getElementById("auth-toggle-text").innerText = isLoginMode
    ? "Need an account? Register here."
    : "Already have an account? Login here.";
  document.getElementById("auth-error").innerText = "";
}

async function performAuth() {
  const user = document.getElementById("auth-username").value.trim();
  const pass = document.getElementById("auth-password").value.trim();
  const errorDiv = document.getElementById("auth-error");

  if (!user || !pass)
    return (errorDiv.innerText = "Please fill in all fields.");

  const endpoint = isLoginMode ? "/login" : "/register";

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: user, password: pass }),
    });

    const data = await res.json();

    if (data.error) {
      errorDiv.innerText = data.error;
      errorDiv.style.color = "#e74c3c";
    } else if (!isLoginMode) {
      isLoginMode = true;
      toggleAuthMode();
      errorDiv.innerText = "Registration successful! You can now login.";
      errorDiv.style.color = "#27ae60";
    } else {
      localStorage.setItem("chat_app_token", data.token);
      localStorage.setItem(STORAGE_KEY_USER, data.username);
      document.getElementById("auth-modal").style.display = "none";
      requestNotificationPermission(); // Ask permission upon successful login
      location.reload();
    }
  } catch (error) {
    errorDiv.innerText = "Server connection error.";
  }
}

// --- DYNAMIC ROOM LOADING ---
socket.on("load_rooms", (rooms) => {
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
      <div class="avatar"></div>
      <div class="chat-info">
        <span class="chat-name">${room}</span>
        <span class="chat-preview">Group Chat</span>
      </div>`;
    list.appendChild(div);
  }
}

socket.on("group_success", (room) => {
  renderRoomInSidebar(room);
  setMode("group", room);
});

socket.on("group_error", (msg) => alert(msg));

// --- UI MODE SWITCHING ---
function setMode(mode, targetName = null) {
  currentMode = mode;

  if (mode === "group" && targetName) currentRoom = targetName;
  if (mode === "private" && targetName) currentPrivateUser = targetName;

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
socket.on("history_response", (historyData) => {
  const context = currentMode === "group" ? currentRoom : null;
  if (!context) return;
  localStorage.setItem(getStorageKey(context), JSON.stringify(historyData));
  document.getElementById("chat-window").innerHTML = "";
  historyData.forEach((msg) => appendMessage(msg));
});

socket.on("receive_group", (data) => {
  if (currentRoom) {
    updateStorage(currentRoom, (history) => {
      history.push(data);
      if (history.length > 100) history.shift();
      return history;
    });
  }
  if (currentMode === "group") appendMessage(data);
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

socket.on("system_message", (msg) => {
  addSystemMessage(msg);
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
  } else if (data.username !== myName) {
    unreadCounts[otherPerson] = (unreadCounts[otherPerson] || 0) + 1;
    updateBadge(otherPerson);

    // Show Desktop Notification
    const notifBody = data.text ? data.text : "Sent an image";
    showNotification(`New message from ${data.username}`, notifBody);
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
