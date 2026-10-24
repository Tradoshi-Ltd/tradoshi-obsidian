// Reads the first sheet of an Excel workbook (.xlsx) into rows of text, without any
// library: an .xlsx file is a ZIP archive of XML files. Cells formatted as dates come out
// as "YYYY-MM-DD HH:MM:SS", so the CSV column detection and date reading apply as is.
// No Obsidian, no DOM: it runs in the plugin and in the tests alike.

interface Entry {
	name: string;
	method: number;
	size: number;
	offset: number;
}

const u16 = (b: Uint8Array, i: number): number => b[i] | (b[i + 1] << 8);
const u32 = (b: Uint8Array, i: number): number => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

function entries(b: Uint8Array): Map<string, Entry> {
	// End of central directory: searched from the end, past a comment of up to 64 KB.
	let end = -1;
	for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
		if (u32(b, i) === 0x06054b50) {
			end = i;
			break;
		}
	}
	if (end < 0) throw new Error("not a zip file");
	const count = u16(b, end + 10);
	let p = u32(b, end + 16);
	const out = new Map<string, Entry>();
	const decoder = new TextDecoder();
	for (let n = 0; n < count && u32(b, p) === 0x02014b50; n++) {
		const nameLen = u16(b, p + 28);
		const extraLen = u16(b, p + 30);
		const commentLen = u16(b, p + 32);
		const name = decoder.decode(b.subarray(p + 46, p + 46 + nameLen));
		out.set(name, { name, method: u16(b, p + 10), size: u32(b, p + 20), offset: u32(b, p + 42) });
		p += 46 + nameLen + extraLen + commentLen;
	}
	return out;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
	const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readEntry(b: Uint8Array, e: Entry): Promise<string> {
	if (u32(b, e.offset) !== 0x04034b50) throw new Error(`bad zip entry ${e.name}`);
	const start = e.offset + 30 + u16(b, e.offset + 26) + u16(b, e.offset + 28);
	const raw = b.subarray(start, start + e.size);
	const data = e.method === 0 ? raw : e.method === 8 ? await inflate(raw) : null;
	if (!data) throw new Error(`unsupported compression in ${e.name}`);
	return new TextDecoder().decode(data);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export function decodeXml(s: string): string {
	return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
		if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
		return ENTITIES[e.toLowerCase()] ?? _;
	});
}

/** Text of the <t> elements inside a piece of XML, joined (rich text runs included). */
const texts = (xml: string): string => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1])).join("");

/** "B" → 1, "AA" → 26. */
export function columnIndex(ref: string): number {
	let n = 0;
	for (const ch of ref.replace(/\d+$/, "").toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
	return n - 1;
}

/** Built-in number formats that are dates or times. */
const DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

/** The styles (cellXfs) whose number format shows a date or a time. */
function dateStyles(styles: string): Set<number> {
	const custom = new Map<number, string>();
	for (const m of styles.matchAll(/<numFmt\s[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) custom.set(Number(m[1]), decodeXml(m[2]));
	const isDate = (id: number): boolean => {
		if (DATE_FORMATS.has(id)) return true;
		const code = custom.get(id);
		if (!code) return false;
		// Quoted text and colours or conditions in brackets are not part of the date pattern.
		const bare = code.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "");
		return /[dmyhs]/i.test(bare) && !/^[#0.,%\s]*$/.test(bare);
	};
	const out = new Set<number>();
	const xfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? "";
	[...xfs.matchAll(/<xf\s([^>]*)\/?>/g)].forEach((m, i) => {
		const id = /numFmtId="(\d+)"/.exec(m[1]);
		if (id && isDate(Number(id[1]))) out.add(i);
	});
	return out;
}

/** An Excel serial date (days since 1899-12-30) as "YYYY-MM-DD HH:MM:SS". */
export function excelDate(serial: number): string {
	const ms = Math.round((serial - 25569) * 86400000);
	return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

/** The rows of the first sheet of the workbook, as text. */
export async function readXlsx(buffer: ArrayBuffer): Promise<string[][]> {
	const b = new Uint8Array(buffer);
	const files = entries(b);
	const read = async (name: string): Promise<string | null> => {
		const e = files.get(name);
		return e ? readEntry(b, e) : null;
	};
	// The first sheet of the workbook, through its relationship.
	let sheetPath = "xl/worksheets/sheet1.xml";
	const workbook = await read("xl/workbook.xml");
	const rels = await read("xl/_rels/workbook.xml.rels");
	const rid = workbook ? /<sheet\s[^>]*r:id="([^"]+)"/.exec(workbook)?.[1] : undefined;
	if (rid && rels) {
		const target = new RegExp(`<Relationship\\s[^>]*Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels)?.[1] ?? new RegExp(`<Relationship\\s[^>]*Target="([^"]+)"[^>]*Id="${rid}"`).exec(rels)?.[1];
		if (target) sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
	}
	const sheet = await read(sheetPath);
	if (!sheet) throw new Error("no sheet in the workbook");
	const shared = [...((await read("xl/sharedStrings.xml")) ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]));
	const dates = dateStyles((await read("xl/styles.xml")) ?? "");

	const rows: string[][] = [];
	for (const rm of sheet.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
		const rowNumber = Number(/\br="(\d+)"/.exec(rm[1])?.[1] ?? rows.length + 1);
		const row: string[] = [];
		for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
			const attrs = cm[1];
			const body = cm[2] ?? "";
			const ref = /\br="([A-Z]+)\d*"/.exec(attrs)?.[1];
			const col = ref ? columnIndex(ref) : row.length;
			const type = /\bt="(\w+)"/.exec(attrs)?.[1] ?? "n";
			const style = Number(/\bs="(\d+)"/.exec(attrs)?.[1] ?? -1);
			const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
			let value = "";
			if (type === "s") value = v === undefined ? "" : (shared[Number(v)] ?? "");
			else if (type === "inlineStr") value = texts(body);
			else if (type === "b") value = v === "1" ? "TRUE" : "FALSE";
			else if (v !== undefined) {
				const n = Number(v);
				value = type === "n" && dates.has(style) && Number.isFinite(n) ? excelDate(n) : decodeXml(v);
			}
			while (row.length < col) row.push("");
			row[col] = value;
		}
		// Empty rows keep their place, so row numbers match the sheet.
		while (rows.length < rowNumber - 1) rows.push([]);
		rows.push(row);
	}
	return rows;
}
