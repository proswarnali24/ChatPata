require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e8 });

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const JWT_SECRET = process.env.JWT_SECRET || "your_super_secret_jwt_key";

// --- DIRECTORY SETUP ---
const UPLOAD_DIR = path.join(__dirname, "public/uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// --- MONGODB SETUP ---
mongoose
  .connect(process.env.MONGO_URI || "mongodb://localhost:27017/kotha_bolbo")
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("MongoDB connection error:", err));

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

const connectedUsers = new Map();

// --- AUTHENTICATION API ---
app.post("/register", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: "Missing fields" });
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    await User.create({ username, password: hashedPassword });
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: "Username already taken." });
  }
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username });
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: "Invalid username or password" });
  }
  const token = jwt.sign({ username }, JWT_SECRET);
  res.json({ token, username });
});

// --- GEMINI AI SETUP ---
let genAI = null;
if (process.env.GEMINI_API_KEY) {
  genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
} else {
  console.warn(
    "WARNING: No GEMINI_API_KEY found in .env. Trolling responses will use local fallback.",
  );
}
// Map to track when users send toxic messages: { username: [timestamp1, timestamp2, ...] }
const userSpamTracker = new Map();

async function getSoothingResponse(text, username) {
  if (!text) return null;

  const toxicWords = [
    "pagol",
    "stupid",
    "idiot",
    "hate",
    "bad",
    "dumb",
    "fool",
    "trash",
    "loser",
    "shut up",
  ];
  const regex = new RegExp(`\\b(${toxicWords.join("|")})\\b`, "i");

  // 1. If no toxic word is found, do nothing
  if (!regex.test(text)) return null;

  const now = Date.now();

  if (!userSpamTracker.has(username)) {
    userSpamTracker.set(username, []);
  }

  let timestamps = userSpamTracker.get(username);
  timestamps.push(now);

  // Clean up old timestamps (e.g., older than 1 hour) to prevent memory leaks
  timestamps = timestamps.filter((time) => now - time <= 3600000);
  userSpamTracker.set(username, timestamps);

  // 2. FUN VS TROLLING LOGIC: Do not trigger unless count >= 3
  if (timestamps.length < 3) {
    return null; // Let the first 2 flagged messages slide as fun/banter
  }

  // 3. RAPID SPAM DETECTION: Check if they sent 3+ toxic messages in the last 5 seconds
  const recentSpam = timestamps.filter((time) => now - time <= 5000);

  if (recentSpam.length >= 3) {
    console.log(`[SPAM DETECTED] ${username} is spamming toxic words.`);
    // Return immediately to save Gemini API quota and soothe the user instantly
    return "You are sending upset messages very quickly. Please pause, take a deep breath, and let your mind settle before typing again.";
  }

  // 4. STANDARD GEMINI AI LOGIC
  if (!genAI)
    return "Let's take a deep breath. We keep this space positive and kind.";

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const prompt = `A user sent: "${text}". It was flagged as trolling. Generate a 1 sentence soothing, calming response to ease their mental state. Do not scold them.`;
    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch (error) {
    console.error("Gemini API skipped/failed:", error.message);
    return "Let's take a deep breath. We keep this space positive and kind.";
  }
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

// 1. LIMIT MESSAGES IN DB TO 100 PER ROOM
async function trimRoomMessages(roomName) {
  try {
    const count = await Message.countDocuments({ room: roomName });
    const LIMIT = 100;
    if (count > LIMIT) {
      const excess = count - LIMIT;
      // Find the oldest messages to delete
      const oldestMessages = await Message.find({ room: roomName })
        .sort({ timestamp: 1 })
        .limit(excess)
        .select("_id");

      const idsToDelete = oldestMessages.map((msg) => msg._id);
      await Message.deleteMany({ _id: { $in: idsToDelete } });
    }
  } catch (err) {
    console.error("Error trimming messages:", err);
  }
}

// --- SOCKET CONNECTION HANDLERS ---
io.on("connection", async (socket) => {
  try {
    const rooms = await Room.find();
    socket.emit(
      "load_rooms",
      rooms.map((r) => r.name),
    );
  } catch (e) {
    console.error(e);
  }

  socket.on("user_connected", (username) => {
    connectedUsers.set(socket.id, username);
    io.emit("update_online_users", Array.from(connectedUsers.values()));
  });

  socket.on("create_group", async (data) => {
    const { room, username } = data;
    try {
      await Room.create({ name: room, createdBy: username });
      io.emit("new_room_created", room);
    } catch (e) {}
    joinRoomInternal(socket, room, username);
  });

  socket.on("join_group", async (data) => {
    joinRoomInternal(socket, data.room, data.username);
  });

  async function joinRoomInternal(socket, room, username) {
    if (socket.currentRoom) socket.leave(socket.currentRoom);
    socket.join(room);
    socket.currentRoom = room;
    socket.emit("group_success", room);

    try {
      const groupHistory = await Message.find({ room: room })
        .sort({ timestamp: 1 })
        .limit(100);
      socket.emit("history_response", groupHistory);
    } catch (e) {
      console.error(e);
    }
    socket.to(room).emit("system_message", `${username} has joined.`);
  }

  // Group Chat
  socket.on("group_message", async (data) => {
    try {
      const soothing = await getSoothingResponse(data.text);
      if (soothing) {
        socket.emit("system_message", `[Auto-Mod] ${soothing}`);
        return;
      }
      if (data.image) data.image = saveImageToDisk(data.image);

      try {
        await Message.create(data);
        await trimRoomMessages(data.room); // Enforce Limit
      } catch (dbErr) {
        console.error("DB Error:", dbErr);
      }

      io.to(data.room).emit("receive_group", data);
    } catch (err) {
      console.error("Group chat logic error:", err);
    }
  });

  // Private Messages
  socket.on("private_message", async (data) => {
    try {
      if (data.image) data.image = saveImageToDisk(data.image);
      const participants = [data.username, data.targetUser].sort();
      data.room = `private_${participants[0]}_${participants[1]}`;

      try {
        await Message.create(data);
        await trimRoomMessages(data.room); // Enforce Limit
      } catch (dbErr) {
        console.error("DB Error:", dbErr);
      }

      for (let [id, user] of connectedUsers.entries()) {
        if (user === data.targetUser) {
          io.to(id).emit("receive_private", data);
          break;
        }
      }
      socket.emit("receive_private", data);
    } catch (err) {
      console.error("Private message logic error:", err);
    }
  });

  // Controls
  socket.on("delete_message", async (data) => {
    try {
      await Message.deleteOne({ id: data.id });
      io.to(data.room).emit("message_deleted", data);
    } catch (e) {
      console.error(e);
    }
  });

  socket.on("edit_message", async (data) => {
    try {
      await Message.updateOne({ id: data.id }, { text: data.newText });
      io.to(data.room).emit("message_updated", data);
    } catch (e) {
      console.error(e);
    }
  });

  socket.on("disconnect", () => {
    connectedUsers.delete(socket.id);
    io.emit("update_online_users", Array.from(connectedUsers.values()));
  });
});

server.listen(4000, () =>
  console.log(`ChatPata Integrated server running at http://localhost:4000`),
);
