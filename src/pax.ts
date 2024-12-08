// Ref: https://pubs.opengroup.org/onlinepubs/9699919799/utilities/pax.html#tag_20_92_13_01

import io from '@lesomnus/io'
import util from './util'

export class PaxWriter {}

type Record = [string, string]

function parseRecord(s: string): Record {
	const b = s.indexOf(' ')
	const l = Number.parseInt(s.slice(0, b))

	const kv = s.slice(b + 1, l - 1)
	const p = kv.indexOf('=')
	const k = kv.slice(0, p)
	const v = kv.slice(p + 1)
	return [k, v]
}
