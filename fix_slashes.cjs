const fs = require('fs');
const path = require('path');
const walkSync = (dir) => fs.readdirSync(dir).reduce((files, file) => {
  const name = path.join(dir, file);
  return fs.statSync(name).isDirectory() ? [...files, ...walkSync(name)] : [...files, name];
}, []);

walkSync('src/pages').filter(f => f.endsWith('.jsx')).forEach(f => {
  let s = fs.readFileSync(f, 'utf8');
  if (s.includes('to="//')) {
    s = s.replace(/to="\/\//g, 'to="/');
    fs.writeFileSync(f, s);
    console.log('Fixed double slash in', f);
  }
});
