import type { ReadResult, Reader } from './types'

export abstract class ReaderBase implements Reader {
	abstract next(): Promise<IteratorResult<ReadResult, undefined>>
	abstract close(): Promise<void>

	[Symbol.asyncIterator](): AsyncIterator<ReadResult> {
		return this
	}
}
