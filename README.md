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
-   `rendezvous/`: A Rust implementation of a Rendezvous Discovery Server (uses `libp2p`, optional/standalone).

## Prerequisites

-   **Node.js**: v18 or higher.
-   **Rust**: (Optional) Only if you want to run the rendezvous server code.

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

### Server (Rust) - *Optional*

The current client uses Hyperswarm and **does not require this server**. This server is provided as an alternative `libp2p` implementation reference.

1.  Navigate to the rendezvous directory:
    ```bash
    cd rendezvous
    ```
2.  Run the server:
    ```bash
    cargo run
    ```

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

-   **Discovery**: Uses `Hyperswarm` to find peers via a common topic (SHA-256 hash of the room name).
-   **Transport**: Encrypted P2P connections (Noise protocol).
-   **Data Transfer**:
    -   Sender packs directory using `tar-fs`.
    -   Data is piped to the socket.
    -   Receiver writes to a partial file `.wormhole_transfer.tar.part`.
    -   On reconnection, Receiver sends `{ type: 'HANDSHAKE', receivedBytes: N }`.
    -   Sender skips `N` bytes and resumes streaming.

## Troubleshooting

-   **Connection Dropped**: The shell will keep the swarm alive. Just re-issue the `/send` or `/receive` command if the logic doesn't auto-resume for your specific case, or wait for the automatic retry loop if active.
-   **Firewalls**: Hyperswarm uses UDP hole punching. Most NATs are supported, but aggressive corporate firewalls might block DHT traffic.
