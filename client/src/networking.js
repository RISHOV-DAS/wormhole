import Hyperswarm from 'hyperswarm'
import crypto from 'crypto'

export function createSwarm(opts = {}) {
    const swarm = new Hyperswarm(opts)

    swarm.on('connection', (conn, info) => {
        // keeping the connection alive
        // conn.write('hello')
    })

    return swarm
}

export async function joinSwarm(swarm, topicBuffer) {
    const discovery = swarm.join(topicBuffer)
    await discovery.flushed() // wait for the first lookup/announce
    return discovery
}
