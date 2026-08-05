'use strict';

require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { CLIENT, SERVER } = require('../shared/events');

const PORT = Number(process.env.PORT || 3000);
const DEFAULT_ROOM = 'lobby';
const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
const OTP_CONFIRM_TTL_MS = 45 * 1000;
const TOPIC_BLOCK_TTL_MS = 5 * 60 * 1000;
const JWT_SECRET = process.env.JWT_SECRET || 'chatpata_jwt_secret_change_me';
const MONGO_URI = String(process.env.MONGO_URI || '').trim();

const usersBySocket = new Map();
const socketByUsername = new Map();
const pendingOtpConfirms = new Map();
const blockedTopicsByRoom = new Map();
const inMemoryUsers = new Map();

let mongoReady = false;
let User = null;

const app = express();
app.use(express.json({ limit: '8mb' }));
app.use(express.static(path.join(__dirname, '..', 'web')));

const userSchema = new mongoose.Schema(
  {
    username: { type: String, unique: true, required: true, trim: true },
    password: { type: String, required: true }
  },
  { timestamps: true }
);

if (MONGO_URI) {
  User = mongoose.model('User', userSchema);
  mongoose
    .connect(MONGO_URI)
    .then(() => {
      mongoReady = true;
      // eslint-disable-next-line no-console
      console.log('MongoDB connected for auth persistence.');
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.warn(`MongoDB connection failed, using in-memory auth store. Reason: ${err.message}`);
    });
} else {
  // eslint-disable-next-line no-console
  console.warn('MONGO_URI not set, using in-memory auth store.');
}

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'web', 'index.html'));
});

app.get('/api/health', (_req, res) => {
  res.json({
    name: 'ChatPata Multi-Client Chat Server',
    status: 'running',
    room: DEFAULT_ROOM,
    usersOnline: usersBySocket.size,
    authStore: mongoReady ? 'mongodb' : 'memory'
  });
});

function cleanUsername(value) {
  return String(value || '').trim();
}

async function findUserByUsername(username) {
  if (mongoReady && User) return User.findOne({ username });

  const password = inMemoryUsers.get(username);
  if (!password) return null;
  return { username, password };
}

async function createUser(username, passwordHash) {
  if (mongoReady && User) return User.create({ username, password: passwordHash });

  if (inMemoryUsers.has(username)) {
    const err = new Error('duplicate');
    err.code = 'DUPLICATE_USER';
    throw err;
  }
  inMemoryUsers.set(username, passwordHash);
  return { username, password: passwordHash };
}

function signAuthToken(username) {
  return jwt.sign({ username }, JWT_SECRET, { expiresIn: '2h' });
}

function verifyAuthToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (_err) {
    return null;
  }
}

app.post('/api/auth/register', async (req, res) => {
  const username = cleanUsername(req.body?.username);
  const password = String(req.body?.password || '').trim();

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters.' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    await createUser(username, passwordHash);
    return res.json({ ok: true, username });
  } catch (err) {
    if (err?.code === 11000 || err?.code === 'DUPLICATE_USER') {
      return res.status(409).json({ error: 'Username already exists.' });
    }
    return res.status(500).json({ error: 'Registration failed.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const username = cleanUsername(req.body?.username);
  const password = String(req.body?.password || '').trim();

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  try {
    const user = await findUserByUsername(username);
    if (!user) return res.status(401).json({ error: 'Invalid username or password.' });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Invalid username or password.' });

    return res.json({ ok: true, username, token: signAuthToken(username) });
  } catch (_err) {
    return res.status(500).json({ error: 'Login failed.' });
  }
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: MAX_MEDIA_BYTES + 1024
});

function nowISO() {
  return new Date().toISOString();
}

function normalizeTopic(text) {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => w.length > 3);
  return tokens.slice(0, 3).join(' ');
}

function containsOTPOrSensitiveData(text) {
  const otpPatterns = [
    /\botp\b/i,
    /\bone[- ]?time[- ]?password\b/i,
    /\bverification code\b/i,
    /\b(passcode|pin)\b/i,
    /\b\d{4,8}\b/
  ];
  return otpPatterns.some((rx) => rx.test(text));
}

function detectTrolling(text) {
  const lower = text.toLowerCase();
  const toxicTerms = ['idiot', 'stupid', 'moron', 'shut up', 'loser', 'hate you'];
  const strongInsultCount = toxicTerms.filter((term) => lower.includes(term)).length;

  const uppercaseRatio = text.replace(/[^A-Z]/g, '').length / Math.max(text.replace(/\s/g, '').length, 1);
  const excessiveCaps = uppercaseRatio > 0.65 && text.length > 18;
  const repeatedProvocation = /(ha){4,}|(lol){5,}|!!!{2,}/i.test(lower);

  const isTrolling = strongInsultCount >= 1 || (excessiveCaps && repeatedProvocation);
  const topic = normalizeTopic(text) || 'current-topic';

  return { isTrolling, topic, confidence: isTrolling ? 0.6 + strongInsultCount * 0.1 : 0.1 };
}

async function generateSoothingMessage(originalText) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return 'I might be reading tension here. Let us reset the tone and keep the chat constructive. You are welcome to continue on a calmer angle.';
  }

  try {
    const resp = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0.5,
        messages: [
          {
            role: 'system',
            content:
              'You are a calm moderator. Reply with one short, supportive message that gently redirects heated chat. Avoid scolding.'
          },
          {
            role: 'user',
            content: `Context message: ${originalText}`
          }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 5000
      }
    );

    const content = resp.data?.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error('No content');
    return content;
  } catch (_err) {
    return 'Thanks for sharing. This topic is getting heated, so let us take a breath and continue with respectful language.';
  }
}

function sendSystem(socket, message, meta = {}) {
  socket.emit(SERVER.SYSTEM, {
    type: 'system',
    message,
    ts: nowISO(),
    ...meta
  });
}

function broadcastUserAndRoomLists() {
  const users = [...socketByUsername.keys()].sort();

  const rooms = [];
  for (const [roomName, room] of io.sockets.adapter.rooms.entries()) {
    if (!io.sockets.sockets.has(roomName)) {
      rooms.push({ name: roomName, members: room.size });
    }
  }

  io.emit(SERVER.USER_LIST, users);
  io.emit(SERVER.ROOM_LIST, rooms.sort((a, b) => a.name.localeCompare(b.name)));
}

function isSocketInRoom(socket, room) {
  return socket.rooms.has(room);
}

function cleanupExpiredBlocks() {
  const now = Date.now();
  for (const [, topicMap] of blockedTopicsByRoom.entries()) {
    for (const [topic, expiresAt] of topicMap.entries()) {
      if (expiresAt <= now) topicMap.delete(topic);
    }
  }
}

function roomTopicIsBlocked(room, text) {
  cleanupExpiredBlocks();

  const topicMap = blockedTopicsByRoom.get(room);
  if (!topicMap || topicMap.size === 0) return null;

  const lower = text.toLowerCase();
  for (const [topic, expiresAt] of topicMap.entries()) {
    if (lower.includes(topic) && expiresAt > Date.now()) return topic;
  }
  return null;
}

function blockTopic(room, topic) {
  if (!blockedTopicsByRoom.has(room)) blockedTopicsByRoom.set(room, new Map());
  blockedTopicsByRoom.get(room).set(topic, Date.now() + TOPIC_BLOCK_TTL_MS);
}

function getUsername(socket) {
  return usersBySocket.get(socket.id)?.username || 'unknown';
}

io.on('connection', (socket) => {
  sendSystem(socket, 'Connected. Authenticate, then register with your username.');

  socket.on(CLIENT.REGISTER, ({ username, token }) => {
    const cleaned = cleanUsername(username);
    if (!cleaned) {
      return sendSystem(socket, 'Registration failed: username cannot be empty.');
    }

    if (token) {
      const decoded = verifyAuthToken(token);
      if (!decoded || decoded.username !== cleaned) {
        return sendSystem(socket, 'Registration failed: invalid auth token.');
      }
    }

    if (socketByUsername.has(cleaned)) {
      return sendSystem(socket, 'Registration failed: username already in use.');
    }

    usersBySocket.set(socket.id, { username: cleaned, joinedAt: nowISO() });
    socketByUsername.set(cleaned, socket.id);
    socket.join(DEFAULT_ROOM);

    socket.emit(SERVER.REGISTERED, {
      username: cleaned,
      defaultRoom: DEFAULT_ROOM,
      ts: nowISO()
    });

    io.to(DEFAULT_ROOM).emit(SERVER.USER_JOINED, {
      username: cleaned,
      room: DEFAULT_ROOM,
      ts: nowISO()
    });

    broadcastUserAndRoomLists();
  });

  socket.on(CLIENT.JOIN_ROOM, ({ room }) => {
    const roomName = String(room || '').trim().toLowerCase();
    if (!roomName) return sendSystem(socket, 'Room name cannot be empty.');

    socket.join(roomName);
    io.to(roomName).emit(SERVER.SYSTEM, {
      type: 'room-event',
      room: roomName,
      message: `${getUsername(socket)} joined ${roomName}.`,
      ts: nowISO()
    });
    broadcastUserAndRoomLists();
  });

  socket.on(CLIENT.LEAVE_ROOM, ({ room }) => {
    const roomName = String(room || '').trim().toLowerCase();
    if (!roomName) return;
    if (roomName === DEFAULT_ROOM) {
      return sendSystem(socket, 'You cannot leave the default lobby room.');
    }

    socket.leave(roomName);
    io.to(roomName).emit(SERVER.SYSTEM, {
      type: 'room-event',
      room: roomName,
      message: `${getUsername(socket)} left ${roomName}.`,
      ts: nowISO()
    });
    broadcastUserAndRoomLists();
  });

  socket.on(CLIENT.SEND_ROOM_TEXT, async ({ room, text }) => {
    const roomName = String(room || '').trim().toLowerCase();
    const message = String(text || '').trim();
    if (!roomName || !message) return;

    if (!isSocketInRoom(socket, roomName)) {
      return sendSystem(socket, `You are not in room '${roomName}'. Join it first.`);
    }

    const blockedTopic = roomTopicIsBlocked(roomName, message);
    if (blockedTopic) {
      return sendSystem(
        socket,
        `Let us avoid revisiting '${blockedTopic}' for now. You can continue with a different angle.`,
        { room: roomName, topicBlocked: blockedTopic }
      );
    }

    const trollSignal = detectTrolling(message);
    if (trollSignal.isTrolling && trollSignal.confidence >= 0.65) {
      blockTopic(roomName, trollSignal.topic);
      const gentleMessage = await generateSoothingMessage(message);
      sendSystem(socket, gentleMessage, {
        moderation: {
          action: 'topic-temporarily-paused',
          room: roomName,
          topic: trollSignal.topic,
          blockForSeconds: Math.round(TOPIC_BLOCK_TTL_MS / 1000)
        }
      });
      return;
    }

    const roomMemberCount = io.sockets.adapter.rooms.get(roomName)?.size || 0;
    if (roomMemberCount > 2 && containsOTPOrSensitiveData(message)) {
      const requestId = `${socket.id}:${Date.now()}`;
      pendingOtpConfirms.set(requestId, {
        socketId: socket.id,
        room: roomName,
        text: message,
        expiresAt: Date.now() + OTP_CONFIRM_TTL_MS
      });

      socket.emit(SERVER.OTP_CONFIRM_REQUEST, {
        requestId,
        room: roomName,
        prompt:
          'This looks like private information (OTP/PIN/code). Send to room anyway? Confirm within 45 seconds.',
        ts: nowISO()
      });
      return;
    }

    io.to(roomName).emit(SERVER.ROOM_MESSAGE, {
      room: roomName,
      from: getUsername(socket),
      text: message,
      ts: nowISO()
    });
  });

  socket.on(CLIENT.OTP_CONFIRM, ({ requestId, approve }) => {
    const pending = pendingOtpConfirms.get(requestId);
    if (!pending) return sendSystem(socket, 'Confirmation request not found or expired.');

    pendingOtpConfirms.delete(requestId);

    if (pending.socketId !== socket.id) {
      return sendSystem(socket, 'Only original sender can confirm this request.');
    }

    if (pending.expiresAt < Date.now()) {
      return sendSystem(socket, 'Confirmation expired. Message was not sent.');
    }

    if (!approve) {
      return sendSystem(socket, 'Sensitive message was cancelled.');
    }

    io.to(pending.room).emit(SERVER.ROOM_MESSAGE, {
      room: pending.room,
      from: getUsername(socket),
      text: pending.text,
      ts: nowISO(),
      privacyConfirmed: true
    });

    sendSystem(socket, 'Sensitive message sent to room after confirmation.', { requestId });
  });

  socket.on(CLIENT.SEND_ROOM_MEDIA, ({ room, media }) => {
    const roomName = String(room || '').trim().toLowerCase();
    if (!roomName || !media || typeof media !== 'object') return;

    if (!isSocketInRoom(socket, roomName)) {
      return sendSystem(socket, `You are not in room '${roomName}'. Join it first.`);
    }

    const payloadBytes = Buffer.byteLength(media.base64 || '', 'base64');
    if (!payloadBytes || payloadBytes > MAX_MEDIA_BYTES) {
      return sendSystem(socket, `Media rejected. Max size is ${MAX_MEDIA_BYTES / (1024 * 1024)}MB.`);
    }

    io.to(roomName).emit(SERVER.ROOM_MEDIA, {
      room: roomName,
      from: getUsername(socket),
      media: {
        name: media.name || 'file',
        mimeType: media.mimeType || 'application/octet-stream',
        base64: media.base64
      },
      ts: nowISO()
    });
  });

  socket.on(CLIENT.SEND_DM_TEXT, ({ to, text }) => {
    const target = String(to || '').trim();
    const message = String(text || '').trim();
    if (!target || !message) return;

    const targetSocketId = socketByUsername.get(target);
    if (!targetSocketId) {
      return sendSystem(socket, `User '${target}' is offline.`);
    }

    const dmPayload = {
      from: getUsername(socket),
      to: target,
      text: message,
      ts: nowISO()
    };

    io.to(targetSocketId).emit(SERVER.DIRECT_MESSAGE, dmPayload);
    socket.emit(SERVER.DIRECT_MESSAGE, dmPayload);
  });

  socket.on('disconnect', () => {
    const user = usersBySocket.get(socket.id);
    if (!user) return;

    usersBySocket.delete(socket.id);
    socketByUsername.delete(user.username);

    io.emit(SERVER.USER_LEFT, {
      username: user.username,
      ts: nowISO()
    });

    for (const [requestId, pending] of pendingOtpConfirms.entries()) {
      if (pending.socketId === socket.id) pendingOtpConfirms.delete(requestId);
    }

    broadcastUserAndRoomLists();
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [requestId, pending] of pendingOtpConfirms.entries()) {
    if (pending.expiresAt <= now) pendingOtpConfirms.delete(requestId);
  }
  cleanupExpiredBlocks();
}, 15 * 1000);

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`ChatPata chat server listening on http://localhost:${PORT}`);
});
