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

console.log('Second-by-second energy (0 = silence, higher = speech):');
const SEC_BYTES = 16000 * 2;
for (let sec = 0; sec < Math.floor(raw.length / SEC_BYTES); sec++) {
  let sum = 0;
  let max = 0;
  for (let j = 0; j < SEC_BYTES; j += 2) {
    const s = Math.abs(raw.readInt16LE(sec * SEC_BYTES + j));
    sum += s;
    if (s > max) max = s;
  }
  const avg = Math.round(sum / 16000);
  const bar = '#'.repeat(Math.min(50, Math.round(avg / 150)));
  console.log(`sec ${String(sec).padStart(2, '0')}: avg=${String(avg).padStart(4, ' ')} max=${String(max).padStart(5, ' ')} | ${bar}`);
}
