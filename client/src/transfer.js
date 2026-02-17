import fs from 'fs'
import path from 'path'
import tar from 'tar-fs'
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
    async getFolderSize(folderPath) {
        const stats = await fs.promises.stat(folderPath)
        if (!stats.isDirectory()) {
            return stats.size
        }

        let total = 0
        const entries = fs.readdirSync(folderPath, { withFileTypes: true })

        for (const entry of entries) {
            const fullPath = path.join(folderPath, entry.name)
            if (entry.isDirectory()) {
                total += await this.getFolderSize(fullPath)
            } else {
                total += fs.statSync(fullPath).size
            }
        }

        return total
    }

    async connect(socket) {
        // 1. Wait for handshake to know where to start
        console.log('[Sender] Waiting for handshake...')
        const handshake = await waitForHandshake(socket)
        const startOffset = handshake.receivedBytes || 0
        console.log(`[Sender] Resuming from ${startOffset} bytes`)

        let packOpts = {}
        let packDir = this.folderPath

        const stats = await fs.promises.stat(this.folderPath)
        if (!stats.isDirectory()) {
            packDir = path.dirname(this.folderPath)
            packOpts = {
                entries: [path.basename(this.folderPath)]
            }
        }

        const packer = tar.pack(packDir, packOpts)

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
        this.outputDir = outputDir || "./Downloads"
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
        const handshake = JSON.stringify({ type: 'HANDSHAKE', receivedBytes: this.receivedBytes, folderSize: this.folderSize })
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
            fs.unlinkSync(this.tempFile)
        })
    }
}
