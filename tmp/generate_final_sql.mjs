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

  console.log('-- 100% Corrective SQL Script based ONLY on CSV Data');
  
  for (let i = 1; i < csvRows.length; i++) {
    const row = csvRows[i];
    const name = row[1];
    if (!name) continue;

    // Mapping from CSV:
    // No., 이름, 자격, 연락처, 나이, MBTI, 아산 클럽 소속, 입상경력, 입상 내역, 비고
    const roleInCsv = row[2] || '';
    const phone = row[3] || '';
    const age = row[4] || '';
    const mbti = row[5] || '';
    const affiliation = row[6] || '';
    const summary = row[7] || '';
    const detailedRow = row[8] || '';
    const member_number = row[0] || '';
    
    const achievements = [summary, detailedRow].filter(s => s.trim()).join(' | ').replace(/'/g, "''");

    let role = roleInCsv;
    let position = '';
    
    // CEO Dual Role as previously requested
    if (name === '곽민섭') {
      role = 'CEO';
      position = '재무';
    }

    let sql = `UPDATE members SET role = '${role}', position = '${position}', phone = '${phone}', mbti = '${mbti}', affiliation = '${affiliation}', achievements = '${achievements}', member_number = '${member_number}' WHERE nickname = '${name}';`;
    console.log(sql);
  }
}

generateSQL().catch(console.error);
