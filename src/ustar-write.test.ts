import 'zx/globals'

import { UstarWriter } from './ustar'

$.quiet = true

describe('UStar write', () => {
	beforeEach(() => {
		const tmp = tmpdir()
		cd(tmp)
		return () => fs.rm(tmp, { recursive: true, force: true })
	})

	test('write single file', async () => {
		const Filename = 'a.tar'
		const sink = fs.createWriteStream(Filename)
		const fw = new WritableStream({
			write: d =>
				new Promise((resolve, reject) => {
					sink.write(d, err => (err ? reject(err) : resolve()))
				}),
			close: () =>
				new Promise((resolve, reject) => {
					sink.close(err => (err ? reject(err) : resolve()))
				}),
		})

		const tar = new UstarWriter(fw)
		await tar.writeFile('foo', { path: './a' })
		await tar.close()
		await new Promise<void>((resolve, reject) => sink.close(err => (err ? reject(err) : resolve())))

		await $`tar -xf ${Filename}`
		expect(await fs.exists('./a')).to.be.true
		expect(await fs.readFile('./a', 'utf8')).to.eql('foo')
	})
	test('write multiple files', async () => {
		const Filename = 'a.tar'
		const sink = fs.createWriteStream(Filename)
		const fw = new WritableStream({
			write: d =>
				new Promise((resolve, reject) => {
					sink.write(d, err => (err ? reject(err) : resolve()))
				}),
			close: () =>
				new Promise((resolve, reject) => {
					sink.close(err => (err ? reject(err) : resolve()))
				}),
		})

		const tar = new UstarWriter(fw)
		await tar.writeFile('foo', { path: './a' })
		await tar.writeFile('bar', { path: './b' })
		await tar.writeFile('baz', { path: './c/d' })
		await tar.close()
		await new Promise<void>((resolve, reject) => sink.close(err => (err ? reject(err) : resolve())))

		await $`tar -xf ${Filename}`
		expect(await fs.exists('./a')).to.be.true
		expect(await fs.readFile('./a', 'utf8')).to.eql('foo')
		expect(await fs.exists('./b')).to.be.true
		expect(await fs.readFile('./b', 'utf8')).to.eql('bar')
		expect(await fs.exists('./c/d')).to.be.true
		expect(await fs.readFile('./c/d', 'utf8')).to.eql('baz')
	})
})
