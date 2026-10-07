const { execSync } = require('child_process');
const fs = require('fs');

const mp3 = 'recordings/wacall-wacidIRggMzY3MTNCNUU5QUIyNTMzRDBGMjQ0N0ZGMzlBNTJDNUQcGAsxNTU1MTYxMjg4NBUCABUWAA.mp3';
execSync(`ffmpeg -y -i "${mp3}" -f s16le -ac 1 -ar 16000 temp_test.raw`);
const raw = fs.readFileSync('temp_test.raw');
fs.unlinkSync('temp_test.raw');

let peak = 0;
let clips = 0;
let silenceFrames = 0;
let totalFrames = 0;
let highEnergyFrames = 0;

for (let i = 0; i < raw.length; i += 640) {
  totalFrames++;
  let frameMax = 0;
  for (let j = 0; j < 640 && i + j + 1 < raw.length; j += 2) {
    const s = Math.abs(raw.readInt16LE(i + j));
    if (s > peak) peak = s;
    if (s >= 32700) clips++;
    if (s > frameMax) frameMax = s;
  }
  if (frameMax < 300) silenceFrames++;
  if (frameMax > 10000) highEnergyFrames++;
}

console.log({
  durationSec: raw.length / (16000 * 2),
  totalFrames,
  silenceFrames,
  activeFrames: totalFrames - silenceFrames,
  highEnergyFrames,
  peakSample: peak,
  clippedSamples: clips
});
