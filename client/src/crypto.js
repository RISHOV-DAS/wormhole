import crypto from 'crypto'

export function hashRoomKey(key) {
    return crypto.createHash('sha256').update(key).digest()
}
