import { Command } from 'commander'
import path from 'path'
import fs from 'fs'
import cliProgress from 'cli-progress'
import { hashRoomKey } from './crypto.js'
import { createSwarm, joinSwarm } from './networking.js'
import { ResumableSender, ResumableReceiver } from './transfer.js'
import { startShell } from './shell.js'

export function run() {
    const program = new Command()

    program
        .name('wormhole')
        .description('P2P anonymous file transfer CLI')
        .version('1.0.0')
        .action(async () => {
            await startShell()
        })

    program.command('send')
        .description('Send a folder to peers in the room')
        .argument('<folder>', 'Folder path to send')
        .requiredOption('-r, --room <secret>', 'Secret room key')
        .action(async (folderPath, options) => {
            const absPath = path.resolve(process.cwd(), folderPath)
            if (!fs.existsSync(absPath)) {
                console.error(`Error: Folder '${absPath}' does not exist.`)
                process.exit(1)
            }

            const topic = hashRoomKey(options.room)
            console.log(`[Sender] Joining room: ${options.room}`)

            const sender = new ResumableSender(absPath)
            const swarm = createSwarm()

            const bar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic)
            let progressBarStarted = false

            sender.on('progress', (bytes) => {
                if (!progressBarStarted) {
                    bar.start(100, 0, { speed: "N/A" }) // Total unknown for tar stream easily without prescan
                    progressBarStarted = true
                }
                bar.increment(bytes)
            })

            sender.on('finished', () => {
                bar.stop()
                console.log('\n[Sender] Transfer finished successfully.')
                setTimeout(() => process.exit(0), 1000)
            })

            sender.on('error', (err) => {
                // console.error('\n[Sender] Stream error:', err.message)
                // Don't exit, wait for reconnect
            })

            sender.on('close', () => {
                // Socket closed, wait for next connection
            })

            swarm.on('connection', async (conn, info) => {
                console.log('\n[Sender] Peer connected. Starting/Resuming transfer...')
                try {
                    await sender.connect(conn)
                } catch (err) {
                    console.error('[Sender] Connection handshake failed:', err.message)
                }
            })

            await joinSwarm(swarm, topic)
        })

    program.command('receive')
        .description('Receive a folder from peers in the room')
        .argument('<output>', 'Output folder path')
        .requiredOption('-r, --room <secret>', 'Secret room key')
        .action(async (outputDir, options) => {
            const absPath = path.resolve(process.cwd(), outputDir)
            if (!fs.existsSync(absPath)) {
                fs.mkdirSync(absPath, { recursive: true })
            }

            const topic = hashRoomKey(options.room)
            console.log(`[Receiver] Joining room: ${options.room}`)

            const receiver = new ResumableReceiver(absPath)
            const swarm = createSwarm()

            const bar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic)
            let progressBarStarted = false

            receiver.on('progress', (chunkSize, totalReceived) => {
                if (!progressBarStarted) {
                    bar.start(100, 0) // We don't know total unless handshake implies it, but we didn't implement total size msg
                    progressBarStarted = true
                }
                bar.update(totalReceived)
            })

            receiver.on('finished', () => {
                bar.stop()
                console.log('\n[Receiver] Transfer and extraction finished.')
                setTimeout(() => process.exit(0), 1000)
            })

            swarm.on('connection', async (conn, info) => {
                console.log('\n[Receiver] Peer connected. Syncing...')
                try {
                    await receiver.connect(conn)
                } catch (err) {
                    console.error('[Receiver] Connection error:', err.message)
                }
            })

            await joinSwarm(swarm, topic)
        })

    program.command('chat')
        .description('Join a text chat room')
        .requiredOption('-r, --room <secret>', 'Secret room key')
        .requiredOption('-n, --nick <name>', 'Nickname')
        .action(async (options) => {
            await startChat(options.room, options.nick)
        })

    program.parse()
}
