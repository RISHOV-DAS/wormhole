import fs from 'fs'
import path from 'path'
import { createSwarm, joinSwarm } from './networking.js'
import { hashRoomKey } from './crypto.js'
import { ResumableSender, ResumableReceiver } from './transfer.js'
import cliProgress from 'cli-progress'

export async function startShell() {
    console.log('Welcome to Wormhole P2P Shell')
    console.log('Commands: /host <room>, /nick <name>, /chat <msg>, /send <file>, /receive <out>, /quit')

    const state = {
        swarm: null,
        room: null,
        topicHex: null,
        nick: 'Anonymous'
    }

    process.stdin.on('data', async (data) => {
        const line = data.toString().trim()
        if (!line) return

        if (line.startsWith('/')) {
            const parts = line.split(' ')
            const cmd = parts[0]
            const args = parts.slice(1)

            switch (cmd) {
                case '/quit':
                case '/exit':
                    if (state.swarm) await state.swarm.destroy()
                    process.exit(0)
                    break

                case '/nick':
                    state.nick = args.join(' ') || 'Anonymous'
                    console.log(`Nickname set to: ${state.nick}`)
                    break

                case '/host':
                case '/join':
                    if (args.length < 1) {
                        console.log('Usage: /host <room_name>')
                        break
                    }
                    const roomName = args.join(' ')
                    await handleHost(state, roomName)
                    break

                case '/chat':
                    if (!state.swarm) {
                        console.log('Error: You must join a room first using /host')
                        break
                    }
                    await broadcastChat(state, args.join(' '))
                    break

                case '/send':
                    if (args.length < 1) {
                        console.log('Usage: /send <file_path>')
                        break
                    }
                    await handleSend(state, args[0])
                    break

                case '/receive':
                    if (args.length < 1) {
                        console.log('Usage: /receive <output_dir>')
                        break
                    }
                    await handleReceive(state, args[0])
                    break

                default:
                    console.log(`Unknown command: ${cmd}`)
            }
        } else {
            // Default to chat if in a room
            if (state.swarm) {
                await broadcastChat(state, line)
            } else {
                console.log('Not connected. Use /host <room> to join a room.')
            }
        }
    })
}

async function handleHost(state, roomName) {
    if (state.swarm) {
        console.log('Leaving current room...')
        await state.swarm.destroy()
    }

    state.room = roomName
    const topic = hashRoomKey(roomName)
    state.topicHex = topic.toString('hex')

    console.log(`Hashing room '${roomName}'...`)
    console.log(`Room Key (Topic): ${state.topicHex}`)
    console.log('Joining swarm...')

    state.swarm = createSwarm()
    setupSwarmListeners(state)
    await joinSwarm(state.swarm, topic)
    console.log(`Joined room: ${roomName}`)
}

function setupSwarmListeners(state) {
    state.swarm.on('connection', (conn, info) => {
        const peerId = info.publicKey.toString('hex').slice(0, 8)
        console.log(`\n[System] Peer ${peerId} connected.`)

        conn.on('data', (data) => {
            try {
                const msg = JSON.parse(data.toString())
                if (msg.type === 'CHAT') {
                    const time = new Date(msg.timestamp).toLocaleTimeString()
                    console.log(`[${time}] <${msg.nick}> ${msg.text}`)
                }
            } catch (err) { }
        })

        conn.on('error', () => {
            console.log(`\n[System] Peer ${peerId} disconnected.`)
        })
    })
}

async function broadcastChat(state, text) {
    if (!text) return
    const msg = {
        type: 'CHAT',
        nick: state.nick,
        text,
        timestamp: Date.now()
    }
    const payload = JSON.stringify(msg)

    // Local echo
    const time = new Date(msg.timestamp).toLocaleTimeString()
    console.log(`[${time}] <${state.nick}> ${text}`)

    for (const conn of state.swarm.connections) {
        conn.write(payload)
    }
}

async function handleSend(state, filePath) {
    if (!state.swarm) {
        console.log('Error: Join a room first.')
        return
    }

    const absPath = path.resolve(process.cwd(), filePath)
    if (!fs.existsSync(absPath)) {
        console.log(`Error: File ${absPath} not found.`)
        return
    }

    console.log(`[Sender] Initiating transfer for: ${filePath}`)
    console.log(`[Sender] Waiting for ready peer...`)

    const sender = new ResumableSender(absPath)

    // We reuse the existing swarm connections
    // But ResumableSender.connect() expects a SINGLE socket (conn).
    // In a multi-peer swarm, sending to ALL might be chaotic or intended.
    // For now, let's send to ALL connected peers who handshake.

    // NOTE: This blocks the CLI loop slightly during setup, but the streams are async.
    // We need to hook up the 'connection' event OR iterate existing connections.

    // Iterating existing connections:
    for (const conn of state.swarm.connections) {
        setupSenderOnConnection(sender, conn)
    }

    // Hook for future connections (until some stop condition?)
    // For this simple shell, we'll keep sending to anyone new who joins while we stay in "shell mode".
    // But typically user wants "/send" to happen once. 
    // Let's attach a temporary listener.

    const onConn = (conn) => setupSenderOnConnection(sender, conn)
    state.swarm.on('connection', onConn)

    console.log('[Sender] Transfer mode active. Press Ctrl+C or type command to stop (not implemented deeply).')
}

function setupSenderOnConnection(sender, conn) {
    sender.connect(conn).catch(err => {
        // console.log('Handshake failed or not a receiver:', err.message)
    })

    // Progress bar shared? It's tricky with multiple peers. 
    // We will use simple logs for the shell version to avoid messing up chat UI.
    sender.on('progress', (bytes) => {
        // process.stdout.write('.') // minimal feedback
    })
    sender.on('finished', () => {
        console.log('\n[Sender] Transfer finished for a peer.')
    })
}

async function handleReceive(state, outputDir) {
    if (!state.swarm) {
        console.log('Error: Join a room first.')
        return
    }
    const absPath = path.resolve(process.cwd(), outputDir)
    if (!fs.existsSync(absPath)) {
        fs.mkdirSync(absPath, { recursive: true })
    }

    console.log(`[Receiver] Ready to receive into: ${outputDir}`)

    const receiver = new ResumableReceiver(absPath)

    for (const conn of state.swarm.connections) {
        setupReceiverOnConnection(receiver, conn)
    }

    const onConn = (conn) => setupReceiverOnConnection(receiver, conn)
    state.swarm.on('connection', onConn)
}

function setupReceiverOnConnection(receiver, conn) {
    receiver.connect(conn).catch(err => {
        // console.log('Handshake failed or not a sender')
    })
    receiver.on('finished', () => {
        console.log('\n[Receiver] Transfer finished.')
    })
}
