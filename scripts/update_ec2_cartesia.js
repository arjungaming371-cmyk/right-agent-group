const fs = require('fs');

const envPath = '/var/www/right-agent-group/.env';
if (fs.existsSync(envPath)) {
  let content = fs.readFileSync(envPath, 'utf8');
  content = content.replace(/CARTESIA_API_KEY=.*/g, 'CARTESIA_API_KEY=sk_car_w6SJB6uPLrEoPo6vb4S6ot');
  content = content.replace(/TTS_CALL_PROVIDER=.*/g, 'TTS_CALL_PROVIDER=cartesia');
  content = content.replace(/TTS_PROVIDER=.*/g, 'TTS_PROVIDER=cartesia');
  fs.writeFileSync(envPath, content, 'utf8');
  console.log('Successfully updated /var/www/right-agent-group/.env');
} else {
  console.error('.env not found at ' + envPath);
}
