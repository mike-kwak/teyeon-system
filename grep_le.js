const fs = require('fs');
const content = fs.readFileSync('app/kdk/page.tsx', 'utf8');
const lines = content.split('\n');
lines.forEach((line, index) => {
    if (line.includes('le={{')) {
        console.log(`FOUND at line ${index + 1}: [${line.trim()}]`);
    }
});
if (!content.includes('le={{')) {
    console.log('No corrupted "le={{" found.');
}
