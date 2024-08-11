import { DefaultFileHeader, type FileHeader, type Header, type InputHeader, type OptionalHeader, type Writer } from './types'

export abstract class WriterBase implements Writer {
	protected header: Required<OptionalHeader>

	constructor(header?: Required<OptionalHeader>) {
		this.header = structuredClone(header ?? DefaultFileHeader)
	}

	protected abstract openNext(head: FileHeader): Promise<WritableStream<Uint8Array>>

	next(head: Header): Promise<WritableStream<Uint8Array>> {
		return this.openNext({ ...this.header, mtime: new Date(), ...head })
	}

	abstract close(): Promise<void>

	writeFile(content: string, header: InputHeader): Promise<void>
	writeFile(data: BufferSource, header: InputHeader): Promise<void>
	writeFile(file: File, header?: Partial<InputHeader>): Promise<void>
	writeFile(blob: Blob, header: InputHeader): Promise<void>
	writeFile(stream: ReadableStream<Uint8Array>, header: Header): Promise<void>
	writeFile(body: string | BufferSource | File | Blob | ReadableStream<Uint8Array>, header?: Partial<InputHeader>): Promise<void> {
		if (body instanceof ReadableStream) {
			return this.next(header as Header).then(ws => body.pipeTo(ws))
		}
		if (body instanceof Blob) {
			const fh = body instanceof File ? { path: body.name, mtime: new Date(body.lastModified) } : undefined
			const h = {
				size: body.size,
				...fh,
				...(header as InputHeader),
			}
			return this.writeFile(body.stream(), h)
		}
		if (typeof body === 'string') {
			const encoder = new TextEncoder()
			const data = encoder.encode(body)
			return this.writeFile(data, header as InputHeader)
		}

		let buffer: Uint8Array
		if (body instanceof ArrayBuffer) {
			buffer = new Uint8Array(body)
		} else {
			buffer = new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
		}

		const h = {
			size: body.byteLength,
			...(header as InputHeader),
		}
		return this.next(h).then(async ws => {
			const w = ws.getWriter()
			await w.write(buffer)
			return w.close()
		})
	}
}
