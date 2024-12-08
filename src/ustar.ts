import io from '@lesomnus/io'

import C from './constant'
import { ReaderBase } from './reader'
import { type FileHeader, type OptionalHeader, Perm, type ReadResult } from './types'
import util from './util'
import { WriterBase } from './writer'

const HeaderNameSizeMax = C.Field.Prefix[1] + C.Field.Name[1]

export class UstarWriter extends WriterBase {
	#w: WritableStreamDefaultWriter<Uint8Array>

	constructor(w: WritableStream<Uint8Array>, header?: Required<OptionalHeader>) {
		super(header)
		this.#w = w.getWriter()
	}

	openNext(h: FileHeader): Promise<WritableStream<Uint8Array>> {
		h.mode &= Perm.Mask
		const [name, prefix] = splitPath(h.path)

		const block = new Uint8Array(C.BlockSize)
		const m = util.useMarshal(block)
		const enc = util.useTextEncode()

		m(100, d => enc(name, d))
		m(8, d => enc(str(h.mode, 7), d))
		m(8, d => enc(str(h.uid, 7), d))
		m(8, d => enc(str(h.gid, 7), d))
		m(12, d => enc(str(h.size, 11), d)) // size
		m(12, d => enc(str(Math.floor(h.mtime.getTime() / 1000), 11), d))
		m(8, d => enc('        ', d)) // checksum
		m(1, d => enc(h.type, d))
		m(100, d => enc(h.link, d))
		m(6, d => enc('ustar', d))
		m(2, d => enc('00', d))
		m(32, d => enc(h.uname, d))
		m(32, d => enc(h.gname, d))
		m(8, d => enc(str(h.devmajor, 7), d))
		m(8, d => enc(str(h.devminor, 7), d))
		m(155, d => enc(prefix, d))

		const sum = util.simpleSum(block)
		enc(`${str(sum, 6)}\0 `, util.sub(block, ...C.Field.Checksum))

		let n = 0
		const write: UnderlyingSinkWriteCallback<Uint8Array> = d => {
			n = (n + d.byteLength) % C.BlockSize
			return this.#w.ready.then(() => this.#w.write(d))
		}
		const close: UnderlyingSinkCloseCallback = () => {
			if (n === 0) return Promise.resolve()

			const d = new Uint8Array(C.BlockSize - n)
			return this.#w.ready.then(() => this.#w.write(d))
		}

		return this.#w.write(block).then(() => {
			return new WritableStream({ write, close })
		})
	}

	close(): Promise<void> {
		return this.#w.ready
			.then(() => this.#w.write(new Uint8Array(C.BlockSize * 2)))
			.then(() => this.#w.ready)
			.then(() => this.#w.releaseLock())
	}
}

export class UstarReader extends ReaderBase {
	#r: io.Reader & io.Closer

	#lastData: Pick<ReadableStream<Uint8Array>, 'locked' | 'cancel'>
	#dataLock: { releaseLock(): void }
	#work: Promise<void>

	constructor(r: ReadableStream<Uint8Array>) {
		super()
		this.#r = io.fromReadableStream(r)
		this.#lastData = {
			locked: false,
			cancel: () => Promise.resolve(),
		}
		this.#dataLock = { releaseLock() {} }
		this.#work = Promise.resolve()
	}

	async next(): Promise<IteratorResult<ReadResult, undefined>> {
		if (this.#lastData.locked) {
			this.#dataLock.releaseLock()
		}

		// Wait until cursor moved to the next header block.
		await this.#lastData.cancel()

		const block = io.make(C.BlockSize)
		await io.readFull(this.#r, block)

		const h = util.parseHeader(block.data)
		if (h === null) {
			// Assume it is end of the tar (two empty blocks).
			return { done: true, value: undefined }
		}

		h.path = h.prefix === '' ? h.path : `${h.prefix}/${h.path}`

		//         remain   pad
		//       |<------>|<--->|
		// ......|........|.....|
		//       ^        ^     ^
		//  cursor    file-end  block-end
		//
		// `remain` can be negative if "cursor" in the between of "file-end" and "block-end"
		// so "cursor" + `remain` + `pad` always be "block-end".

		let canceled = false
		let remain = h.size
		const pad = C.BlockSize - ((h.size % C.BlockSize) % C.BlockSize)
		const read = async (ctrl: ReadableStreamController<Uint8Array>) => {
			if (remain < 1 || canceled) {
				// By reading `l` bytes, "cursor" == "block-end".
				const l = remain + pad
				if (l < 0) throw new Error('logic error: over-read')
				if (l > 0) {
					const r = new io.LimitedReader(this.#r, l)
					const n = await io.copy(io.discard, r)
					remain -= n
				}

				if (!canceled) {
					// Stream is in closed state if it is canceled.
					ctrl.close()
				}
				return
			}
			if ('byobRequest' in ctrl && ctrl.byobRequest !== null) {
				const req = ctrl.byobRequest
				const view = req.view
				if (view === null) throw new Error('assert: view must not be null before respond')

				const l = Math.min(view.byteLength, remain + pad)
				const b = new io.Buff(view.buffer, view.byteOffset, l)
				const n = await this.#r.read(b)
				if (!n) {
					ctrl.error(new Error('unexpected end of file'))
					return
				}

				const fileReadSize = Math.min(n, remain)
				remain -= n

				req.respondWithNewView(b.subbuff(0, fileReadSize).data)
			} else {
				if (ctrl.desiredSize === null) throw new Error('assert: when it be null?')

				let l = remain + pad
				if (ctrl.desiredSize > 0) {
					l = Math.min(ctrl.desiredSize, l)
				}

				const b = io.make(l)
				const n = await this.#r.read(b)
				if (!n) {
					ctrl.error(new Error('unexpected end of file'))
					return
				}

				const fileReadSize = Math.min(n, remain)
				remain -= n

				ctrl.enqueue(b.subbuff(0, fileReadSize).data)
				if (ctrl.desiredSize <= 0) return
			}

			return read(ctrl)
		}

		const data = new ReadableStream<Uint8Array>({
			type: 'bytes',
			start: ctrl => {
				this.#work = this.#work.then(() => read(ctrl))
				return this.#work
			},
			pull: ctrl => {
				this.#work = this.#work.then(() => read(ctrl))
				return this.#work
			},
			cancel: () => {
				canceled = true
				let err: unknown = undefined
				this.#work = this.#work
					.then(() =>
						read({
							error: e => {
								err = e
							},
							close: () => {},
						} as ReadableStreamController<Uint8Array>),
					)
					.then(() => {
						if (err) throw err
					})
				return this.#work
			},
		})
		this.#lastData = data
		const getReader = data.getReader.bind(data)
		data.getReader = (options => {
			const r = getReader(options)
			this.#dataLock = r
			return r
		}) as typeof getReader

		return { done: false, value: { ...h, data } }
	}

	close(): Promise<void> {
		this.#work = this.#work.then(() => {
			this.#r.close()
		})
		return this.#work
	}
}

// assume 'a/.../b/foo' is length 150
// 'a/.../b/foo' => ['a/.../b', 'foo']
// 'a/.../b/foo/bar' => ['a/.../b/foo', 'bar']
// 'a/.../b/foo/bar/baz' => ['a/.../b/foo', 'bar/baz']
function splitPath(path: string): [string, string] {
	let l = path.length
	if (path[l - 1] === '/') {
		l--
		path = path.slice(0, l)
	}
	if (l <= C.Field.Name[1]) return [path, '']
	if (l > HeaderNameSizeMax - 1 || !path.includes('/')) throw new Error('name too long')

	const p = path.lastIndexOf('/')
	let i = 0
	while (true) {
		const j = path.indexOf('/', i)
		if (j > C.Field.Prefix[1]) break
		if (j >= p) break

		i = j
	}

	return [path.slice(i + 1), path.slice(i)]
}

// Print number and pad zeros at front.
function str(v: number, n: number) {
	return v.toString(8).padStart(n, '0')
}
