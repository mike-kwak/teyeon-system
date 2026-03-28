import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// 1. Load Env
const envPath = path.resolve('.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const getEnvValue = (key) => {
  const match = envContent.match(new RegExp(`${key}=(.*)`));
  return match ? match[1]?.trim() : null;
};

const supabaseUrl = getEnvValue('NEXT_PUBLIC_SUPABASE_URL');
const supabaseAnonKey = getEnvValue('NEXT_PUBLIC_SUPABASE_ANON_KEY');
const supabase = createClient(supabaseUrl, supabaseAnonKey);

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

async function diagnose() {
  console.log('🔍 Diagnostic investigation started (Handling EUC-KR)...');
  
  // Read CSV with EUC-KR decoding
  const csvBuffer = fs.readFileSync('테연 명단.csv');
  const decoder = new TextDecoder('euc-kr');
  const csvContent = decoder.decode(csvBuffer);
  
  const csvRows = robustParseCSV(csvContent);
  console.log(`CSV Rows: ${csvRows.length}`);
  if (csvRows.length > 0) {
    console.log('Headers:', csvRows[0].join(', '));
  }

  // Fetch DB
  const { data: dbMembers, error } = await supabase.from('members').select('*');
  if (error) throw error;

  console.log(`DB Members: ${dbMembers.length}`);

  // Find 곽민섭 in CSV
  const kwak = csvRows.find(r => r.some(c => c.includes('곽민섭')));
  if (kwak) {
    console.log('Found 곽민섭 in CSV:', JSON.stringify(kwak, null, 2));
  } else {
    console.log('곽민섭 not found in CSV.');
    // List first 5 names for debugging
    csvRows.slice(1, 6).forEach(r => console.log('CSV Name Sample:', r[1]));
  }

  // Generate mapping and diff
  const diffs = [];
  for (let i = 1; i < csvRows.length; i++) {
    const row = csvRows[i];
    const name = row[1];
    if (!name) continue;

    const db = dbMembers.find(m => m.nickname === name);
    if (!db) {
       diffs.push({ name, issue: 'Not in DB' });
       continue;
    }

    // Awards check
    const csvSum = row[7] || '';
    const csvDet = row[8] || '';
    const combinedCsv = [csvSum, csvDet].filter(s => s.trim()).join(' | ');

    if (db.achievements !== combinedCsv) {
       diffs.push({ name, issue: 'Awards Mismatch', csv: combinedCsv, db: db.achievements });
    }
  }

  console.log('\n--- DIAGNOSTIC DIFF ---');
  diffs.forEach(d => {
    console.log(`[${d.name}] ${d.issue}`);
    if (d.csv) {
      console.log(`  Expected (CSV): ${d.csv}`);
      console.log(`  Actual (DB):   ${d.db}`);
    }
  });
}

diagnose().catch(console.error);
