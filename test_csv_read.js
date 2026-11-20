const fs = require('fs');
const path = require('path');

const recordingsDir = path.join(__dirname, 'data', 'recordings');
if (fs.existsSync(recordingsDir)) {
  const files = fs.readdirSync(recordingsDir).filter(f => f.endsWith('.csv'));
  console.log('Found recordings:', files);
  for (const f of files) {
    const p = path.join(recordingsDir, f);
    const content = fs.readFileSync(p, 'utf8');
    const lines = content.trim().split('\n');
    console.log(`  ${f}: ${lines.length} lines`);
  }
}
