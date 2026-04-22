const fs = require('fs');
const path = require('path');
const walkSync = (dir) => fs.readdirSync(dir).reduce((files, file) => {
  const name = path.join(dir, file);
  return fs.statSync(name).isDirectory() ? [...files, ...walkSync(name)] : [...files, name];
}, []);

const files = walkSync('src/pages');
files.filter(f => f.endsWith('.jsx')).forEach(f => {
  let s = fs.readFileSync(f, 'utf8');
  s = s.replace(/<Link="/g, '<Link to="/');
  s = s.replace(/<Link='/g, "<Link to='/");
  fs.writeFileSync(f, s);
  console.log('Fixed', f);
});
