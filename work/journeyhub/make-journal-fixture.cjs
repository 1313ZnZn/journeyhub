// Synthetic metadata fixture for local import QA. Image pixels are from the supplied prototype.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const exifr = require('exifr');
const html = fs.readFileSync(path.join(__dirname, 'original.html'), 'utf8');
const match = html.match(/data:image\/jpeg;base64,([A-Za-z0-9+/=]+)/);
assert(match, 'Prototype must contain a JPEG');
const original = Buffer.from(match[1], 'base64');
assert.equal(original.readUInt16BE(0), 0xffd8);
const tiff = Buffer.alloc(178);
tiff.write('II', 0, 'ascii');
tiff.writeUInt16LE(42, 2);
tiff.writeUInt32LE(8, 4);
function entry(offset, tag, type, count, value) {
  tiff.writeUInt16LE(tag, offset);
  tiff.writeUInt16LE(type, offset + 2);
  tiff.writeUInt32LE(count, offset + 4);
  tiff.writeUInt32LE(value, offset + 8);
}
// IFD0 points to EXIF and GPS subdirectories.
tiff.writeUInt16LE(2, 8);
entry(10, 0x8769, 4, 1, 38);
entry(22, 0x8825, 4, 1, 76);
tiff.writeUInt16LE(1, 38);
entry(40, 0x9003, 2, 20, 56);
tiff.write('2026:10:24 09:30:00\0', 56, 'ascii');
// Latitude/longitude references fit inline; rational values use data offsets.
tiff.writeUInt16LE(4, 76);
entry(78, 1, 2, 2, 78); // ASCII N\0
entry(90, 2, 5, 3, 130);
entry(102, 3, 2, 2, 69); // ASCII E\0
entry(114, 4, 5, 3, 154);
function dms(offset, decimal) {
  const degrees = Math.floor(decimal);
  const minutes = Math.floor((decimal - degrees) * 60);
  const seconds = Math.round(((decimal - degrees) * 60 - minutes) * 60 * 10000);
  [[degrees,1],[minutes,1],[seconds,10000]].forEach(([n,d],i)=>{
    tiff.writeUInt32LE(n, offset + i*8);
    tiff.writeUInt32LE(d, offset + i*8 + 4);
  });
}
dms(130, 31.2304);
dms(154, 121.4737);
const payload = Buffer.concat([Buffer.from('Exif\0\0', 'ascii'), tiff]);
const marker = Buffer.alloc(4);
marker.writeUInt16BE(0xffe1, 0);
marker.writeUInt16BE(payload.length + 2, 2);
const result = Buffer.concat([original.subarray(0, 2), marker, payload, original.subarray(2)]);
const output = path.resolve(__dirname, '..', 'journeyhub-fixture.jpg');
fs.writeFileSync(output, result);
(async()=>{
  const parsed = await exifr.parse(result);
  assert(Math.abs(parsed.latitude - 31.2304) < 1e-8);
  assert(Math.abs(parsed.longitude - 121.4737) < 1e-8);
  assert(parsed.DateTimeOriginal instanceof Date);
  const date = parsed.DateTimeOriginal;
  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 9);
  assert.equal(date.getDate(), 24);
  assert.equal(date.getHours(), 9);
  assert.equal(date.getMinutes(), 30);
  console.log(JSON.stringify({output, bytes:result.length, DateTimeOriginal:'2026:10:24 09:30:00', latitude:parsed.latitude, longitude:parsed.longitude, verification:'exifr.parse passed; metadata is synthetic'}, null, 2));
})().catch(error=>{console.error(error);process.exitCode=1;});
