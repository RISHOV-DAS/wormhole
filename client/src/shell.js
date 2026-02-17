import fs from 'fs'
import path from 'path'
import { createSwarm, joinSwarm } from './networking.js'
import { hashRoomKey } from './crypto.js'
import { ResumableSender, ResumableReceiver } from './transfer.js'

import { Protocol } from './protocol.js'

export async function startShell(initialRoom = null, initialNick = 'Anonymous') {
    console.log('Welcome to Wormhole P2P Shell')
    console.log('Commands: /host <room>, /join <room>, /nick <name>, /chat <msg> or just type your message, /send <file>, /receive <out>, /quit')

    const state = {
        chatSwarm: null,
        fileSwarm: null,
        room: null,
        chatTopicHex: null,
        fileTopicHex: null,
        nick: initialNick,
        protocol: null,
        keyPair: null
    }

    state.protocol = new Protocol(state)

    if (initialRoom) {
        await handleHost(state, initialRoom)
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
                    if (state.chatSwarm) await state.chatSwarm.destroy()
                    if (state.fileSwarm) await state.fileSwarm.destroy()
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
                    if (!state.chatSwarm) {
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
            if (state.chatSwarm) {
                await broadcastChat(state, line)
            } else {
                console.log('Not connected. Use /host <room> to join a room.')
            }
        }
    })
}

async function handleHost(state, roomName) {
    if (state.chatSwarm) {
        console.log('Leaving current room...')
        await state.chatSwarm.destroy()
        await state.fileSwarm.destroy()
    }

    state.room = roomName

    // Derived topics
    const chatTopic = hashRoomKey(roomName)
    const fileTopic = hashRoomKey(roomName + '-files')

    state.chatTopicHex = chatTopic.toString('hex')
    state.fileTopicHex = fileTopic.toString('hex')

    console.log(`Hashing room '${roomName}'...`)
    console.log(`Chat Key: ${state.chatTopicHex}`)
    console.log('Joining swarms...')

    try {
        // Create swarms with same identity
        // Create chat swarm first, let it generate a keyPair
        state.chatSwarm = createSwarm()
        console.log('Chat swarm created.')

        // Reuse that identity for file swarm
        if (!state.chatSwarm.keyPair) {
            console.error('Error: chatSwarm.keyPair is undefined!')
        }
        state.keyPair = state.chatSwarm.keyPair
        console.log('KeyPair retrieved:', state.keyPair ? 'Yes' : 'No')

        state.fileSwarm = createSwarm({ keyPair: state.keyPair })
        console.log('File swarm created.')

        setupChatListeners(state)

        // Default handler for file swarm to prevent crashes on unhandled socket errors
        state.fileSwarm.on('connection', (conn) => {
            conn.on('error', () => { })
        })

    } catch (err) {
        console.error('Error in handleHost:', err)
        process.exit(1)
    }

    await joinSwarm(state.chatSwarm, chatTopic)
    await joinSwarm(state.fileSwarm, fileTopic)

    console.log(`Joined room: ${roomName}`)
    console.log(`Ready to chat and transfer files.`)
}

function setupChatListeners(state) {
    state.chatSwarm.on('connection', (conn, info) => {
        state.protocol.onConnection(conn, info)
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

    for (const conn of state.chatSwarm.connections) {
        conn.write(payload)
    }
}

async function handleSend(state, filePath) {
    if (!state.fileSwarm) {
        console.log('Error: Join a room first.')
        return
    }

    const absPath = path.resolve(process.cwd(), filePath)
    if (!fs.existsSync(absPath)) {
        console.log(`Error: File ${absPath} not found.`)
        return
    }

    console.log(`[Sender] Initiating transfer for: ${filePath}`)
    console.log(`[Sender] Waiting for ready peer on File Swarm...`)

    const sender = new ResumableSender(absPath)

    // Send to all connected file peers
    for (const conn of state.fileSwarm.connections) {
        setupSenderOnConnection(sender, conn)
    }

    const onConn = (conn) => setupSenderOnConnection(sender, conn)
    state.fileSwarm.on('connection', onConn)

    // Cleanup listener eventually? For shell, we leave it open or user quits.
    // Ideally we track active transfers.
}

function setupSenderOnConnection(sender, conn) {
    sender.connect(conn).catch(err => {
        // console.log('Handshake failed or not a receiver:', err.message)
    })
    sender.on('finished', () => {
        console.log('\n[Sender] Transfer finished for a peer.')
    })
}

async function handleReceive(state, outputDir) {
    if (!state.fileSwarm) {
        console.log('Error: Join a room first.')
        return
    }
    const absPath = path.resolve(process.cwd(), outputDir)
    if (!fs.existsSync(absPath)) {
        fs.mkdirSync(absPath, { recursive: true })
    }

    console.log(`[Receiver] Ready to receive into: ${outputDir}`)

    const receiver = new ResumableReceiver(absPath)

    for (const conn of state.fileSwarm.connections) {
        setupReceiverOnConnection(receiver, conn)
    }

    const onConn = (conn) => setupReceiverOnConnection(receiver, conn)
    state.fileSwarm.on('connection', onConn)
}

function setupReceiverOnConnection(receiver, conn) {
    receiver.connect(conn).catch(err => {
        // console.log('Handshake failed or not a sender')
    })
    receiver.on('finished', () => {
        console.log('\n[Receiver] Transfer finished.')
    })
}
