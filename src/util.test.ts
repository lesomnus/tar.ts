import util from './util'

test.each([
	['0', 0],
	['00', 0],
	['01', 0o01],
	['10', 0o10],
	['10', 0o10],
	['', Number.NaN],
	['f', Number.NaN],

	['0o42', 0],
	['42f', 0o42],
])('oct(%j)=>%i', (given, expected) => {
	if (Number.isNaN(expected)) {
		expect(util.oct(given)).to.be.NaN
	} else {
		expect(util.oct(given)).to.eq(expected)
	}
})

test.each([
	['\0\0', ''],
	['\0a', ''],
	[' a ', 'a'],
	['a\0b', 'a'],
	['a\0', 'a'],
])('trim(%j)=>%j', (given, expected) => {
	expect(util.trim(given)).to.eq(expected)
})

test.each([
	[[0, 0, 0], 0],
	[[1, 2, 3], 6],
])('simpleSum(%j)=>%i', (given, expected) => {
	expect(util.simpleSum(Uint8Array.from(given))).to.eq(expected)
})
