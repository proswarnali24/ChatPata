# ChatPata

ChatPata is a real-time chat application built with Node.js, Express, Socket.IO, and MongoDB. It supports group chat, private messaging, image sharing, authentication, and a lightweight toxicity calming flow backed by Gemini when an API key is available.

## Features

- User registration and login with hashed passwords
- Group chat with dynamic room creation and room history
- Private messaging between online users
- Image upload and preview inside chat
- Online user list and unread message badges
- MongoDB-backed persistence for users, rooms, and messages
- Basic OTP/privacy warning before sending 6-digit codes
- AI-assisted calming response for repeated toxic messages, with a local fallback

## Tech Stack

- Node.js
- Express
- Socket.IO
- MongoDB with Mongoose
- JSON Web Tokens
- Vanilla HTML, CSS, and JavaScript

## Project Structure

```text
.
|-- public/
|   |-- index.html
|   |-- script.js
|   `-- style.css
|-- integrations/
|   `-- IT-College-main2/Assignment_3/
|-- legacy/
|-- report/
|-- server.js
|-- package.json
`-- README.md
```

## Setup

1. Clone the repository.
2. Open the project folder:

```bash
cd ChatPata
```

3. Install dependencies:

```bash
npm install
```

4. Create a `.env` file in the project root:

```env
PORT=4000
MONGO_URI=mongodb://127.0.0.1:27017/chatpata
JWT_SECRET=replace_this_with_a_strong_secret
GEMINI_API_KEY=
```

5. Start the server:

```bash
npm start
```

6. Open the app in your browser:

```text
http://localhost:4000
```

## MongoDB Notes

- If `MONGO_URI` is missing, the app falls back to `mongodb://localhost:27017/chatpata`.
- For MongoDB Atlas, use your full Atlas connection string in `.env`.
- Make sure your Atlas IP access list, username, password, and cluster hostname are valid.

## Available Scripts

- `npm start`: start the server
- `npm run server`: start the server

## Assignment Assets

This repository also keeps:

- `integrations/IT-College-main2/Assignment_3` as the integrated assignment reference copy
- `legacy/` as preserved older versions of the project

## Security

- Do not commit `.env` or credentials.
- If a database password was exposed anywhere, rotate it before publishing the repository.

## License

MIT
