const fs = require('fs');
const path = 'app/kdk/page.tsx';
let content = fs.readFileSync(path, 'utf8');

// 1. Redesign NOW PLAYING Section (Forced Horizontal Flex-Row)
const oldActiveMatchMap = /\{activeMatchIds\.map\(\(mId\) => \{[\s\S]*?return \([\s\S]*?<div key=\{mId\}[\s\S]*?<\/div>[\s\S]*?\);[\s\S]*?\}\)\}/;
const newActiveMatchMap = `{activeMatchIds.map((mId) => {
                                        const m = matches.find(x => x.id === mId);
                                        if (!m) return null;
                                        const p0 = m.playerIds[0];
                                        const p0Group = attendeeConfigs[p0]?.group || allMembers.find(x => x.id === p0)?.position || 'A';
                                        const normalizedGroup = (p0Group || 'A').toUpperCase().includes('B') ? 'B' : 'A';
                                        
                                        return (
                                            <div key={mId} style={{ backgroundColor: '#1e1e2e', borderRadius: '32px', padding: '20px', marginBottom: '16px', border: '1px solid rgba(255,255,255,0.05)', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)', position: 'relative' }}>
                                                <div className="flex flex-col gap-4">
                                                    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: '8px', width: '100%' }}>
                                                        {/* TEAM 1 BLOCK */}
                                                        <div style={{ flex: 1, minWidth: 0, backgroundColor: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(10px)', borderRadius: '24px', padding: '24px 8px', position: 'relative', border: '1px solid rgba(255,255,255,0.1)', textAlign: 'center' }}>
                                                            <div style={{ position: 'absolute', top: '15px', left: '12px', backgroundColor: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '999px', padding: '2px 8px', fontSize: '8px', fontWeight: '900', color: 'white' }}>
                                                                {normalizedGroup}조
                                                            </div>
                                                            <span style={{ fontSize: '18px', fontWeight: '900', color: 'white', letterSpacing: '-0.03em', lineHeight: '1.2', display: 'block' }}>
                                                                {getPlayerName(m.playerIds[0])}<br/>{getPlayerName(m.playerIds[1])}
                                                            </span>
                                                        </div>

                                                        {/* VS */}
                                                        <div style={{ fontSize: '10px', fontWeight: '1000', color: 'rgba(255,255,255,0.08)', fontStyle: 'italic', flexShrink: 0, padding: '0 4px' }}>VS</div>

                                                        {/* TEAM 2 BLOCK */}
                                                        <div style={{ flex: 1, minWidth: 0, backgroundColor: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(10px)', borderRadius: '24px', padding: '24px 8px', position: 'relative', border: '1px solid rgba(255,255,255,0.1)', textAlign: 'center' }}>
                                                            <div style={{ position: 'absolute', top: '15px', right: '12px', backgroundColor: 'rgba(201,176,117,0.15)', border: '1px solid rgba(201,176,117,0.3)', borderRadius: '999px', padding: '2px 8px', fontSize: '8px', fontWeight: '900', color: '#C9B075' }}>
                                                                #{m.court}
                                                            </div>
                                                            <span style={{ fontSize: '18px', fontWeight: '900', color: 'white', letterSpacing: '-0.03em', lineHeight: '1.2', display: 'block' }}>
                                                                {getPlayerName(m.playerIds[2])}<br/>{getPlayerName(m.playerIds[3])}
                                                            </span>
                                                        </div>
                                                    </div>

                                                    {/* SCORE INPUT BUTTON */}
                                                    <button 
                                                        onClick={() => { if (window.navigator?.vibrate) window.navigator.vibrate(50); setTempScores({ s1: m.score1 ?? 1, s2: m.score2 ?? 1 }); setShowScoreModal(mId); }}
                                                        style={{ width: '100%', padding: '16px', backgroundColor: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                                                    >
                                                        <span style={{ fontSize: '11px', fontWeight: '900', color: 'rgba(255,255,255,0.1)', letterSpacing: '0.2em', textTransform: 'uppercase' }}>SCORE INPUT</span>
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}`;

content = content.replace(oldActiveMatchMap, newActiveMatchMap);

fs.writeFileSync(path, content, 'utf8');
console.log('Successfully enforced "Forced Horizontal Flex-Row" restoration in app/kdk/page.tsx.');
