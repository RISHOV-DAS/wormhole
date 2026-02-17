# Wormhole P2P 🕳️

Wormhole is a terminal-based Peer-to-Peer (P2P) application for anonymous secure chat and file transfer. It uses a decentralized architecture (DHT) to connect peers without central tracking servers.

## Features

-   **Anonymous Rooms**: Join rooms using any secret phrase. The phrase is hashed to generate a 32-byte discovery key.
-   **Real-time Chat**: Broadcast text messages to all peers in the room.
-   **Resumable File Transfer**: Stream folders directly between peers.
    -   Automatically handles connection drops.
    -   Resumes from the last received byte using a handshake protocol.
    -   Streaming compression via `tar-fs`.
-   **Interactive Shell**: Unified REPL interface for managing connections and transfers.
-   **No Central Server**: The client uses the global Hyperswarm DHT for discovery.

## Project Structure

This is a hybrid project containing:

-   `client/`: The main Node.js CLI application (uses Hyperswarm).

## Prerequisites

-   **Node.js**: v18 or higher.

## Installation

### Client (Node.js)

1.  Navigate to the client directory:
    ```bash
    cd client
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Link the executable globally (optional):
    ```bash
    npm link
    ```
    *This allows you to run `wormhole` from anywhere.*


## Usage

Start the interactive shell:

```bash
# If linked Globaly
wormhole

# Or via Node
node client/bin/wormhole.js
```

### Shell Commands

Once inside the shell, you can use the following commands:

| Command | Description |
| :--- | :--- |
| `/host <room_name>` | Join or host a room. The room name acts as a password. |
| `/nick <name>` | Set your display nickname for chat. |
| `/chat <message>` | Send a message to the room. (Or simply type text). |
| `/send <path>` | Send a file or folder to connected peers. |
| `/receive <path>` | Receive a file or folder from peers into a specific directory. |
| `/quit` | Exit the application. |

### Example Workflow

**Peer A (Sender):**
```text
/nick Alice
/host secret-tunnel-v1
/send ./my-large-folder
```

**Peer B (Receiver):**
```text
/nick Bob
/host secret-tunnel-v1
/receive ./downloads
```

*Peers will automatically discover each other, chat, and transfer files.*

## Architecture Details

### Dual Swarm Topology
To ensures simultaneous, non-blocking operations, the client maintains two separate P2P swarms for every room:
1.  **Chat Swarm** (`hash(room_name)`):
    -   Dedicated to JSON-based control messages (Chat, Status, Etc).
    -   Managed by `Protocol` class.
    -   Always active for real-time communication.
2.  **File Swarm** (`hash(room_name + '-files')`):
    -   Dedicated to binary data transfer.
    -   Ephemeral or persistent connections used solely for streaming `tar` data.
    -   Clean stream ensures no handshake corruption.

Both swarms share the same **Cryptographic Identity** (Key Pair), so a user appears as a single peer entity across both networks.

### Protocol
-   **Chat**: JSON messages `{ type: 'CHAT', text: '...', nick: '...', timestamp: N }`.
-   **Transfer**:
    -   **Handshake**: Receiver sends `{ type: 'HANDSHAKE', receivedBytes: N }` to indicate where to resume.
    -   **Stream**: Sender streams `tar-fs` pack data starting from offset `N`.

## Codebase Overview

-   **`bin/wormhole.js`**: Entry point. Bootstraps the CLI.
-   **`src/cli.js`**: Handles command-line argument parsing (Commander.js). Defines `send`, `receive`, and `chat` commands.
-   **`src/shell.js`**: The core application logic.
    -   Manages the interactive REPL.
    -   Maintains `chatSwarm` and `fileSwarm` state.
    -   Routes commands to appropriate handlers.
-   **`src/protocol.js`**:
    -   `Protocol` class that wraps the Chat Swarm connections.
    -   Parses incoming JSON and dispatches events (e.g., displaying chat messages).
-   **`src/transfer.js`**:
    -   `ResumableSender`: Handles reading files/folders, packing them into a `tar` stream, and skipping bytes for resumption.
    -   `ResumableReceiver`: Handles the handshake and unpacking the `tar` stream to disk.
-   **`src/networking.js`**: Helper wrapper around `hyperswarm` for creating and joining topics.
-   **`src/crypto.js`**: Utilities for hashing room keys.

## Troubleshooting

-   **Connection Dropped**: The shell will keep the swarm alive. Just re-issue the `/send` or `/receive` command if the logic doesn't auto-resume for your specific case.
-   **Firewalls**: Hyperswarm uses UDP hole punching. Most NATs are supported, but aggressive corporate firewalls might block DHT traffic.

