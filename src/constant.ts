const C = {
	BlockSize: 512,
	Magic: 'ustar',
	Field: {
		Name: [0, 100],
		Prefix: [345, 155],
		Checksum: [148, 8],
		Magic: [257, 6],
	},
	NameMax: 100 + 155,
} as const

export default C
