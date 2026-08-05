'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const mime = require('mime-types');
const { io } = require('socket.io-client');
const { CLIENT, SERVER } = require('../shared/events');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: true
});

function ask(question, fallback = '') {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      const trimmed = String(answer || '').trim();
      resolve(trimmed || fallback);
    });
  });
}

function prettyTs(ts) {
  const d = ts ? new Date(ts) : new Date();
  return d.toLocaleTimeString();
}

function printHelp() {
  console.log(`\nCommands:
  /help                              Show commands
  /users                             Show online users
  /rooms                             Show rooms and member counts
  /join <room>                       Join chatroom
  /leave <room>                      Leave chatroom (except lobby)
  /use <room>                        Set current active room
  /room <room> <message>             Send room text message
  /dm <username> <message>           Send direct message
  /sendfile <room> <absolute-path>   Send image/video/file to a room
  /confirm <requestId> <yes|no>      Confirm OTP/private info sharing
  /quit                              Exit client

Typing plain text sends to current room.
`);
}

async function boot() {
  const serverURL = await ask('Server URL (default http://localhost:3000): ', 'http://localhost:3000');
  const username = await ask('Username: ');

  if (!username) {
    console.error('Username is required.');
    process.exit(1);
  }

  const socket = io(serverURL, { transports: ['websocket'] });

  let currentRoom = 'lobby';
  let knownUsers = [];
  let knownRooms = [];

  socket.on('connect', () => {
    console.log(`[${prettyTs()}] Connected to ${serverURL}`);
    socket.emit(CLIENT.REGISTER, { username });
  });

  socket.on(SERVER.REGISTERED, (payload) => {
    currentRoom = payload.defaultRoom || 'lobby';
    console.log(`[${prettyTs(payload.ts)}] Registered as '${payload.username}'. Current room: ${currentRoom}`);
    printHelp();
  });

  socket.on(SERVER.SYSTEM, (msg) => {
    console.log(`[${prettyTs(msg.ts)}] [system] ${msg.message}`);
  });

  socket.on(SERVER.USER_JOINED, (evt) => {
    console.log(`[${prettyTs(evt.ts)}] [room:${evt.room}] ${evt.username} joined.`);
  });

  socket.on(SERVER.USER_LEFT, (evt) => {
    console.log(`[${prettyTs(evt.ts)}] ${evt.username} disconnected.`);
  });

  socket.on(SERVER.ROOM_MESSAGE, (msg) => {
    const tag = msg.privacyConfirmed ? ' [privacy-confirmed]' : '';
    console.log(`[${prettyTs(msg.ts)}] [${msg.room}] ${msg.from}: ${msg.text}${tag}`);
  });

  socket.on(SERVER.ROOM_MEDIA, (msg) => {
    const bytes = Buffer.byteLength(msg.media.base64 || '', 'base64');
    console.log(
      `[${prettyTs(msg.ts)}] [${msg.room}] ${msg.from} sent media: ${msg.media.name} (${msg.media.mimeType}, ${bytes} bytes)`
    );
  });

  socket.on(SERVER.DIRECT_MESSAGE, (dm) => {
    console.log(`[${prettyTs(dm.ts)}] [DM ${dm.from} -> ${dm.to}] ${dm.text}`);
  });

  socket.on(SERVER.OTP_CONFIRM_REQUEST, (req) => {
    console.log(`[${prettyTs(req.ts)}] [privacy-check] ${req.prompt}`);
    console.log(`  Request ID: ${req.requestId}`);
    console.log(`  Confirm with: /confirm ${req.requestId} yes`);
    console.log(`  Cancel with:  /confirm ${req.requestId} no`);
  });

  socket.on(SERVER.USER_LIST, (users) => {
    knownUsers = Array.isArray(users) ? users : [];
  });

  socket.on(SERVER.ROOM_LIST, (rooms) => {
    knownRooms = Array.isArray(rooms) ? rooms : [];
  });

  socket.on('disconnect', () => {
    console.log(`[${prettyTs()}] Disconnected from server.`);
  });

  rl.on('line', (line) => {
    const input = String(line || '').trim();
    if (!input) return;

    if (input === '/help') {
      printHelp();
      return;
    }

    if (input === '/users') {
      console.log(`Online users: ${knownUsers.length ? knownUsers.join(', ') : '(none)'}`);
      return;
    }

    if (input === '/rooms') {
      if (!knownRooms.length) {
        console.log('Rooms: (none)');
      } else {
        console.log('Rooms:');
        for (const r of knownRooms) console.log(`  - ${r.name} (${r.members} members)`);
      }
      return;
    }

    if (input === '/quit') {
      socket.disconnect();
      rl.close();
      process.exit(0);
    }

    if (input.startsWith('/join ')) {
      const room = input.slice(6).trim().toLowerCase();
      if (!room) return console.log('Usage: /join <room>');
      socket.emit(CLIENT.JOIN_ROOM, { room });
      currentRoom = room;
      console.log(`Active room set to '${currentRoom}'`);
      return;
    }

    if (input.startsWith('/leave ')) {
      const room = input.slice(7).trim().toLowerCase();
      if (!room) return console.log('Usage: /leave <room>');
      socket.emit(CLIENT.LEAVE_ROOM, { room });
      if (currentRoom === room) currentRoom = 'lobby';
      return;
    }

    if (input.startsWith('/use ')) {
      const room = input.slice(5).trim().toLowerCase();
      if (!room) return console.log('Usage: /use <room>');
      currentRoom = room;
      console.log(`Active room is now '${currentRoom}'`);
      return;
    }

    if (input.startsWith('/room ')) {
      const parts = input.split(' ');
      if (parts.length < 3) return console.log('Usage: /room <room> <message>');
      const room = parts[1].trim().toLowerCase();
      const message = input.slice(7 + room.length).trim();
      socket.emit(CLIENT.SEND_ROOM_TEXT, { room, text: message });
      return;
    }

    if (input.startsWith('/dm ')) {
      const parts = input.split(' ');
      if (parts.length < 3) return console.log('Usage: /dm <username> <message>');
      const to = parts[1].trim();
      const message = input.slice(5 + to.length).trim();
      socket.emit(CLIENT.SEND_DM_TEXT, { to, text: message });
      return;
    }

    if (input.startsWith('/sendfile ')) {
      const match = input.match(/^\/sendfile\s+(\S+)\s+(.+)$/);
      if (!match) return console.log('Usage: /sendfile <room> <absolute-path>');

      const room = match[1].toLowerCase();
      const filePath = match[2].trim();
      const resolved = path.resolve(filePath);

      if (!fs.existsSync(resolved)) {
        return console.log(`File not found: ${resolved}`);
      }

      const data = fs.readFileSync(resolved);
      const mimeType = mime.lookup(resolved) || 'application/octet-stream';

      socket.emit(CLIENT.SEND_ROOM_MEDIA, {
        room,
        media: {
          name: path.basename(resolved),
          mimeType,
          base64: data.toString('base64')
        }
      });

      console.log(`Sent file '${path.basename(resolved)}' to room '${room}'.`);
      return;
    }

    if (input.startsWith('/confirm ')) {
      const parts = input.split(/\s+/);
      if (parts.length !== 3) return console.log('Usage: /confirm <requestId> <yes|no>');
      const requestId = parts[1];
      const decision = parts[2].toLowerCase();
      const approve = decision === 'yes' || decision === 'y';
      if (!['yes', 'y', 'no', 'n'].includes(decision)) {
        return console.log('Decision must be yes/y/no/n');
      }
      socket.emit(CLIENT.OTP_CONFIRM, { requestId, approve });
      return;
    }

    socket.emit(CLIENT.SEND_ROOM_TEXT, { room: currentRoom, text: input });
  });
}

boot().catch((err) => {
  console.error('Client error:', err.message);
  process.exit(1);
});
