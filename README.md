# 💬 ChatPata — Full-Stack Real-Time Chat Platform

[![Live Demo](https://img.shields.io/badge/Live_Demo-Render-brightgreen?style=for-the-badge&logo=render)](https://chatpata-cpjw.onrender.com)
[![Node.js](https://img.shields.io/badge/Node.js-18.x-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![Express.js](https://img.shields.io/badge/Express.js-4.x-000000?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-4.x-010101?style=for-the-badge&logo=socketdotio&logoColor=white)](https://socket.io)
[![MongoDB Atlas](https://img.shields.io/badge/MongoDB_Atlas-Cloud-47A248?style=for-the-badge&logo=mongodb&logoColor=white)](https://www.mongodb.com/cloud/atlas)

**ChatPata** is a modern, high-performance, real-time messaging application designed with a sleek **Glassmorphism UI**, secure **JWT authentication**, bi-directional **Socket.IO WebSockets**, **MongoDB Atlas cloud storage**, and interactive features like **live typing indicators**, **categorized emoji picker**, and **audio notification chimes**.

🌐 **Live Production Link**: [https://chatpata-cpjw.onrender.com](https://chatpata-cpjw.onrender.com)

---

## ✨ Features

- 🔐 **User Authentication System**: Secure user sign up, login, password hashing using `bcryptjs`, 7-day JWT session management, and auto-login recovery.
- ⚡ **Real-Time Group Channels**: Multi-room group messaging with live socket subscriptions (`socket.join`) ensuring zero dropped messages across active tabs.
- 💬 **1-on-1 Private Messaging**: Instant private chats between online users with unread message badges.
- ✍️ **In-Body Animated Typing Indicators**: WhatsApp/iMessage-style 3-dot bouncing animated typing bubble that pops up live inside the chat window.
- 😀 **Categorized Emoji Picker**: Interactive popover with 6 categories (*Smileys, Gestures, Hearts, Animals, Food, Objects*) and cursor-position text insertion.
- 🔔 **Notifications & Sound Engine**: Synthesized dual-tone Web Audio API sound chimes, floating glassmorphic toast notification popups, and red unread counter badges.
- 🖼️ **Image & File Attachments**: In-app image preview and base64 upload to server storage.
- ☁️ **MongoDB Atlas Cloud Database**: Cloud persistence for users, channels, and message history, backed by an automatic local JSON storage fallback.
- 🛡️ **Built-in Auto-Moderation**: Anti-trolling and rapid spam protection with comforting system responses.

---

## 🛠️ Technology Stack

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Backend** | Node.js, Express | Server REST API endpoints (`/register`, `/login`, `/me`) |
| **Real-Time API** | Socket.IO | Bi-directional WebSocket event communication |
| **Database** | MongoDB Atlas, Mongoose | Cloud persistence for user accounts and room messages |
| **Security** | JWT, bcryptjs | Encrypted passwords and authenticated user sessions |
| **Frontend** | Vanilla HTML5, CSS3, ES6 JS | Glassmorphic design, Web Audio API, dynamic DOM |
| **Hosting** | Render.com | Cloud web service deployment |

---

## 📁 Folder Structure

```text
ChatPata-main/
├── server.js            # Node.js Express server, JWT auth & Socket.IO handlers
├── .env                 # Environment configurations & database credentials
├── package.json         # Project dependencies & scripts
├── public/              # Static frontend assets
│   ├── index.html       # Single Page Application HTML & popover markup
│   ├── style.css        # Glassmorphism UI tokens, dark mode & animations
│   ├── script.js        # Socket listeners, auth flow, emoji picker & sound engine
│   └── uploads/         # Server-stored image attachments
└── README.md            # Comprehensive project documentation
```

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v16.0.0 or higher)
- [npm](https://www.npmjs.com/) (v8.0.0 or higher)
- [MongoDB Atlas Account](https://www.mongodb.com/cloud/atlas) (or local MongoDB server)

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/proswarnali24/ChatPata.git
   cd ChatPata
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment Variables**:
   Create a `.env` file in the root directory:
   ```env
   PORT=4000
   MONGO_URI=mongodb+srv://<db_username>:<db_password>@cluster0.qotlt2q.mongodb.net/chatpata?retryWrites=true&w=majority
   JWT_SECRET=your_super_secret_jwt_key
   ```

4. **Run the Server**:
   ```bash
   npm start
   ```

5. **Open in Browser**:
   Navigate to `http://localhost:4000`

---

## 🔑 Environment Variables

| Variable | Description | Default / Example |
| :--- | :--- | :--- |
| `PORT` | Server listening port | `4000` |
| `MONGO_URI` | MongoDB Atlas Connection String | `mongodb+srv://...` |
| `JWT_SECRET` | Secret key for signing JWT tokens | `chatpata_secret_key` |

---

## 🌐 Deployment

### Deploying to Render.com
1. Connect your GitHub repository `proswarnali24/ChatPata` to **Render Web Services**.
2. **Build Command**: `npm install`
3. **Start Command**: `npm start`
4. **Environment Variables**: Add `MONGO_URI` and `JWT_SECRET`.

---

## 👤 Author & License

Developed with ❤️ by **[Swarnali](https://github.com/proswarnali24)**.

This project is licensed under the **MIT License** — feel free to modify and use!
