const { execSync } = require('child_process');
const path = require('path');

console.log('Attempting to run supabase.exe status...');
const exePath = path.join(process.cwd(), 'supabase.exe');

try {
  const output = execSync(`"${exePath}" status`, { encoding: 'utf-8' });
  console.log('SUCCESS:');
  console.log(output);
} catch (e) {
  console.log('ERROR:');
  console.log(e.stdout || '');
  console.log(e.stderr || '');
  console.log(e.message);
}
