export class Protocol {
    constructor(state) {
        this.state = state
    }

    onConnection(conn, info) {
        const peerId = info.publicKey.toString('hex').slice(0, 8)
        console.log(`\n[System] Peer ${peerId} connected.`)

        conn.on('data', (data) => this.handleData(conn, peerId, data))

        conn.on('error', (err) => {
            console.log(`\n[System] Peer ${peerId} connection error: ${err.message}`)
        })

        conn.on('close', () => {
            console.log(`\n[System] Peer ${peerId} disconnected.`)
        })
    }

    handleData(conn, peerId, data) {
        try {
            const msg = JSON.parse(data.toString())
            this.dispatch(conn, peerId, msg)
        } catch (err) {
            // console.error('Failed to parse message:', err.message)
        }
    }

    dispatch(conn, peerId, msg) {
        switch (msg.type) {
            case 'CHAT':
                this.handleChat(msg)
                break
            // Add more protocol handlers here
            default:
            // console.log(`Unknown message type: ${msg.type}`)
        }
    }

    handleChat(msg) {
        const time = new Date(msg.timestamp).toLocaleTimeString()
        console.log(`[${time}] <${msg.nick}> ${msg.text}`)
    }
}
