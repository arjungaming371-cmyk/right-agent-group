const https = require('https');

function postQuery(query) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ query });
    const req = https.request({
      hostname: '13.201.0.111.sslip.io',
      port: 443,
      path: '/api/banking-knowledge/query',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
      rejectUnauthorized: false
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          resolve(body);
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function run() {
  const q1 = await postQuery('What is the interest rate on SBI Home Loan?');
  console.log('=== SBI QUERY RESULT ===');
  console.log(JSON.stringify(q1, null, 2));

  const q2 = await postQuery('Can I prepay or foreclose my HDFC personal loan?');
  console.log('=== HDFC QUERY RESULT ===');
  console.log(JSON.stringify(q2, null, 2));

  const q3 = await postQuery('What are Bajaj Finance personal loan processing fees?');
  console.log('=== BAJAJ QUERY RESULT ===');
  console.log(JSON.stringify(q3, null, 2));
}

run().catch(console.error);
