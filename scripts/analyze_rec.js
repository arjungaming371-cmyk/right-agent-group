const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const mp3 = process.argv[2]
if (!mp3 || !fs.existsSync(mp3)) {
  console.error('Usage: node ' + path.basename(process.argv[1]) + ' <path-to-mp3>')
  process.exit(1)
}
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
