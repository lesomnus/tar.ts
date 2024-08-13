import { UstarReader, UstarWriter } from './ustar'

const enc = (() => {
	const v = new TextEncoder()
	return v.encode.bind(v)
})()

async function expectValue<T>(iter: Promise<{ done?: boolean; value?: T }>, expected?: T): Promise<T> {
	const { done, value } = await iter
	expect(done).not.to.be.true
	expect(value).not.to.be.undefined
	if (expected) {
		expect(value).to.eql(expected)
	}

	return value as T
}

function useSink(size: number) {
	let cursor = 0
	const src = new Uint8Array(size)
	const sink = new WritableStream<Uint8Array>({
		write: d => {
			src.set(d, cursor)
			cursor += d.byteLength
		},
	})

	return [src, sink] as const
}

async function makeTar(files: [string, ArrayBuffer | string | number[]][]) {
	const [src, sink] = useSink(8192)
	const tarW = new UstarWriter(sink)
	for (let [path, data] of files) {
		if (Array.isArray(data)) data = new Uint8Array(data)
		await tarW.writeFile(data, { path })
	}
	await tarW.close()

	const blob = new Blob([src])
	const r = new UstarReader(blob.stream())
	return r
}

describe('UStar read', () => {
	describe('BYOB', () => {
		test('read single file with large buffer', async () => {
			const tar = await makeTar([['./a', [0x12, 0x34]]])
			{
				const { data, path } = await expectValue(tar.next())
				expect(path).to.eql('./a')

				const buff = new Uint8Array(100)
				const r = data.getReader({ mode: 'byob' })
				await expectValue(r.read(buff), Uint8Array.from([0x12, 0x34]))
			}
		})
		test('read partial of first and then move to next', async () => {
			const tar = await makeTar([
				['./a', [0x12, 0x34]],
				['./b', [0x56, 0x78]],
			])
			{
				const { data, path } = await expectValue(tar.next())
				expect(path).to.eql('./a')

				const buff = new Uint8Array(1)
				const r = data.getReader({ mode: 'byob' })
				await expectValue(r.read(buff), Uint8Array.from([0x12]))
			}
			{
				const { data, path } = await expectValue(tar.next())
				expect(path).to.eql('./b')

				const buff = new Uint8Array(100)
				const r = data.getReader({ mode: 'byob' })
				await expectValue(r.read(buff), Uint8Array.from([0x56, 0x78]))
			}
		})
		test('read using buffer lager than block', async () => {
			const tar = await makeTar([
				['./a', [0x12, 0x34]],
				['./b', [0x56, 0x78]],
			])
			{
				const { data, path } = await expectValue(tar.next())
				expect(path).to.eql('./a')

				const buff = new Uint8Array(800)
				const r = data.getReader({ mode: 'byob' })
				await expectValue(r.read(buff), Uint8Array.from([0x12, 0x34]))
			}
			{
				const { data, path } = await expectValue(tar.next())
				expect(path).to.eql('./b')

				const buff = new Uint8Array(100)
				const r = data.getReader({ mode: 'byob' })
				await expectValue(r.read(buff), Uint8Array.from([0x56, 0x78]))
			}
		})
		test('read a file larger than the block size in chunks', async () => {
			const tar = await makeTar([
				['./a', `${'a'.repeat(300)}${'b'.repeat(300)}${'c'.repeat(200)}`],
				['./b', [0x56, 0x78]],
			])
			{
				const { data, path } = await expectValue(tar.next())
				expect(path).to.eql('./a')

				let buff = new Uint8Array(300)
				const r = data.getReader({ mode: 'byob' })
				buff = await expectValue(r.read(buff), enc('a'.repeat(300)))
				buff = await expectValue(r.read(buff), enc('b'.repeat(300)))
				buff = await expectValue(r.read(buff), enc('c'.repeat(200)))
			}
			{
				const { data, path } = await expectValue(tar.next())
				expect(path).to.eql('./b')

				const buff = new Uint8Array(100)
				const r = data.getReader({ mode: 'byob' })
				await expectValue(r.read(buff), Uint8Array.from([0x56, 0x78]))
			}
		})
		test('read a file larger than the block size at once.', async () => {
			const tar = await makeTar([
				['./a', 'd'.repeat(800)],
				['./b', [0x56, 0x78]],
			])
			{
				const { data, path } = await expectValue(tar.next())
				expect(path).to.eql('./a')

				const buff = new Uint8Array(2000)
				const r = data.getReader({ mode: 'byob' })
				await expectValue(r.read(buff), enc('d'.repeat(800)))
			}
			{
				const { data, path } = await expectValue(tar.next())
				expect(path).to.eql('./b')

				const buff = new Uint8Array(100)
				const r = data.getReader({ mode: 'byob' })
				await expectValue(r.read(buff), Uint8Array.from([0x56, 0x78]))
			}
		})
		test('async iterator', async () => {
			const paths = ['./a', './b', './c', './d', './e']
			const tar = await makeTar(paths.slice().map(p => [p, enc(p)] as const))

			let i = 0
			for await (const v of tar) {
				const path = paths[i]
				expect(v.path).to.eq(path)

				const buff = new Uint8Array(100)
				const r = v.data.getReader({ mode: 'byob' })
				await expectValue(r.read(buff), enc(path))

				i++
			}
			expect(i).to.eq(paths.length)
		})
	})
	describe('queue', () => {
		test('read', async () => {
			const tar = await makeTar([['./a', [0x12, 0x34]]])
			{
				const { data, path } = await expectValue(tar.next())
				expect(path).to.eql('./a')

				const r = data.getReader()
				await expectValue(r.read(), Uint8Array.from([0x12, 0x34]))
			}
		})
	})
})
