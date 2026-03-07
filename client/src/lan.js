import dgram from 'dgram'
import net from 'net'
import crypto from 'crypto'
import { EventEmitter } from 'events'
import { Duplex } from 'stream'

const LAN_DISCOVERY_PORT = 43210
const BROADCAST_INTERVAL = 2000
const MAGIC = 'WORMHOLE_LAN_V1'

/**
 * LAN Peer Discovery
 * 
 * Discovers peers on the same local network via UDP broadcast,
 * then creates direct TCP connections to bypass NAT/DHT issues.
 * 
 * This runs alongside Hyperswarm — whichever finds a peer first wins.
 */
export class LANDiscovery extends EventEmitter {
    constructor() {
        super()
        this.id = crypto.randomBytes(16).toString('hex')
        this.topics = new Map()   // topicHex -> true
        this.tcpServer = null
        this.udpSocket = null
        this.broadcastTimer = null
        this.connectedPeers = new Set()  // track "id:topic" to prevent duplicates
        this.tcpPort = 0
        this.destroyed = false
    }

    async start() {
        // 1. Start a TCP server for incoming LAN peer connections
        this.tcpServer = net.createServer((socket) => {
            // Incoming connection — wait for the peer to identify itself
            let identified = false
            const onData = (data) => {
                if (identified) return
                try {
                    const msg = JSON.parse(data.toString())
                    if (msg.magic === MAGIC && msg.type === 'IDENTIFY') {
                        identified = true
                        socket.removeListener('data', onData)

                        const peerKey = `${msg.id}:${msg.topic}`
                        if (this.connectedPeers.has(peerKey)) {
                            socket.destroy()
                            return
                        }
                        this.connectedPeers.add(peerKey)

                        // Create a duplex wrapper that replays any buffered data
                        this.emit('connection', socket, {
                            type: 'lan',
                            host: socket.remoteAddress,
                            port: socket.remotePort,
                            topic: msg.topic,
                            peerId: msg.id.slice(0, 8),
                            publicKey: Buffer.from(msg.id, 'hex')
                        })
                    }
                } catch (e) { /* not our protocol, ignore */ }
            }
            socket.on('data', onData)
            // Timeout if no identification within 5s
            setTimeout(() => {
                if (!identified) {
                    socket.removeListener('data', onData)
                    socket.destroy()
                }
            }, 5000)
        })

        await new Promise((resolve, reject) => {
            this.tcpServer.listen(0, '0.0.0.0', () => {
                this.tcpPort = this.tcpServer.address().port
                resolve()
            })
            this.tcpServer.on('error', reject)
        })

        // 2. Start UDP socket for broadcast discovery
        this.udpSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true })

        this.udpSocket.on('message', (msg, rinfo) => {
            if (this.destroyed) return
            this._handleDiscovery(msg, rinfo)
        })

        this.udpSocket.on('error', (err) => {
            // UDP errors are non-fatal, just log
            // Common: EADDRINUSE if another wormhole instance is on the same machine
        })

        await new Promise((resolve, reject) => {
            this.udpSocket.bind(LAN_DISCOVERY_PORT, '0.0.0.0', () => {
                try {
                    this.udpSocket.setBroadcast(true)
                } catch (e) { /* setBroadcast may fail on some systems */ }
                resolve()
            })
        })

        // 3. Start periodic broadcast
        this._broadcast()
        this.broadcastTimer = setInterval(() => this._broadcast(), BROADCAST_INTERVAL)
    }

    join(topicBuffer) {
        this.topics.set(topicBuffer.toString('hex'), true)
    }

    leave(topicBuffer) {
        this.topics.delete(topicBuffer.toString('hex'))
    }

    _broadcast() {
        if (this.destroyed || !this.udpSocket) return
        for (const [topicHex] of this.topics) {
            const msg = Buffer.from(JSON.stringify({
                magic: MAGIC,
                type: 'ANNOUNCE',
                id: this.id,
                topic: topicHex,
                tcpPort: this.tcpPort,
            }))
            try {
                this.udpSocket.send(msg, 0, msg.length, LAN_DISCOVERY_PORT, '255.255.255.255')
            } catch (e) { /* broadcast may fail, non-fatal */ }
        }
    }

    _handleDiscovery(msg, rinfo) {
        try {
            const data = JSON.parse(msg.toString())
            if (data.magic !== MAGIC || data.type !== 'ANNOUNCE') return
            if (data.id === this.id) return  // ignore self

            // Only care about topics we've joined
            if (!this.topics.has(data.topic)) return

            const peerKey = `${data.id}:${data.topic}`
            if (this.connectedPeers.has(peerKey)) return

            // Dedup: only the peer with the "higher" ID initiates the TCP connection
            // This prevents both peers from connecting to each other simultaneously
            if (this.id < data.id) return

            this.connectedPeers.add(peerKey)

            // Connect to the peer's TCP server
            const socket = net.connect(data.tcpPort, rinfo.address)

            socket.on('connect', () => {
                // Send identification
                socket.write(JSON.stringify({
                    magic: MAGIC,
                    type: 'IDENTIFY',
                    id: this.id,
                    topic: data.topic,
                }))

                this.emit('connection', socket, {
                    type: 'lan',
                    host: rinfo.address,
                    port: data.tcpPort,
                    topic: data.topic,
                    peerId: data.id.slice(0, 8),
                    publicKey: Buffer.from(data.id, 'hex')
                })
            })

            socket.on('error', () => {
                this.connectedPeers.delete(peerKey)
            })

            socket.on('close', () => {
                this.connectedPeers.delete(peerKey)
            })
        } catch (e) { /* ignore malformed messages */ }
    }

    async destroy() {
        this.destroyed = true
        clearInterval(this.broadcastTimer)
        if (this.udpSocket) {
            try { this.udpSocket.close() } catch (e) { }
        }
        if (this.tcpServer) {
            try { this.tcpServer.close() } catch (e) { }
        }
    }
}
