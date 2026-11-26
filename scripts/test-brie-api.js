// Verified Banking Research Intelligence Engine (BRIE) — Test & Assertion Suite
// Strict TLS verification, HTTP status validation, timeouts, and factual assertions.

const http = require('http');
const https = require('https');
const assert = require('assert');

const TARGET_HOST = process.env.BRIE_TEST_HOST || '13.201.0.111.sslip.io';
const TARGET_PORT = parseInt(process.env.BRIE_TEST_PORT || '443', 10);
const IS_HTTPS = TARGET_PORT === 443;
const client = IS_HTTPS ? https : http;

function postQuery(query, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ query });
    const req = client.request({
      hostname: TARGET_HOST,
      port: TARGET_PORT,
      path: '/api/banking-knowledge/query',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
      timeout: timeoutMs,
      // Enforce strict TLS validation per Phase 2 reliability requirements
      rejectUnauthorized: true,
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`BRIE API returned HTTP ${res.statusCode}: ${body.slice(0, 300)}`));
        }
        try {
          const parsed = JSON.parse(body);
          resolve(parsed);
        } catch (e) {
          reject(new Error(`Failed to parse JSON response: ${body.slice(0, 200)}`));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timed out after ${timeoutMs}ms`));
    });

    req.on('error', (err) => {
      // If sslip.io self-signed certificate error occurs in non-production environments,
      // report clear diagnostic rather than silently disabling TLS.
      reject(err);
    });

    req.write(data);
    req.end();
  });
}

async function run() {
  console.log(`🔍 [BRIE Test] Running verified queries against ${TARGET_HOST}:${TARGET_PORT}...`);

  // Test 1: SBI Home Loan Interest Rate
  console.log("-> Testing SBI query...");
  const sbi = await postQuery('What is the interest rate on SBI Home Loan?');
  assert.strictEqual(sbi.answer_status, 'verified', 'SBI query must return verified answer_status');
  assert(sbi.institution && sbi.institution.display_name === 'SBI', 'Must match SBI institution');
  assert(Array.isArray(sbi.facts) && sbi.facts.length > 0, 'SBI query must return verified facts');
  assert(Array.isArray(sbi.citations) && sbi.citations.length > 0, 'SBI query must return official citations');
  assert(sbi.citations[0].source_url && sbi.citations[0].source_url.includes('sbi.co.in'), 'Citation must point to sbi.co.in');
  console.log("   ✅ SBI verification passed.");

  // Test 2: HDFC Personal Loan Foreclosure / Prepayment
  console.log("-> Testing HDFC foreclosure query...");
  const hdfc = await postQuery('Can I prepay or foreclose my HDFC personal loan?');
  assert.strictEqual(hdfc.answer_status, 'verified', 'HDFC query must return verified answer_status');
  assert(hdfc.institution && hdfc.institution.display_name === 'HDFC Bank', 'Must match HDFC Bank');
  assert(hdfc.facts.some(f => f.key === 'prepayment_charges' || f.title.includes('FORECLOSURE')), 'Must return HDFC foreclosure rules');
  assert(hdfc.citations.some(c => c.source_url.includes('hdfcbank.com')), 'Must cite hdfcbank.com');
  console.log("   ✅ HDFC verification passed.");

  // Test 3: Bajaj Finance Personal Loan Processing Charges
  console.log("-> Testing Bajaj Finance charges query...");
  const bajaj = await postQuery('What are Bajaj Finance personal loan processing fees?');
  assert.strictEqual(bajaj.answer_status, 'verified', 'Bajaj query must return verified answer_status');
  assert(bajaj.institution && bajaj.institution.display_name === 'Bajaj Finance', 'Must match Bajaj Finance');
  assert(bajaj.facts.some(f => f.key === 'processing_charges' || f.title.includes('PROCESSING')), 'Must return Bajaj processing fee');
  assert(bajaj.citations.some(c => c.source_url.includes('bajajfinserv.in')), 'Must cite bajajfinserv.in');
  console.log("   ✅ Bajaj Finance verification passed.");

  console.log("\n🎉 ALL BRIE TEST ASSERTIONS PASSED WITH VERIFIED EVIDENCE AND STRICT TLS!");
}

run().catch((err) => {
  console.error("❌ BRIE Test Failed:", err.message);
  process.exit(1);
});
