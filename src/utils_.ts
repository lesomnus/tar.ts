import C from './constant'
import type { FileHeaderRaw, FileType } from './types'

export function sub(d: Uint8Array, pos: number, l: number) {
	return d.subarray(pos, pos + l)
}

// Parsing a number from a string represented in octal.
export function oct(v: string) {
	return Number.parseInt(v, 8)
}

export function trim(v: string): string {
	const i = v.indexOf('\0')
	if (i >= 0) v = v.slice(0, i)

	return v.trim()
}

export function useTextEncoder() {
	const v = new TextEncoder()
	return v.encodeInto.bind(v)
}

export function useTextDecode() {
	const v = new TextDecoder()
	return v.decode.bind(v)
}

export function useMarshal(src: Uint8Array) {
	let c = 0
	return (n: number, f: (d: Uint8Array) => void) => {
		const next = c + n
		f(src.subarray(c, next))
		c = next
	}
}

export function useScan(src: Uint8Array) {
	let c = 0
	const s = <T>(n: number, f: (d: Uint8Array) => T) => {
		const next = c + n
		const v = f(src.subarray(c, next))
		c = next
		return v
	}

	s.skip = (n: number) => {
		c += n
	}
	return s
}

export function simpleSum(d: Uint8Array) {
	return d.reduce((a, b) => a + b)
}

export function parseHeader(block: Uint8Array): FileHeaderRaw | null {
	if (block.length !== C.BlockSize) {
		throw new Error('unexpected block size')
	}

	const dec = useTextDecode()

	// It only checks the magic starts with "ustar",
	// so it is okay if there is no null.
	if (dec(sub(block, ...C.Field.Magic)).slice(0, C.Magic.length) !== C.Magic) {
		return null
	}

	const sum = oct(dec(sub(block, ...C.Field.Checksum)))
	// https://www.gnu.org/software/tar/manual/html_node/Standard.html#Standard
	// When calculating the checksum, the `chksum` field is treated
	// as if it were filled with spaces (ASCII 32).
	sub(block, ...C.Field.Checksum).fill(0x20)
	if (sum !== simpleSum(block)) {
		throw new Error('checksum mismatch')
	}

	const h = {} as FileHeaderRaw
	const s = useScan(block)

	h.path = s(100, d => trim(dec(d)))
	h.mode = s(8, d => oct(dec(d)))
	h.uid = s(8, d => oct(dec(d)))
	h.gid = s(8, d => oct(dec(d)))
	h.size = s(12, d => oct(dec(d)))
	h.mtime = new Date(s(12, d => oct(dec(d))) * 1000)
	s.skip(8) // checksum.
	h.type = s(1, d => dec(d)) as FileType
	h.link = s(100, d => trim(dec(d)))
	s.skip(6) // magic.
	s.skip(2) // version.
	h.uname = s(32, d => trim(dec(d)))
	h.gname = s(32, d => trim(dec(d)))
	h.devmajor = s(8, d => oct(dec(d)))
	h.devminor = s(8, d => oct(dec(d)))
	h.prefix = s(155, d => trim(dec(d)))

	return h
}
