import { UstarReader } from '../../src'

function query<E extends Element>(q: string) {
	const e = document.querySelector<E>(q)
	if (!e) throw new Error(`${q} does not exist`)
	return e
}

const input = query<HTMLInputElement>('#file')
const log = query<HTMLDivElement>('#log')

input.addEventListener('change', async e => {
	if (!input.files) return
	const file = input.files[0]
	let src = file.stream()
	if (['application/x-gzip'].includes(file.type)) {
		const dec = new DecompressionStream('gzip')
		src = src.pipeThrough(dec)
	}
	const r = new UstarReader(src)
	for await (const f of r) {
		console.log(f)
	}
})
