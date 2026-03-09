import chalk from 'chalk'
import gradient from 'gradient-string'

// ── Color Palette ──────────────────────────────────────────
const COLORS = {
    cyan: '#06b6d4',
    blue: '#3b82f6',
    purple: '#8b5cf6',
    magenta: '#d946ef',
    pink: '#ec4899',
    red: '#ef4444',
    orange: '#f97316',
    yellow: '#eab308',
    green: '#22c55e',
    teal: '#14b8a6',
    dim: '#6b7280',
}

// Preset gradients
const wormholeGradient = gradient(['#06b6d4', '#8b5cf6', '#d946ef', '#ec4899'])
const successGradient = gradient(['#22c55e', '#14b8a6'])
const fireGradient = gradient(['#f97316', '#eab308', '#ef4444'])

// ── Nickname Colors (rotate through vibrant colors) ────────
const NICK_COLORS = [
    '#06b6d4', '#8b5cf6', '#d946ef', '#ec4899',
    '#f97316', '#22c55e', '#3b82f6', '#14b8a6',
    '#eab308', '#ef4444',
]

const nickColorMap = new Map()
let nickColorIdx = 0

export function colorNick(nick) {
    if (!nickColorMap.has(nick)) {
        nickColorMap.set(nick, NICK_COLORS[nickColorIdx % NICK_COLORS.length])
        nickColorIdx++
    }
    return chalk.hex(nickColorMap.get(nick)).bold(nick)
}

// ── Styled Labels ──────────────────────────────────────────
export const label = {
    system: chalk.hex(COLORS.cyan).bold('[System]'),
    error: chalk.hex(COLORS.red).bold('[Error]'),
    success: chalk.hex(COLORS.green).bold('✓'),
    sender: chalk.hex(COLORS.yellow).bold('[Sender]'),
    receiver: chalk.hex(COLORS.blue).bold('[Receiver]'),
    chat: chalk.hex(COLORS.magenta).bold('[Chat]'),
    info: chalk.hex(COLORS.teal).bold('[Info]'),
}

// ── Styled Helpers ─────────────────────────────────────────
export function styledTime(timestamp) {
    const time = new Date(timestamp).toLocaleTimeString()
    return chalk.hex(COLORS.dim)(time)
}

export function divider() {
    return chalk.hex(COLORS.dim)('─'.repeat(50))
}

export function styledRoom(name) {
    return chalk.hex(COLORS.purple).bold(name)
}

export function styledTopic(hex) {
    return chalk.hex(COLORS.dim).italic(hex)
}

export function styledPath(p) {
    return chalk.hex(COLORS.teal).underline(p)
}

export function styledCommand(cmd) {
    return chalk.hex(COLORS.cyan)(cmd)
}

export function errorText(text) {
    return chalk.hex(COLORS.red)(text)
}

export function successText(text) {
    return chalk.hex(COLORS.green)(text)
}

export function dimText(text) {
    return chalk.hex(COLORS.dim)(text)
}

export function infoText(text) {
    return chalk.hex(COLORS.cyan)(text)
}

export function warnText(text) {
    return chalk.hex(COLORS.orange)(text)
}

// ── Banner ─────────────────────────────────────────────────
export function banner() {
    const art = `
 ██╗    ██╗ ██████╗ ██████╗ ███╗   ███╗██╗  ██╗ ██████╗ ██╗     ███████╗
 ██║    ██║██╔═══██╗██╔══██╗████╗ ████║██║  ██║██╔═══██╗██║     ██╔════╝
 ██║ █╗ ██║██║   ██║██████╔╝██╔████╔██║███████║██║   ██║██║     █████╗  
 ██║███╗██║██║   ██║██╔══██╗██║╚██╔╝██║██╔══██║██║   ██║██║     ██╔══╝  
 ╚███╔███╔╝╚██████╔╝██║  ██║██║ ╚═╝ ██║██║  ██║╚██████╔╝███████╗███████╗
  ╚══╝╚══╝  ╚═════╝ ╚═╝  ╚═╝╚═╝     ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚══════╝`

    console.log(wormholeGradient.multiline(art))
    console.log()
    console.log(wormholeGradient('  ⚡ P2P Anonymous Chat & File Transfer ⚡'))
    console.log(dimText(`  v1.0.0 — Encrypted • Decentralized • Unstoppable`))
    console.log(divider())
}

// ── Command Help ───────────────────────────────────────────
export function showHelp() {
    console.log()
    console.log(chalk.hex(COLORS.purple).bold('  Commands:'))
    console.log(`    ${styledCommand('/host or /join <room>')}    ${dimText('—')} ${dimText('Create or join a room')}`)
    console.log(`    ${styledCommand('/nick <name>')}    ${dimText('—')} ${dimText('Set your nickname')}`)
    console.log(`    ${styledCommand('/chat <msg>')}     ${dimText('—')} ${dimText('Send a message (or just type)')}`)
    console.log(`    ${styledCommand('/send <file>')}    ${dimText('—')} ${dimText('Send a file to peers')}`)
    console.log(`    ${styledCommand('/receive <dir>')}  ${dimText('—')} ${dimText('Receive files into a directory')}`)
    console.log(`    ${styledCommand('/quit')}           ${dimText('—')} ${dimText('Exit the shell')}`)
    console.log(divider())
    console.log()
}

export { chalk, gradient, wormholeGradient, successGradient, fireGradient }
