/**
 * Draws the PWA icons and writes them as PNGs.
 *
 * The mark is the app's own visual language: the lime corner bracket from `.card::before`
 * plus a slash for "halp/games", on the page background.
 *
 * Run with `node scripts/generate-icons.mjs` after changing the design. The output is
 * committed, so this is not part of the build.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'static', 'icons');

const BG = [0x0e, 0x0e, 0x0e];
const ACCENT = [0xc8, 0xf5, 0x6a];

/** Perpendicular distance from a point to a line segment. */
const distToSegment = (px, py, ax, ay, bx, by) => {
	const dx = bx - ax;
	const dy = by - ay;
	const len = dx * dx + dy * dy;
	const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len));
	return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

const slash = (s, x, y, x1, y1, x2, y2, width) =>
	distToSegment(x, y, x1 * s, y1 * s, x2 * s, y2 * s) <= (width * s) / 2;

/** The full mark: corner bracket plus slash. */
const standard = (s) => (x, y) => {
	const t = s * 0.045;
	const inset = s * 0.1;
	const arm = s * 0.3;
	const right = s - inset;
	if (x >= right - arm && x <= right && y >= inset && y <= inset + t) return true;
	if (x >= right - t && x <= right && y >= inset && y <= inset + arm) return true;
	return slash(s, x, y, 0.3, 0.78, 0.64, 0.3, 0.14);
};

/** Maskable icons get cropped to a centred circle, so the bracket is dropped. */
const maskable = (s) => (x, y) => slash(s, x, y, 0.34, 0.7, 0.66, 0.3, 0.15);

const SUBSAMPLES = 3;

/** Renders a shape predicate to raw RGB rows, supersampled for smooth edges. */
const render = (size, makeShape) => {
	const shape = makeShape(size);
	/* One filter byte (0 = none) per row, then RGB triples. */
	const raw = Buffer.alloc(size * (1 + size * 3));

	for (let y = 0; y < size; y++) {
		let offset = y * (1 + size * 3) + 1;
		for (let x = 0; x < size; x++) {
			let hits = 0;
			for (let sy = 0; sy < SUBSAMPLES; sy++) {
				for (let sx = 0; sx < SUBSAMPLES; sx++) {
					if (shape(x + (sx + 0.5) / SUBSAMPLES, y + (sy + 0.5) / SUBSAMPLES)) hits++;
				}
			}
			const alpha = hits / (SUBSAMPLES * SUBSAMPLES);
			for (let c = 0; c < 3; c++) {
				raw[offset++] = Math.round(BG[c] + (ACCENT[c] - BG[c]) * alpha);
			}
		}
	}

	return raw;
};

const CRC_TABLE = (() => {
	const table = new Int32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c;
	}
	return table;
})();

const crc32 = (buf) => {
	let c = -1;
	for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
	return (c ^ -1) >>> 0;
};

const chunk = (type, data) => {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body));
	return Buffer.concat([length, body, crc]);
};

const png = (size, raw) => {
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(size, 0);
	ihdr.writeUInt32BE(size, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 2; // colour type: truecolour, no alpha
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', deflateSync(raw, { level: 9 })),
		chunk('IEND', Buffer.alloc(0))
	]);
};

mkdirSync(OUT_DIR, { recursive: true });

for (const [name, size, shape] of [
	['icon-192.png', 192, standard],
	['icon-512.png', 512, standard],
	['icon-512-maskable.png', 512, maskable]
]) {
	const file = join(OUT_DIR, name);
	writeFileSync(file, png(size, render(size, shape)));
	console.log(`wrote ${file}`);
}
