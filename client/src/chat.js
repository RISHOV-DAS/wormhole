import { createSwarm, joinSwarm } from './networking.js'
import { hashRoomKey } from './crypto.js'
import {
    label, colorNick, styledTime, styledRoom,
    successText, errorText, dimText, divider, chalk
} from './ui.js'

export async function startChat(room, nick) {
    const topic = hashRoomKey(room)
    console.log(`  ${label.chat} Joining room: ${styledRoom(room)} as ${colorNick(nick)}`)
    console.log(`  ${label.chat} ${dimText('Type a message and press ENTER to send.')}`)
    console.log(divider())

    const swarm = createSwarm()

    // Handle incoming connections
    swarm.on('connection', (conn, info) => {
        const peerId = info.publicKey.toString('hex').slice(0, 8)
        console.log(`  ${label.system} Peer ${chalk.hex('#8b5cf6').bold(peerId)} ${successText('joined')} ⚡`)

        conn.on('data', (data) => {
            try {
                const msg = JSON.parse(data.toString())
                if (msg.type === 'CHAT') {
                    const time = styledTime(msg.timestamp)
                    console.log(`  ${dimText('│')} ${time} ${colorNick(msg.nick)}${dimText(':')} ${msg.text}`)
                }
            } catch (err) {
                // Ignore non-chat data (e.g. handshake artifacts if mixed use)
            }
        })

        conn.on('error', () => {
            console.log(`  ${label.system} Peer ${chalk.hex('#8b5cf6').bold(peerId)} ${errorText('left')}.`)
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
        const time = styledTime(msg.timestamp)
        console.log(`  ${dimText('│')} ${time} ${colorNick(nick)}${dimText(':')} ${text}`)

        for (const conn of swarm.connections) {
            conn.write(payload)
        }
    })

    await joinSwarm(swarm, topic) // Wait for discovery
}
