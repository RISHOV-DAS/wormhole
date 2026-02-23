import fs from 'fs'
import path from 'path'
import { createSwarm, joinSwarm } from './networking.js'
import { hashRoomKey } from './crypto.js'
import { ResumableSender, ResumableReceiver } from './transfer.js'
import cliProgress from 'cli-progress'
import {
    banner, showHelp, label, colorNick, styledTime, styledRoom,
    styledTopic, styledPath, styledCommand, errorText, successText,
    dimText, infoText, divider, chalk
} from './ui.js'

export async function startShell() {
    banner()
    showHelp()

    const state = {
        swarm: null,
        room: null,
        topicHex: null,
        nick: 'Anonymous',
        // Track connections that are being used for file transfer
        // so chat listeners can skip them
        transferConns: new Set()
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
                    console.log(dimText('  👋 Goodbye!'))
                    if (state.swarm) await state.swarm.destroy()
                    process.exit(0)
                    break

                case '/nick':
                    state.nick = args.join(' ') || 'Anonymous'
                    console.log(`  ${label.info} Nickname set to: ${colorNick(state.nick)}`)
                    break

                case '/host':
                case '/join':
                    if (args.length < 1) {
                        console.log(`  ${label.error} Usage: ${styledCommand('/host <room_name>')}`)
                        break
                    }
                    const roomName = args.join(' ')
                    await handleHost(state, roomName)
                    break

                case '/chat':
                    if (!state.swarm) {
                        console.log(`  ${label.error} You must join a room first using ${styledCommand('/host')}`)
                        break
                    }
                    await broadcastChat(state, args.join(' '))
                    break

                case '/send':
                    if (args.length < 1) {
                        console.log(`  ${label.error} Usage: ${styledCommand('/send <file_path>')}`)
                        break
                    }
                    await handleSend(state, args.join(' '))
                    break

                case '/receive':
                    if (args.length < 1) {
                        console.log(`  ${label.error} Usage: ${styledCommand('/receive <output_dir>')}`)
                        break
                    }
                    await handleReceive(state, args.join(' '))
                    break

                default:
                    console.log(`  ${label.error} Unknown command: ${chalk.yellow(cmd)}`)
            }
        } else {
            // Default to chat if in a room
            if (state.swarm) {
                await broadcastChat(state, line)
            } else {
                console.log(`  ${label.info} Not connected. Use ${styledCommand('/host <room>')} to join a room.`)
            }
        }
    })
}

async function handleHost(state, roomName) {
    if (state.swarm) {
        console.log(`  ${label.system} ${dimText('Leaving current room...')}`)
        await state.swarm.destroy()
    }

    state.room = roomName
    state.transferConns = new Set() // reset on new room
    const topic = hashRoomKey(roomName)
    state.topicHex = topic.toString('hex')

    console.log(`  ${label.info} Hashing room ${styledRoom(roomName)}...`)
    console.log(`  ${label.info} Topic: ${styledTopic(state.topicHex)}`)
    console.log(`  ${label.system} ${infoText('Joining swarm...')}`)

    state.swarm = createSwarm()
    setupSwarmListeners(state)
    await joinSwarm(state.swarm, topic)
    console.log(`  ${label.success} ${successText(`Joined room:`)} ${styledRoom(roomName)}`)
    console.log(divider())
}

function setupSwarmListeners(state) {
    state.swarm.on('connection', (conn, info) => {
        const peerId = info.publicKey.toString('hex').slice(0, 8)
        console.log(`\n  ${label.system} Peer ${chalk.hex('#8b5cf6').bold(peerId)} ${successText('connected')} ⚡`)

        conn.on('data', (data) => {
            // Skip chat processing for connections in transfer mode
            if (state.transferConns.has(conn)) return

            try {
                const msg = JSON.parse(data.toString())
                if (msg.type === 'CHAT') {
                    const time = styledTime(msg.timestamp)
                    console.log(`  ${dimText('│')} ${time} ${colorNick(msg.nick)}${dimText(':')} ${msg.text}`)
                }
            } catch (err) { }
        })

        conn.on('error', () => {
            state.transferConns.delete(conn)
            console.log(`\n  ${label.system} Peer ${chalk.hex('#8b5cf6').bold(peerId)} ${errorText('disconnected')}`)
        })

        conn.on('close', () => {
            state.transferConns.delete(conn)
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
    const time = styledTime(msg.timestamp)
    console.log(`  ${dimText('│')} ${time} ${colorNick(state.nick)}${dimText(':')} ${text}`)

    for (const conn of state.swarm.connections) {
        // Don't send chat on connections used for transfer
        if (state.transferConns.has(conn)) continue
        conn.write(payload)
    }
}

async function handleSend(state, filePath) {
    if (!state.swarm) {
        console.log(`  ${label.error} Join a room first.`)
        return
    }

    const absPath = path.resolve(process.cwd(), filePath)
    if (!fs.existsSync(absPath)) {
        console.log(`  ${label.error} File ${styledPath(absPath)} not found.`)
        return
    }

    console.log(`  ${label.sender} Initiating transfer for: ${styledPath(filePath)}`)
    console.log(`  ${label.sender} ${dimText('Waiting for ready peer...')}`)

    // For each existing connection, create a dedicated sender
    for (const conn of state.swarm.connections) {
        startSendOnConnection(state, absPath, conn)
    }

    // Hook for future connections
    const onConn = (conn) => startSendOnConnection(state, absPath, conn)
    state.swarm.on('connection', onConn)

    console.log(`  ${label.sender} ${infoText('Transfer mode active.')} 📤`)
}

function startSendOnConnection(state, absPath, conn) {
    // Mark this connection as being used for transfer
    state.transferConns.add(conn)

    // Create a NEW sender per connection to avoid listener stacking
    const sender = new ResumableSender(absPath)

    sender.connect(conn).catch(err => {
        console.log(`  ${label.sender} ${errorText('Handshake failed:')} ${err.message}`)
        state.transferConns.delete(conn)
    })

    sender.on('finished', () => {
        console.log(`\n  ${label.sender} ${successText('Transfer finished for a peer.')} ✅`)
        state.transferConns.delete(conn)
    })

    sender.on('error', (err) => {
        state.transferConns.delete(conn)
    })
}

async function handleReceive(state, outputDir) {
    if (!state.swarm) {
        console.log(`  ${label.error} Join a room first.`)
        return
    }
    const absPath = path.resolve(process.cwd(), outputDir)
    if (!fs.existsSync(absPath)) {
        fs.mkdirSync(absPath, { recursive: true })
    }

    console.log(`  ${label.receiver} Ready to receive into: ${styledPath(outputDir)} 📥`)

    // For each existing connection, create a dedicated receiver
    for (const conn of state.swarm.connections) {
        startReceiveOnConnection(state, absPath, conn)
    }

    // Hook for future connections
    const onConn = (conn) => startReceiveOnConnection(state, absPath, conn)
    state.swarm.on('connection', onConn)
}

function startReceiveOnConnection(state, absPath, conn) {
    // Mark this connection as being used for transfer
    state.transferConns.add(conn)

    // Create a NEW receiver per connection to avoid listener stacking
    const receiver = new ResumableReceiver(absPath)

    receiver.connect(conn).catch(err => {
        console.log(`  ${label.receiver} ${errorText('Handshake failed:')} ${err.message}`)
        state.transferConns.delete(conn)
    })

    receiver.on('finished', () => {
        console.log(`\n  ${label.receiver} ${successText('Transfer finished.')} ✅`)
        state.transferConns.delete(conn)
    })

    receiver.on('error', (err) => {
        console.log(`\n  ${label.receiver} ${errorText('Error:')} ${err.message}`)
        state.transferConns.delete(conn)
    })
}
