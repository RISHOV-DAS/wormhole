import Hyperswarm from 'hyperswarm'
import crypto from 'crypto'
import { LANDiscovery } from './lan.js'
import { label, dimText, infoText, errorText, warnText, successText, chalk } from './ui.js'

const DEBUG = process.env.WORMHOLE_DEBUG === '1'

function debug(...args) {
    if (DEBUG) console.log(`  ${chalk.hex('#6b7280')('[DEBUG]')}`, ...args)
}


export function createSwarm() {
    const swarm = new Hyperswarm()
    const lan = new LANDiscovery()

    // Attach the LAN discovery instance to the swarm for access
    swarm._lan = lan
    swarm._lanConnections = new Set()

    // Start LAN discovery
    lan.start().then(() => {
        debug(`LAN discovery started on TCP port ${lan.tcpPort}, UDP broadcast on 43210`)
    }).catch(err => {
        debug(`LAN discovery failed to start: ${err.message}`)
    })

    // When LAN finds a peer, emit it as a regular swarm connection
    lan.on('connection', (socket, info) => {
        console.log(`\n  ${label.system} ${chalk.hex('#22c55e').bold('LAN peer')} ${chalk.hex('#8b5cf6').bold(info.peerId)} connected via ${dimText(info.host)} ⚡`)
        swarm._lanConnections.add(socket)
        socket.on('close', () => swarm._lanConnections.delete(socket))
        socket.on('error', () => swarm._lanConnections.delete(socket))
        swarm.emit('connection', socket, {
            publicKey: info.publicKey,
            topics: [],
            type: 'lan'
        })
    })

    // Monitor DHT readiness
    const dht = swarm.dht
    debug('DHT bootstrapping...')

    dht.on('ready', () => {
        debug(`DHT ready! Local node: ${dht.host}:${dht.port}`)
        debug(`NAT type — firewalled: ${dht.firewalled}, port: ${dht.port}`)
    })

    swarm.on('update', () => {
        debug(`Swarm update — connecting: ${swarm.connecting}, connections: ${swarm.connections.size}, peers: ${swarm.peers.size}`)
    })

    // Override destroy to also clean up LAN discovery
    const originalDestroy = swarm.destroy.bind(swarm)
    swarm.destroy = async () => {
        await lan.destroy()
        for (const conn of swarm._lanConnections) {
            try { conn.destroy() } catch (e) { }
        }
        return originalDestroy()
    }

    return swarm
}

export async function joinSwarm(swarm, topicBuffer) {
    // Join on both Hyperswarm (DHT) and LAN discovery
    const discovery = swarm.join(topicBuffer, { server: true, client: true })

    // Also join on LAN
    if (swarm._lan) {
        swarm._lan.join(topicBuffer)
    }

    debug('Waiting for topic to be announced on DHT...')
    await discovery.flushed()
    debug('Topic announced! Now flushing swarm to connect to discovered peers...')

    // Flush ensures we connect to any peers that were already discovered
    await swarm.flush()
    debug(`Swarm flushed. Active connections: ${swarm.connections.size}`)

    return discovery
}
