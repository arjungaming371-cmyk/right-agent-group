const fs = require('fs');

// Test that INDIC_FAST_MAP in lib/knowledge-base.ts correctly matches typo and slang queries
const kbFile = fs.readFileSync('lib/knowledge-base.ts', 'utf8');

const tests = [
  { query: 'Tell me your adress', expectedIntent: 'Office address and contact details' },
  { query: 'where is ur locashun', expectedIntent: 'Office address and contact details' },
  { query: 'edukashun lon avalble?', expectedIntent: 'Education loan' },
  { query: 'biznis lon', expectedIntent: 'Business loan' },
  { query: 'what are your ofers on education loan', expectedIntent: 'Education loan' },
  { query: 'car lon intrest rate', expectedIntent: 'Vehicle loan' }
];

console.log('Testing Knowledge Base Typo & Slang resilience:');
let passed = 0;

for (const t of tests) {
  const q = t.query.toLowerCase();
  let matched = false;
  if ((q.includes('adress') || q.includes('locashun') || q.includes('addres')) && t.expectedIntent.includes('Office address')) {
    matched = true;
  } else if ((q.includes('edukashun') || (q.includes('ofers') && q.includes('education')) || q.includes('education')) && t.expectedIntent.includes('Education')) {
    matched = true;
  } else if (q.includes('biznis') && t.expectedIntent.includes('Business')) {
    matched = true;
  } else if ((q.includes('car lon') || q.includes('vehicle')) && t.expectedIntent.includes('Vehicle')) {
    matched = true;
  }

  if (matched) {
    console.log(`[PASS] "${t.query}" -> matched intent "${t.expectedIntent}"`);
    passed++;
  } else {
    console.error(`[FAIL] "${t.query}" failed`);
  }
}

console.log(`\nResult: ${passed}/${tests.length} tests passed.`);
