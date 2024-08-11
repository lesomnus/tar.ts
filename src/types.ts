export enum FileType {
	Regular = '0',
	RegularAlt = '\0',
	Hard = '1',
	Symlink = '2',
	Character = '3',
	Block = '4',
	Directory = '5',
	Fifo = '6',
	Contiguous = '7',

	Extended = 'x',
	GlobalExtended = 'g',
}

export type Perms = number

export enum Perm {
	OwnerAll = 0o700,
	OwnerRead = 0o400,
	OwnerWrite = 0o200,
	OwnerExec = 0o100,

	GroupAll = 0o070,
	GroupRead = 0o040,
	GroupWrite = 0o020,
	GroupExec = 0o010,

	OtherAll = 0o007,
	OtherRead = 0o004,
	OtherWrite = 0o002,
	OtherExec = 0o001,

	All = 0o777,

	SetUid = 0o4000,
	SetGid = 0o2000,
	Sticky = 0o1000,

	Mask = 0o7777,
}

export type FileHeader = {
	path: string
	mode: Perms

	uid: number
	gid: number
	size: number

	mtime: Date
	type: FileType
	link: string

	uname: string
	gname: string

	devmajor: number
	devminor: number
}

export type FileHeaderRaw = FileHeader & {
	prefix: string
}

export type OptionalHeader = Partial<Omit<FileHeader, 'path' | 'size'>>

export type Header = OptionalHeader & {
	path: string
	size: number
}

export type InputHeader = Omit<Header, 'size'>

export type Buffer = BufferSource | Blob | ReadableStream<Uint8Array>

export type ReadResult = FileHeader & {
	data: ReadableStream<Uint8Array>
}

export interface Writer {
	next(header: Header): Promise<WritableStream<Uint8Array>>
	close(): Promise<void>

	writeFile(content: string, header: InputHeader): Promise<void>
	writeFile(data: BufferSource, header: InputHeader): Promise<void>
	writeFile(file: File, header?: Partial<InputHeader>): Promise<void>
	writeFile(blob: Blob, header: InputHeader): Promise<void>
	writeFile(stream: ReadableStream<Uint8Array>, header: Header): Promise<void>
}

export interface Reader extends AsyncIterable<ReadResult> {
	next(): Promise<IteratorResult<ReadResult, undefined>>
	close(): Promise<void>
}

export const DefaultFileHeader: Required<OptionalHeader> = {
	mode: Perm.OwnerRead | Perm.OwnerWrite | Perm.GroupRead | Perm.OtherRead,

	uid: 1000,
	gid: 1000,

	mtime: new Date(),
	type: FileType.Regular,
	link: '',

	uname: 'hypnos',
	gname: 'hypnos',

	devmajor: 0,
	devminor: 0,
}
