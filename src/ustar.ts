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
		const enc = util.useTextEncoder()

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
	#r: ReadableStreamBYOBReader

	#lastData: Pick<ReadableStream<Uint8Array>, 'locked' | 'cancel'>
	#work: Promise<void>

	constructor(r: ReadableStream<Uint8Array>) {
		super()
		this.#r = r.getReader({ mode: 'byob' })
		this.#lastData = {
			locked: false,
			cancel: () => Promise.resolve(),
		}
		this.#work = Promise.resolve()
	}

	async next(): Promise<IteratorResult<ReadResult, undefined>> {
		if (this.#lastData.locked) {
			throw new Error('last file must be unlocked')
		}

		// Wait until cursor moved to the next header block.
		await this.#lastData.cancel()

		const block = new Uint8Array(C.BlockSize)
		const { done, value } = await this.#r.read(block)
		if (done) {
			return { done: true, value: undefined }
		}

		const h = util.parseHeader(value)
		if (h === null) {
			// Assume it is end of the tar (two empty blocks).
			return { done: true, value: undefined }
		}

		h.path = h.prefix === '' ? h.path : `${h.prefix}/${h.path}`

		let canceled = false
		let remain = h.size
		const pad = C.BlockSize - ((h.size + C.BlockSize) & ~C.BlockSize)
		const read = async (ctrl: ReadableStreamController<Uint8Array>) => {
			if (remain < 1 || canceled) {
				const l = remain + pad
				if (l < 0) throw new Error('logic error: over-read')
				if (l > 0) {
					const { done, value } = await this.#r.read(new Uint8Array(l))
					if (done) {
						ctrl.error(new Error('unexpected end of file'))
						return
					}

					// TODO: handle partial read?
					remain -= value.byteLength
				}

				if (!canceled) {
					// Stream is in closed state if it is canceled.
					ctrl.close()
				}
				return
			}
			if ('byobRequest' in ctrl) {
				const req = ctrl.byobRequest
				if (req === null) {
					return
				}

				const view = req.view
				if (view === null) throw new Error('assert: view must not be null before respond')

				const l = Math.min(view.byteLength, remain + pad)
				const d = new Uint8Array(view.buffer, view.byteOffset, l)
				const { done, value } = await this.#r.read(d)
				if (done) {
					ctrl.error(new Error('unexpected end of file'))
					return
				}

				const bytesRead = value.byteLength
				req.respondWithNewView(value.subarray(0, Math.min(bytesRead, remain)))
				remain -= bytesRead
			} else {
				if (ctrl.desiredSize === null) throw new Error('assert: when it be null?')
				if (ctrl.desiredSize <= 0) return

				const l = Math.min(ctrl.desiredSize, remain + pad)
				const d = new Uint8Array(l)
				const { done, value } = await this.#r.read(d)
				if (done) {
					ctrl.error(new Error('unexpected end of file'))
					return
				}

				const bytesRead = value.byteLength
				ctrl.enqueue(value.subarray(0, Math.min(ctrl.desiredSize, remain)))
				remain -= bytesRead
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

		return { done: false, value: { ...h, data } }
	}

	close(): Promise<void> {
		this.#work = this.#work.then(() => {
			this.#r.releaseLock()
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
