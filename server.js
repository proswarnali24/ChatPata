require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e8 });
const PORT = Number(process.env.PORT || 4000);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const JWT_SECRET = process.env.JWT_SECRET || "your_super_secret_jwt_key";

// --- DIRECTORY SETUP ---
const UPLOAD_DIR = path.join(__dirname, "public/uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// --- MONGODB & FALLBACK IN-MEMORY STORE ---
let isMongoConnected = false;

// Mongoose Models
const userSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
});
const User = mongoose.model("User", userSchema);

const roomSchema = new mongoose.Schema({
  name: { type: String, unique: true, required: true },
  createdBy: String,
  createdAt: { type: Date, default: Date.now },
});
const Room = mongoose.model("Room", roomSchema);

const messageSchema = new mongoose.Schema({
  id: String,
  username: String,
  text: String,
  image: String,
  room: { type: String, required: true },
  targetUser: String,
  timestamp: { type: Date, default: Date.now },
});
const Message = mongoose.model("Message", messageSchema);

// In-Memory & File Storage Fallback Collections
const STORAGE_FILE = path.join(__dirname, "db_storage.json");
let memUsers = new Map();
let memRooms = new Set(["Global Feed", "General"]);
let memMessages = [];

// Load existing data from file if present
try {
  if (fs.existsSync(STORAGE_FILE)) {
    const raw = fs.readFileSync(STORAGE_FILE, "utf8");
    const data = JSON.parse(raw);
    if (data.users && Array.isArray(data.users)) {
      data.users.forEach((u) => memUsers.set(u.username.toLowerCase(), u));
    }
    if (data.rooms && Array.isArray(data.rooms)) {
      data.rooms.forEach((r) => memRooms.add(r));
    }
    if (data.messages && Array.isArray(data.messages)) {
      memMessages = data.messages;
    }
  }
} catch (e) {
  console.error("Error loading local db_storage.json:", e);
}

function saveStorageToFile() {
  try {
    const payload = {
      users: Array.from(memUsers.values()),
      rooms: Array.from(memRooms),
      messages: memMessages.slice(-500),
    };
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(payload, null, 2));
  } catch (e) {
    console.error("Error writing to db_storage.json:", e);
  }
}

mongoose
  .connect(process.env.MONGO_URI || "mongodb://127.0.0.1:27017/chatpata", {
    serverSelectionTimeoutMS: 10000,
  })
  .then(() => {
    isMongoConnected = true;
    console.log("✅ Connected to MongoDB Atlas Cloud Database!");
  })
  .catch((err) => {
    isMongoConnected = false;
    console.warn("⚠️ MongoDB connection error:", err.message);
    console.warn("⚠️ Running with local JSON File Storage persistence fallback.");
  });

// Unified DB Abstraction Layer
const DB = {
  async findUser(username) {
    if (isMongoConnected) {
      return await User.findOne({ username: new RegExp(`^${username}$`, "i") });
    }
    const lower = username.toLowerCase();
    for (let u of memUsers.values()) {
      if (u.username.toLowerCase() === lower) return u;
    }
    return null;
  },

  async createUser(username, hashedPassword) {
    if (isMongoConnected) {
      return await User.create({ username, password: hashedPassword });
    }
    const userObj = { username, password: hashedPassword, _id: { getTimestamp: () => new Date() } };
    memUsers.set(username.toLowerCase(), userObj);
    saveStorageToFile();
    return userObj;
  },

  async getRooms() {
    const defaults = ["Global Feed", "General"];
    if (isMongoConnected) {
      const existingRooms = await Room.find();
      const existingNames = existingRooms.map((r) => r.name);
      
      // Auto-create missing default rooms in MongoDB
      for (let defName of defaults) {
        if (!existingNames.includes(defName)) {
          try {
            await Room.create({ name: defName, createdBy: "System" });
          } catch (e) {}
        }
      }
      
      const allRooms = await Room.find();
      return Array.from(new Set([...defaults, ...allRooms.map((r) => r.name)]));
    }
    defaults.forEach((r) => memRooms.add(r));
    return Array.from(memRooms);
  },

  async createRoom(name, createdBy) {
    if (isMongoConnected) {
      await Room.create({ name, createdBy });
    }
    memRooms.add(name);
    saveStorageToFile();
  },

  async getRoomMessages(roomName, limit = 100) {
    if (isMongoConnected) {
      return await Message.find({ room: roomName }).sort({ timestamp: 1 }).limit(limit);
    }
    return memMessages
      .filter((m) => m.room === roomName)
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
      .slice(-limit);
  },

  async saveMessage(msgData) {
    if (isMongoConnected) {
      await Message.create(msgData);
      const count = await Message.countDocuments({ room: msgData.room });
      if (count > 100) {
        const oldest = await Message.find({ room: msgData.room }).sort({ timestamp: 1 }).limit(count - 100).select("_id");
        await Message.deleteMany({ _id: { $in: oldest.map((m) => m._id) } });
      }
    } else {
      memMessages.push({ ...msgData, timestamp: msgData.timestamp || new Date() });
      if (memMessages.length > 500) memMessages.shift();
      saveStorageToFile();
    }
  },

  async deleteMessage(id) {
    if (isMongoConnected) {
      await Message.deleteOne({ id });
    } else {
      const idx = memMessages.findIndex((m) => m.id === id);
      if (idx !== -1) {
        memMessages.splice(idx, 1);
        saveStorageToFile();
      }
    }
  },

  async updateMessage(id, newText) {
    if (isMongoConnected) {
      await Message.updateOne({ id }, { text: newText });
    } else {
      const msg = memMessages.find((m) => m.id === id);
      if (msg) {
        msg.text = newText;
        saveStorageToFile();
      }
    }
  },
};

const connectedUsers = new Map();

// --- AUTHENTICATION MIDDLEWARE & ROUTES ---
function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Access token required" });

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ error: "Invalid or expired token" });
    req.user = decoded;
    next();
  });
}

app.get("/me", authenticateToken, async (req, res) => {
  try {
    const user = await DB.findUser(req.user.username);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ username: user.username });
  } catch (e) {
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/register", async (req, res) => {
  let { username, password } = req.body;
  username = (username || "").trim();
  password = (password || "").trim();

  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required." });
  }
  if (username.length < 3) {
    return res.status(400).json({ error: "Username must be at least 3 characters long." });
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return res.status(400).json({ error: "Username can only contain letters, numbers, and underscores." });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters long." });
  }

  try {
    const existing = await DB.findUser(username);
    if (existing) {
      return res.status(400).json({ error: "Username already taken." });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    await DB.createUser(username, hashedPassword);
    res.json({ success: true, message: "Account created successfully!" });
  } catch (e) {
    console.error("Register error:", e);
    res.status(400).json({ error: "Registration failed. Try again." });
  }
});

app.post("/login", async (req, res) => {
  let { username, password } = req.body;
  username = (username || "").trim();
  password = (password || "").trim();

  if (!username || !password) {
    return res.status(400).json({ error: "Please provide both username and password." });
  }

  try {
    const user = await DB.findUser(username);
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: "Invalid username or password." });
    }
    const token = jwt.sign({ username: user.username }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token, username: user.username });
  } catch (e) {
    console.error("Login error:", e);
    res.status(500).json({ error: "Login failed due to a server error." });
  }
});

// --- GEMINI AI SETUP ---
let genAI = null;
if (process.env.GEMINI_API_KEY) {
  genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
} else {
  console.warn("WARNING: Trolling responses will use local fallback.");
}

const userSpamTracker = new Map();

function getSoothingResponse(text, username) {
  if (!text) return null;

  const toxicWords = ["pagol", "stupid", "idiot", "hate", "bad", "dumb", "fool", "trash", "loser", "shut up"];
  const regex = new RegExp(`\\b(${toxicWords.join("|")})\\b`, "i");

  if (!regex.test(text)) return null;

  const now = Date.now();
  if (!userSpamTracker.has(username)) userSpamTracker.set(username, []);

  let timestamps = userSpamTracker.get(username);
  timestamps.push(now);
  timestamps = timestamps.filter((time) => now - time <= 3600000);
  userSpamTracker.set(username, timestamps);

  if (timestamps.length < 3) return null;

  const recentSpam = timestamps.filter((time) => now - time <= 5000);
  if (recentSpam.length >= 3) {
    return "You are sending upset messages very quickly. Please pause, take a deep breath, and let your mind settle before typing again.";
  }

  const calmingResponses = [
    "Let's take a deep breath. We keep this space positive and kind.",
    "Peace and kindness make our chat a warmer place for everyone.",
    "Take a moment to relax and let your mind settle before typing.",
    "Let's focus on positivity and constructive conversations."
  ];
  return calmingResponses[Math.floor(Math.random() * calmingResponses.length)];
}

// --- HELPER FUNCTIONS ---
function saveImageToDisk(base64Data) {
  try {
    const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) return null;
    const buffer = Buffer.from(matches[2], "base64");
    const filename = `${Date.now()}-${Math.floor(Math.random() * 1000000)}.jpg`;
    fs.writeFileSync(path.join(UPLOAD_DIR, filename), buffer);
    return `/uploads/${filename}`;
  } catch (e) {
    return null;
  }
}

// --- SOCKET CONNECTION HANDLERS ---
io.on("connection", async (socket) => {
  try {
    const rooms = await DB.getRooms();
    rooms.forEach((r) => socket.join(r));
    socket.emit("load_rooms", rooms);
  } catch (e) {
    console.error(e);
  }

  socket.on("user_connected", (data) => {
    let username = typeof data === "object" ? data.username : data;
    let token = typeof data === "object" ? data.token : null;

    if (token) {
      jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (!err && decoded && decoded.username) {
          username = decoded.username;
        }
      });
    }

    if (username) {
      socket.authenticatedUser = username;
      connectedUsers.set(socket.id, username);
      io.emit("update_online_users", Array.from(new Set(connectedUsers.values())));
    }
  });

  socket.on("create_group", async (data) => {
    const { room, username } = data;
    try {
      await DB.createRoom(room, username);
      for (let [id, s] of io.sockets.sockets.entries()) {
        s.join(room);
      }
      io.emit("new_room_created", room);
    } catch (e) {}
    joinRoomInternal(socket, room, username);
  });

  socket.on("join_group", async (data) => {
    joinRoomInternal(socket, data.room, data.username);
  });

  async function joinRoomInternal(socket, room, username) {
    if (!room) return;
    socket.join(room);
    socket.currentRoom = room;
    socket.emit("group_success", room);

    try {
      const groupHistory = await DB.getRoomMessages(room, 100);
      socket.emit("history_response", { room, history: groupHistory });
    } catch (e) {
      console.error(e);
    }
    if (username) {
      socket.to(room).emit("system_message", { room, text: `${username} has joined.` });
    }
  }

  socket.on("group_message", async (data) => {
    try {
      if (!data.room) return;
      const soothing = await getSoothingResponse(data.text, data.username);
      if (soothing) {
        socket.emit("system_message", { room: data.room, text: `[Auto-Mod] ${soothing}` });
        return;
      }
      if (data.image) data.image = saveImageToDisk(data.image);

      await DB.saveMessage(data);
      io.to(data.room).emit("receive_group", data);
    } catch (err) {
      console.error("Group chat error:", err);
    }
  });

  socket.on("private_message", async (data) => {
    try {
      if (data.image) data.image = saveImageToDisk(data.image);
      const participants = [data.username, data.targetUser].sort();
      data.room = `private_${participants[0]}_${participants[1]}`;

      await DB.saveMessage(data);

      for (let [id, user] of connectedUsers.entries()) {
        if (user === data.targetUser) {
          io.to(id).emit("receive_private", data);
          break;
        }
      }
      socket.emit("receive_private", data);
    } catch (err) {
      console.error("Private message error:", err);
    }
  });

  socket.on("delete_message", async (data) => {
    try {
      await DB.deleteMessage(data.id);
      io.to(data.room).emit("message_deleted", data);
    } catch (e) {
      console.error(e);
    }
  });

  socket.on("edit_message", async (data) => {
    try {
      await DB.updateMessage(data.id, data.newText);
      io.to(data.room).emit("message_updated", data);
    } catch (e) {
      console.error(e);
    }
  });

  socket.on("typing_start", (data) => {
    if (!data) return;
    if (data.mode === "group" && data.room) {
      socket.to(data.room).emit("user_typing", data);
    } else if (data.mode === "private" && data.targetUser) {
      for (let [id, user] of connectedUsers.entries()) {
        if (user === data.targetUser) {
          io.to(id).emit("user_typing", data);
          break;
        }
      }
    }
  });

  socket.on("typing_stop", (data) => {
    if (!data) return;
    if (data.mode === "group" && data.room) {
      socket.to(data.room).emit("user_stopped_typing", data);
    } else if (data.mode === "private" && data.targetUser) {
      for (let [id, user] of connectedUsers.entries()) {
        if (user === data.targetUser) {
          io.to(id).emit("user_stopped_typing", data);
          break;
        }
      }
    }
  });

  socket.on("disconnect", () => {
    connectedUsers.delete(socket.id);
    io.emit("update_online_users", Array.from(new Set(connectedUsers.values())));
  });
});

server.listen(PORT, () =>
  console.log(`🚀 ChatPata server running at http://localhost:${PORT}`)
);
