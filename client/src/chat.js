import { createSwarm, joinSwarm } from './networking.js'
import { hashRoomKey } from './crypto.js'

export async function startChat(room, nick) {
    const topic = hashRoomKey(room)
    console.log(`[Chat] Joining room: ${room} as '${nick}'`)
    console.log(`[Chat] Type a message and press ENTER to send.`)

    const swarm = createSwarm()

    // Handle incoming connections
    swarm.on('connection', (conn, info) => {
        const peerId = info.publicKey.toString('hex').slice(0, 8)
        console.log(`[System] Peer ${peerId} joined.`)

        conn.on('data', (data) => {
            try {
                const msg = JSON.parse(data.toString())
                if (msg.type === 'CHAT') {
                    const time = new Date(msg.timestamp).toLocaleTimeString()
                    console.log(`[${time}] <${msg.nick}> ${msg.text}`)
                }
            } catch (err) {
                // Ignore non-chat data (e.g. handshake artifacts if mixed use)
            }
        })

        conn.on('error', () => {
            console.log(`[System] Peer ${peerId} left.`)
        })
    })

    // Handle local input
    process.stdin.on('data', (data) => {
        const text = data.toString().trim()
        if (!text) return

        // Broadcast to all peers
        const msg = {
            type: 'CHAT',
            nick,
            text,
            timestamp: Date.now()
        }

        const payload = JSON.stringify(msg)

        // Echo locally
        const time = new Date(msg.timestamp).toLocaleTimeString()
        console.log(`[${time}] <${nick}> ${text}`)

        for (const conn of swarm.connections) {
            conn.write(payload)
        }
    })

    await joinSwarm(swarm, topic) // Wait for discovery
}
