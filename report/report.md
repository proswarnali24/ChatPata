# Detailed Report: Experiments, Design, and Protocol Layer Observations

## 1. Objective
Build a framework-based Node.js chat system with:
- Single server and multiple concurrent clients
- Chatrooms (group communication)
- One-to-one messaging
- Text and media transfer (image/video/file)
- Robust join/leave handling
- Extra capabilities:
  1. Soft trolling detection and non-harsh de-escalation
  2. Confirmation before sending OTP/private-looking content to a group

## 2. Frameworks and Runtime
### 2.1 Node.js Runtime
Node.js event loop enables non-blocking I/O for multiple concurrent sockets.

### 2.2 Express (Web Application Framework)
Express is used as the HTTP wrapper to host server status routes and provide a stable process lifecycle around the chat service.

### 2.3 Socket.IO (Real-Time Communication Framework)
Socket.IO provides event-based communication on top of transport upgrades (WebSocket preferred), simplifying pub/sub style chat semantics and connection lifecycle events.

### 2.4 Additional Libraries
- `readline`: CLI user interaction
- `mime-types`: media MIME tagging
- `axios`: optional LLM API call for gentle moderation responses
- `dotenv`: environment-driven configuration

## 3. System Architecture
### 3.1 Components
- **Server** (`server/index.js`)
  - Tracks users, rooms, pending OTP confirmation requests, and blocked topics
  - Routes messages/events
  - Runs moderation and privacy checks
- **Client** (`client/index.js`)
  - Terminal interface
  - Supports command-based and plain-text messaging flows
- **Shared contract** (`shared/events.js`)
  - Explicit event name constants to keep client/server protocol consistent

### 3.2 Communication Model
- Client connects and registers with username
- Server places user in default room (`lobby`)
- Messages are routed by event type:
  - room text/media -> room broadcast
  - DM text -> target socket + echo sender

## 4. Event Protocol and Logical Layers
The system creates layered behavior over TCP/IP:

1. **Application Layer**
   - Custom chat event protocol (`client:*`, `server:*`)
   - Message semantics (DM, room chat, moderation signals, OTP confirm)
2. **Session/Transport Behavior (library-managed)**
   - Socket.IO acknowledgments/event framing
   - Connection/disconnection lifecycle events
3. **Transport Layer**
   - WebSocket over TCP when available (fallbacks possible)
4. **Network + Link + Physical**
   - IP/Ethernet/Wi-Fi handled by OS/network stack

Observation: most protocol complexity for this project resides at the **application event contract layer**, while reliability/order characteristics rely mainly on TCP.

## 5. Design Patterns Encountered
1. **Observer / Publish-Subscribe**
   - `socket.on(event, handler)` and `emit` represent classic observer signaling.
2. **Mediator Pattern**
   - Server acts as mediator: clients do not directly communicate; all routing passes through server.
3. **Reactor Pattern (event loop)**
   - Node.js event loop dispatches handlers for incoming network events.
4. **State Repository Pattern**
   - In-memory maps (`usersBySocket`, `socketByUsername`, pending confirmations) model transient distributed state.
5. **Strategy-like moderation fallback**
   - If external LLM unavailable, local soothing-message strategy is used.

## 6. Feature Implementation Summary
### 6.1 Multi-client concurrency
Any number of clients can connect concurrently; each receives room and system events in real time.

### 6.2 Chatrooms
- `JOIN_ROOM`, `LEAVE_ROOM` events
- Broadcast to all sockets in room namespace
- Dynamic room discovery via adapter room listing

### 6.3 One-to-one messaging
- Client sends target username + text
- Server resolves username to socket id and routes DM

### 6.4 Media exchange
- Client reads file, base64 encodes payload, and tags MIME type
- Server validates payload size and broadcasts metadata + content to room

### 6.5 Trolling handling (soft approach)
Definition used:
- Presence of insulting terms, or
- Excessive caps + repetitive provocative markers

Action used:
- Do not issue stern warning
- Send calm, supportive redirection message to sender
- Temporarily pause detected topic in that room for a short period (5 minutes)

Optional LLM integration:
- If API key exists, server asks model to produce a gentle response
- Otherwise uses deterministic local soothing template

### 6.6 OTP/private info protection
If room message appears to contain OTP/private code patterns and room has multiple participants:
- Server does not immediately broadcast
- Server sends confirmation prompt with request ID and timeout
- Sender confirms/cancels via `/confirm`
- On confirm, broadcast proceeds with a `privacyConfirmed` marker

## 7. Experiments Performed and Observations
### Experiment A: Baseline room chat
- Setup: 3 clients in `lobby`
- Action: normal text messages
- Observation: all members receive broadcast with timestamp and sender identity.

### Experiment B: Dynamic join/leave
- Setup: users join/leave `project-x`
- Action: send room messages while users disconnect/reconnect
- Observation: no crash on churn; room membership updates continue correctly.

### Experiment C: Direct message routing
- Setup: users `alice`, `bob`, `carol`
- Action: `alice` sends DM to `bob`
- Observation: only `alice` and `bob` receive DM event; `carol` does not.

### Experiment D: Media sharing
- Setup: send image/video file from one client
- Action: `/sendfile room /abs/path/file.png`
- Observation: room members receive media event metadata and payload size; large payloads are rejected by limit.

### Experiment E: Trolling signal
- Setup: provocative/insulting text in room
- Action: sender posts insulting phrase repeatedly
- Observation: server sends soothing de-escalation message to sender and pauses matching topic temporarily.

### Experiment F: OTP in group
- Setup: room with >2 members
- Action: sender posts text containing OTP-like token
- Observation: confirmation challenge is issued; no room broadcast until explicit approval.

## 8. Reliability and Scalability Notes
- Current state is in-memory; process restart clears users/topics/pending requests
- Horizontal scaling would require shared adapter/state (e.g., Redis adapter)
- For production:
  - authentication and authorization
  - end-to-end encryption strategy
  - persistent message storage
  - stronger content policy models
  - file/object storage for media instead of large base64 in message bus

## 9. Security and Privacy Considerations
- Username uniqueness enforced per running server instance
- Basic max payload limit to reduce abuse
- Sensitive data confirmation gate reduces accidental leaks
- Present implementation is instructional and should be hardened before public deployment

## 10. Conclusion
The Node.js + Express + Socket.IO stack supports a clean event-driven architecture for real-time group and direct communication. The additional moderation/privacy controls demonstrate how application-level protocol layers can enforce social safety and confidentiality workflows while preserving smooth user experience.
