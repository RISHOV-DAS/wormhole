# 🕳️ Wormhole P2P

Wormhole is a terminal-based Peer-to-Peer (P2P) application for anonymous secure chat and **resumable** file transfer. It uses the Hyperswarm DHT for decentralized peer discovery — no servers, no accounts, no tracking. Just a shared secret and a direct encrypted pipe between peers.

---

## ✨ Features

| Feature | Description |
|:--------|:------------|
| 🔐 **Anonymous Rooms** | Join rooms using any secret phrase — hashed into a 32-byte SHA-256 discovery key. No usernames, no sign-ups. |
| 💬 **Real-time Chat** | Broadcast encrypted text messages to all peers in the room instantly. |
| 📁 **Resumable File Transfer** | Stream files & folders directly between peers with automatic resume on disconnect. |
| 🌐 **LAN Discovery** | Automatically finds peers on the same local network via UDP broadcast, bypassing the need for an internet connection. |
| 🎨 **Colorful Terminal UI** | Gradient ASCII art banner, color-coded labels, rainbow nicknames, styled progress bars, and emoji accents. |
| 🐚 **Interactive Shell** | Unified REPL interface — chat, send, and receive all in one session. |
| 🌍 **No Central Server** | Uses the global [Hyperswarm](https://github.com/holepunchto/hyperswarm) DHT for peer discovery. Nothing to host. |
| 🔒 **End-to-End Encryption** | All connections use the [Noise protocol](https://noiseprotocol.org/) for authenticated encryption. |
| ⚡ **NAT Traversal** | Built-in UDP hole punching — works behind most home/office NATs. |

---


## 📦 Project Structure

```
wormhole/
├── client/                     # Node.js CLI application
│   ├── bin/
│   │   └── wormhole.js         # Entry point
│   ├── src/
│   │   ├── cli.js              # Commander.js command definitions
│   │   ├── shell.js            # Interactive REPL shell
│   │   ├── chat.js             # Standalone chat mode
│   │   ├── transfer.js         # Resumable file transfer engine
│   │   ├── networking.js       # Hyperswarm connection management
│   │   ├── crypto.js           # SHA-256 room key hashing
│   │   ├── lan.js              # LAN peer discovery (UDP broadcast)
│   │   └── ui.js               # Terminal styling & color helpers
│   ├── package.json
│   └── package-lock.json
├── .gitignore
├── LICENSE                     # MIT License
└── README.md
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** v18 or higher ([download](https://nodejs.org/))

### Installation

```bash
# Install globally from npm
npm install -g @rishov28/wormhole
```

Or install from source:

```bash
# Clone the repository
git clone https://github.com/RISHOV-DAS/wormhole
cd wormhole/client

# Install dependencies and link globally
npm install
npm link
```

### Quick Start

```bash
# Launch the interactive shell
node client/bin/wormhole.js

# Or if linked globally
wormhole
```

---

## 🎮 Usage

### Interactive Shell

The default mode. Launch with `wormhole` or `node client/bin/wormhole.js`:

| Command | Description |
|:--------|:------------|
| `/host <room_name>` or `/join <room_name>` | Join or create a room. The room name acts as a password — anyone with the same phrase joins the same room. |
| `/nick <name>` | Set your display nickname for chat messages. |
| `/chat <message>` | Send a message to all peers. You can also just type text without the `/chat` prefix. |
| `/send <path>` | Send a file or folder to all connected peers. |
| `/receive <path>` | Receive incoming transfers into the specified directory. |
| `/quit` or `/exit` | Exit the application. |

### Direct CLI Commands

You can also use single-purpose commands without entering the interactive shell:

```bash
# Send a file or folder
wormhole send ./my-folder -r "secret-room-key"

# Receive into a directory
wormhole receive ./downloads -r "secret-room-key"

# Join a chat room
wormhole chat -r "secret-room-key" -n "Alice"
```

---

## 💡 Example Workflow

### Scenario: Alice sends a project folder to Bob

**Alice (Sender):**
```text
$ wormhole

  /nick Alice
  ✓ Nickname set to: Alice

  /host secret-tunnel-v1
  [Info] Hashing room secret-tunnel-v1...
  [Info] Topic: a3f8c2...
  [System] Joining swarm...
  ✓ Joined room: secret-tunnel-v1

  /send ./my-project
  [Sender] Initiating transfer for: ./my-project
  [Sender] Transfer mode active. 📤
```

**Bob (Receiver):**
```text
$ wormhole

  /nick Bob
  ✓ Nickname set to: Bob

  /host secret-tunnel-v1
  ✓ Joined room: secret-tunnel-v1

  [System] Peer a3f8c2d1 connected ⚡

  /receive ./downloads
  [Receiver] Ready to receive into: ./downloads 📥
  [Receiver] Transfer finished. ✅
```

**Chatting** — just type text after joining a room:
```text
  Hello Bob! File is on its way.
  │ 12:30:45 Alice: Hello Bob! File is on its way.

  │ 12:30:48 Bob: Got it, thanks!
```

---

## 🏗️ Architecture

```
┌──────────────┐         DHT Discovery + LAN Broadcast         ┌──────────────┐
│   Peer A     │◄──────────────────────────────────────────────►│   Peer B     │
│              │                                                │              │
│  ┌────────┐  │         Noise-encrypted TCP Stream             │  ┌────────┐  │
│  │ Sender │──┼───────────────────────────────────────────────►│──│Receiver│  │
│  └────────┘  │                                                │  └────────┘  │
│              │             JSON Chat Messages                 │              │
│  ┌────────┐  │◄──────────────────────────────────────────────►│  ┌────────┐  │
│  │  Chat  │──┼───────────────────────────────────────────────►│──│  Chat  │  │
│  └────────┘  │                                                │  └────────┘  │
└──────────────┘                                                └──────────────┘
```

### How It Works

1. **Room Discovery** — The room name is hashed with SHA-256 to produce a 32-byte **topic**. Peer discovery happens in two ways simultaneously:
   - **Hyperswarm DHT:** Peers announce and look up the topic on the global DHT to find peers across the internet.
   - **LAN Broadcast:** Peers broadcast their topic via UDP on the local network to find nearby peers without relying on the DHT.

2. **Connection** — Once peers find each other (either via DHT or LAN), they establish a direct, encrypted TCP connection using the **Noise protocol**. For internet peers, this involves automatic NAT traversal (UDP hole punching).

3. **Chat** — Messages are JSON objects (`{ type: "CHAT", nick, text, timestamp }`) broadcast to all active connections.

4. **File Transfer** — The transfer protocol works as follows:
   - **Sender** packs the file/folder into a `tar` stream using `tar-fs`.
   - **Receiver** sends a `HANDSHAKE` message with its current `receivedBytes` count.
   - **Sender** skips already-sent bytes from the stream and sends the remainder.
   - **Receiver** appends the incoming data to a temporary `.wormhole_transfer.tar.part` file and extracts it on completion.
   - On reconnection, this handshake ensures the transfer resumes exactly where it left off.

### Key Technologies

| Technology | Role |
|:-----------|:-----|
| [Hyperswarm](https://github.com/holepunchto/hyperswarm) | DHT-based peer discovery and NAT traversal |
| **LAN Discovery** | UDP broadcast and direct TCP for local network peers |
| [Noise Protocol](https://noiseprotocol.org/) | End-to-end authenticated encryption |
| [tar-fs](https://github.com/mafintosh/tar-fs) | Streaming file/folder packing and extraction |
| [Commander.js](https://github.com/tj/commander.js) | CLI argument parsing |
| [chalk](https://github.com/chalk/chalk) | Terminal color styling |
| [gradient-string](https://github.com/bokub/gradient-string) | Multi-color gradient text rendering |
| [cli-progress](https://github.com/npkgz/cli-progress) | Terminal progress bars |

---

## 🔧 Troubleshooting

| Problem | Solution |
|:--------|:---------|
| **Connection drops mid-transfer** | The shell keeps the swarm alive. Re-issue `/send` or `/receive` — the handshake protocol will auto-resume from the last byte. |
| **Peers can't find each other** | Ensure both peers use the **exact same room name** (it's case-sensitive). If on the same Wi-Fi, LAN discovery should connect them even if the internet is down. |
| **Firewall blocking connections** | Hyperswarm uses UDP hole punching for NAT traversal, but aggressive firewalls may block it. **LAN discovery** provides a reliable fallback for peers on the same local network. |
| **Transfer seems stuck** | Large files take time. The receiver writes to `.wormhole_transfer.tar.part` — check its growing size to confirm data is flowing. |
| **`EISDIR` error when sending** | Fixed in v1.0 — single files are now handled correctly by packing the parent directory with the file as a named entry. |

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

Copyright © 2026 Rishov

---

<p align="center">
  <b>Made with ❤️ for privacy and freedom</b><br/>
  <i>No servers were harmed in the making of this application.</i>
</p>
