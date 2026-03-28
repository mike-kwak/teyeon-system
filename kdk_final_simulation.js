const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Load .env.local manually
const envPath = path.resolve(__dirname, '.env.local');
const envVars = fs.readFileSync(envPath, 'utf8').split('\n').reduce((acc, line) => {
    const [key, val] = line.split('=');
    if (key && val) acc[key.trim()] = val.trim();
    return acc;
}, {});

const supabaseUrl = envVars.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = envVars.NEXT_PUBLIC_SUPABASE_ANON_KEY; 

const supabase = createClient(supabaseUrl, supabaseKey);

async function runSimulation() {
    console.log('--- FINAL REAL-WORLD SIMULATION (5 SESSIONS) ---');
    
    const names = ['황희찬', '손흥민', '이강인', '김민재', '조규성', '황인범', '설영우', '이재성', '조현우', '정우영'];
    const dummySessions = [
        { id: 'REAL-1', title: '3월 테연 평일 야간 정기전', date: '2026-03-05' },
        { id: 'REAL-2', title: '테연 v2 시스템 실전 도입 테스트', date: '2026-03-12' },
        { id: 'REAL-3', title: 'CEO배 스페셜 하이레벨 토너먼트', date: '2026-03-19' },
        { id: 'REAL-4', title: '테연 vs 고대 클럽 친선 교류전', date: '2026-03-23' },
        { id: 'REAL-5', title: '3월 마지막 피날레 정기 대진표', date: '2026-03-27' },
    ];

    const records = [];
    for (const sess of dummySessions) {
        for (let r = 1; r <= 3; r++) { // 3 matches per session
            const p = [...names].sort(() => 0.5 - Math.random());
            records.push({
                id: `final-sim-${sess.id}-${r}-${Math.random().toString(36).substr(2, 4)}`,
                session_id: sess.id,
                session_title: sess.title,
                match_date: sess.date,
                player_names: [p[0], p[1], p[2], p[3]],
                score1: Math.floor(Math.random() * 7),
                score2: Math.floor(Math.random() * 7),
                created_at: new Date(sess.date).toISOString()
            });
        }
    }

    const { error } = await supabase.from('matches_archive').upsert(records);
    
    if (error) {
        console.error('❌ Simulation Error:', error);
    } else {
        console.log('✅ Successfully simulated 5 Real-World Sessions.');
    }
}

runSimulation();
