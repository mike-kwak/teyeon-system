import fs from 'fs';

function robustParseCSV(content) {
  const lines = content.split('\n').map(l => l.trim()).filter(l => l);
  const rows = [];
  for (let line of lines) {
    const columns = [];
    let cur = '';
    let inQuotes = false;
    for (let char of line) {
      if (char === '"') inQuotes = !inQuotes;
      else if (char === ',' && !inQuotes) {
        columns.push(cur.trim());
        cur = '';
      } else cur += char;
    }
    columns.push(cur.trim());
    rows.push(columns);
  }
  return rows;
}

async function generateSQL() {
  const csvBuffer = fs.readFileSync('테연 명단.csv');
  const decoder = new TextDecoder('euc-kr');
  const csvContent = decoder.decode(csvBuffer);
  const csvRows = robustParseCSV(csvContent);

  console.log('-- Corrective SQL Script for "members" table');
  
  for (let i = 1; i < csvRows.length; i++) {
    const row = csvRows[i];
    const name = row[1];
    if (!name) continue;

    const role = row[2] || '';
    const phone = row[3] || '';
    const mbti = row[5] || '';
    const affiliation = row[6] || '';
    const summary = row[7] || '';
    const detailed = row[8] || '';
    const achievements = [summary, detailed].filter(s => s.trim()).join(' | ').replace(/'/g, "''");

    let sql = `UPDATE members SET phone = '${phone}', mbti = '${mbti}', affiliation = '${affiliation}', achievements = '${achievements}'`;
    
    if (name === '곽민섭') {
      // User requested CEO and Finance for Kwak Min-seob
      sql += `, role = 'CEO', position = '재무'`;
    } else {
      sql += `, role = '${role}'`;
    }

    sql += ` WHERE nickname = '${name}';`;
    console.log(sql);
  }
}

generateSQL().catch(console.error);
