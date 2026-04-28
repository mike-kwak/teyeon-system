const fs = require('fs');
const content = fs.readFileSync('app/kdk/page.tsx', 'utf8');

let braces = 0;
let lines = content.split('\n');
for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    for (let char of line) {
        if (char === '{') braces++;
        if (char === '}') braces--;
    }
    if (braces < 0) {
        console.log(`Unbalanced at line ${i + 1}: ${line}`);
        process.exit(1);
    }
}
console.log(`Total balance: ${braces}`);
