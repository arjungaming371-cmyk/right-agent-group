// Script to test Instagram Graph API connectivity
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
const envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';

function getEnv(key) {
  const match = envContent.match(new RegExp(`^\\s*${key}\\s*=\\s*([^\\r\\n#]+)`, 'm'));
  return match ? match[1].trim() : process.env[key] || '';
}

const token = getEnv('INSTAGRAM_ACCESS_TOKEN') || process.env.INSTAGRAM_ACCESS_TOKEN;
const accountId = getEnv('INSTAGRAM_ACCOUNT_ID') || process.env.INSTAGRAM_ACCOUNT_ID;

console.log('\n========================================');
console.log('  INSTAGRAM API CONNECTION TEST');
console.log('========================================\n');

if (!token) {
  console.log('❌ INSTAGRAM_ACCESS_TOKEN is missing in .env');
} else {
  console.log('✅ INSTAGRAM_ACCESS_TOKEN found (prefix: ' + token.slice(0, 12) + '...)');
}

if (!accountId) {
  console.log('❌ INSTAGRAM_ACCOUNT_ID is missing in .env');
} else {
  console.log('✅ INSTAGRAM_ACCOUNT_ID found: ' + accountId);
}

if (!token || !accountId) {
  console.log('\nPlease add INSTAGRAM_ACCESS_TOKEN and INSTAGRAM_ACCOUNT_ID to your .env file.');
  process.exit(1);
}

async function testConnection() {
  const base = token.startsWith('IG') ? 'https://graph.instagram.com/v21.0' : 'https://graph.facebook.com/v21.0';
  const url = `${base}/${accountId}?fields=id,username,name&access_token=${token}`;
  console.log('\nConnecting to Meta Instagram Graph API...');
  
  try {
    const res = await fetch(url);
    const data = await res.json();
    
    if (!res.ok || data.error) {
      console.error('\n❌ Meta API Error:');
      console.error('   Message: ' + (data.error?.message || res.statusText));
      console.error('   Code:    ' + (data.error?.code || res.status));
      console.error('   Type:    ' + (data.error?.type || 'Unknown'));
      process.exit(1);
    }
    
    console.log('\n🎉 SUCCESS! Connected to Instagram Business Profile:');
    console.log(`   Account ID: @${data.username || data.id}`);
    console.log(`   Name:       ${data.name || 'N/A'}`);
    console.log(`   IG ID:      ${data.id}`);
    console.log('\n✅ Your Instagram integration is live and ready to receive messages and comments!');
  } catch (err) {
    console.error('\n❌ Network or fetch error:', err.message);
    process.exit(1);
  }
}

testConnection();
