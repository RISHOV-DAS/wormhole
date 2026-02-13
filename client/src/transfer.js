import fs from 'fs'
import path from 'path'
import tar from 'tar-fs'
import pump from 'pump'
import { EventEmitter } from 'events'

// wait for a handshake JSON message
function waitForHandshake(socket) {
    return new Promise((resolve, reject) => {
        const onData = (data) => {
            try {
                const json = JSON.parse(data.toString())
                if (json.type === 'HANDSHAKE') {
                    socket.removeListener('data', onData)
                    resolve(json)
                }
            } catch (err) {
                console.log(err);
            }
        }
        socket.on('data', onData)
        socket.on('error', reject)
    })
}

export class ResumableSender extends EventEmitter {
    constructor(folderPath) {
        super()
        this.folderPath = folderPath
    }

    async connect(socket) {
        // 1. Wait for handshake to know where to start
        console.log('[Sender] Waiting for handshake...')
        const handshake = await waitForHandshake(socket)
        const startOffset = handshake.receivedBytes || 0
        console.log(`[Sender] Resuming from ${startOffset} bytes`)

        // 2. Create tar stream
        // Note: tar-fs doesn't support 'start' offset natively on the pack stream easily 
        // because it generates headers on the fly.
        // We have to consume and discard bytes.
        const packer = tar.pack(this.folderPath)

        // We need to track total size for progress if possible, but tar-fs doesn't know total size ahead of time easily
        // without a pre-pass. For now, we'll just stream and track transferred.

        let bytesSkipped = 0

        // 3. Pipe with logic to skip 'startOffset'
        packer.on('data', (chunk) => {
            if (bytesSkipped < startOffset) {
                const remaining = startOffset - bytesSkipped
                if (chunk.length <= remaining) {
                    bytesSkipped += chunk.length
                    return // drop chunk
                } else {
                    // partial drop
                    const slice = chunk.slice(remaining)
                    bytesSkipped += remaining
                    if (socket.destroyed) return
                    socket.write(slice)
                    this.emit('progress', slice.length)
                }
            } else {
                if (socket.destroyed) return
                socket.write(chunk)
                this.emit('progress', chunk.length)
            }
        })

        packer.on('end', () => {
            if (!socket.destroyed) socket.end()
            this.emit('finished')
        })

        // Handle socket errors
        socket.on('error', (err) => this.emit('error', err))
        socket.on('close', () => this.emit('close'))
    }
}

export class ResumableReceiver extends EventEmitter {
    constructor(outputDir) {
        super()
        this.outputDir = outputDir
        // Ensure outputDir exists so we can store the part file
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true })
        }
        this.tempFile = path.join(this.outputDir, '.wormhole_transfer.tar.part')
        this.receivedBytes = 0
    }

    async connect(socket) {
        // 1. Check partial file size
        if (fs.existsSync(this.tempFile)) {
            this.receivedBytes = fs.statSync(this.tempFile).size
        } else {
            this.receivedBytes = 0
        }

        // 2. Send Handshake
        const handshake = JSON.stringify({ type: 'HANDSHAKE', receivedBytes: this.receivedBytes })
        socket.write(handshake)
        console.log(`[Receiver] Sent handshake. Resuming from ${this.receivedBytes} bytes.`)

        // 3. Append to file
        const fileStream = fs.createWriteStream(this.tempFile, { flags: 'a' })

        socket.on('data', (chunk) => {
            this.receivedBytes += chunk.length
            fileStream.write(chunk)
            this.emit('progress', chunk.length, this.receivedBytes)
        })

        socket.on('end', () => {
            fileStream.end()
            this.extract()
            this.emit('finished')
        })

        socket.on('error', (err) => {
            fileStream.end()
            this.emit('error', err)
        })
    }

    extract() {
        console.log('[Receiver] Transfer complete. Extracting...')
        const extractor = tar.extract(this.outputDir)
        fs.createReadStream(this.tempFile).pipe(extractor).on('finish', () => {
            console.log('[Receiver] Extraction complete.')
            fs.unlinkSync(this.tempFile) // Cleanup
        })
    }
}
