import { UstarReader, UstarWriter } from './ustar'

describe('UStar read', () => {
	test('read single file', async () => {
		let cursor = 0
		const src = new Uint8Array(4096)
		const sink = new WritableStream<Uint8Array>({
			write: d => {
				src.set(d, cursor)
				cursor += d.byteLength
			},
		})
		const tarW = new UstarWriter(sink)
		await tarW.writeFile(new Uint8Array([0x12, 0x34]), { path: './a' })
		await tarW.close()

		const blob = new Blob([src])
		const tarR = new UstarReader(blob.stream())
		const { done, value } = await tarR.next()
		expect(done).not.to.be.true
		expect(value).not.to.be.undefined
		if (!value) throw new Error()

		const { data, path } = value
		expect(path).to.eql('./a')

		const r = data.getReader({ mode: 'byob' })
		const buff = new Uint8Array(4096)
		{
			const { done, value } = await r.read(buff)
			expect(done).not.to.be.true
			expect(value).not.to.be.undefined
			expect(value).eql(Uint8Array.from([0x12, 0x34]))
		}
	})
	test('read multiple files', async () => {
		let cursor = 0
		const src = new Uint8Array(8192)
		const sink = new WritableStream<Uint8Array>({
			write: d => {
				src.set(d, cursor)
				cursor += d.byteLength
			},
		})
		const tarW = new UstarWriter(sink)
		await tarW.writeFile(new Uint8Array([0x12, 0x34]), { path: './a' })
		await tarW.writeFile(new Uint8Array([0x56, 0x78]), { path: './b' })
		await tarW.writeFile(new Uint8Array([0x9a, 0xbc]), { path: './c' })
		await tarW.writeFile(new Uint8Array([0xde, 0xf1]), { path: './d' })
		await tarW.writeFile(new Uint8Array([0x23, 0x45]), { path: './e' })
		await tarW.close()

		const blob = new Blob([src])
		const tarR = new UstarReader(blob.stream())

		// Left some data.
		{
			const { done, value } = await tarR.next()
			expect(done).not.to.be.true
			expect(value).not.to.be.undefined
			if (!value) throw new Error()

			const { data, path } = value
			expect(path).to.eql('./a')

			const r = data.getReader({ mode: 'byob' })
			const buff = new Uint8Array(1)
			{
				const { done, value } = await r.read(buff)
				expect(done).not.to.be.true
				expect(value).not.to.be.undefined
				expect(value).eql(Uint8Array.from([0x12]))
			}
			r.releaseLock()
		}

		// Large buffer but smaller than the block.
		{
			const { done, value } = await tarR.next()
			expect(done).not.to.be.true
			expect(value).not.to.be.undefined
			if (!value) throw new Error()

			const { data, path } = value
			expect(path).to.eql('./b')

			const r = data.getReader({ mode: 'byob' })
			const buff = new Uint8Array(100)
			{
				const { done, value } = await r.read(buff)
				expect(done).not.to.be.true
				expect(value).not.to.be.undefined
				expect(value).eql(Uint8Array.from([0x56, 0x78]))
			}
			r.releaseLock()
		}

		// Large buffer greater than the block.
		{
			const { done, value } = await tarR.next()
			expect(done).not.to.be.true
			expect(value).not.to.be.undefined
			if (!value) throw new Error()

			const { data, path } = value
			expect(path).to.eql('./c')

			const r = data.getReader({ mode: 'byob' })
			const buff = new Uint8Array(800)
			{
				const { done, value } = await r.read(buff)
				expect(done).not.to.be.true
				expect(value).not.to.be.undefined
				expect(value).eql(Uint8Array.from([0x9a, 0xbc]))
			}
			r.releaseLock()
		}

		// Read partially.
		{
			const { done, value } = await tarR.next()
			expect(done).not.to.be.true
			expect(value).not.to.be.undefined
			if (!value) throw new Error()

			const { data, path } = value
			expect(path).to.eql('./d')

			const r = data.getReader({ mode: 'byob' })
			let buff = new Uint8Array(1)
			{
				const { done, value } = await r.read(buff)
				expect(done).not.to.be.true
				expect(value).not.to.be.undefined
				expect(value).eql(Uint8Array.from([0xde]))
				if (!value) throw new Error()
				buff = value
			}
			{
				const { done, value } = await r.read(buff)
				expect(done).not.to.be.true
				expect(value).not.to.be.undefined
				expect(value).eql(Uint8Array.from([0xf1]))
			}
			r.releaseLock()
		}

		// Read last file
		{
			const { done, value } = await tarR.next()
			expect(done).not.to.be.true
			expect(value).not.to.be.undefined
			if (!value) throw new Error()

			const { data, path } = value
			expect(path).to.eql('./e')

			const r = data.getReader({ mode: 'byob' })
			const buff = new Uint8Array(100)
			{
				const { done, value } = await r.read(buff)
				expect(done).not.to.be.true
				expect(value).not.to.be.undefined
				expect(value).eql(Uint8Array.from([0x23, 0x45]))
			}
			r.releaseLock()
		}
	})
	test('async iterator', async () => {
		let cursor = 0
		const src = new Uint8Array(8192)
		const sink = new WritableStream<Uint8Array>({
			write: d => {
				src.set(d, cursor)
				cursor += d.byteLength
			},
		})

		const paths = ['./a', './b', './c', './d', './e']
		const tarW = new UstarWriter(sink)
		for (const path of paths) {
			await tarW.writeFile(new Uint8Array([0x12, 0x34]), { path })
		}
		await tarW.close()

		const blob = new Blob([src])
		const tarR = new UstarReader(blob.stream())

		let i = 0
		for await (const v of tarR) {
			const path = paths[i]
			expect(v.path).to.eq(path)
			i++
		}
		expect(i).to.eq(paths.length)
	})
})
