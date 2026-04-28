
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://wvhwpdgerjngmkhagxom.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2aHdwZGdlcmpuZ21raGFneG9tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNTIzODgsImV4cCI6MjA4OTkyODM4OH0.3F904LE0OM_HhFpqYFheJv34jcuiUD_hBohaz-RUUkc'
);

const guests = ["이슬(G)", "호영(G)", "진희(G)", "흥기(G)", "은지(G)"];
const clubId = "512d047d-a076-4080-97e5-6bb5a2c07819";

async function createGuestsAndRescue() {
    console.log("Creating permanent guest records...");
    
    const guestMap = {};
    for (const name of guests) {
        // Check if already exists to avoid dupes
        const { data: existing } = await supabase.from('members').select('id').eq('nickname', name).maybeSingle();
        if (existing) {
            guestMap[name] = existing.id;
        } else {
            const { data: created, error } = await supabase.from('members').insert([{
                nickname: name,
                is_guest: true,
                club_id: clubId
            }]).select('id').single();
            if (error) console.error(`Error creating ${name}:`, error);
            else guestMap[name] = created.id;
        }
    }

    console.log("Updated Guest Map:", guestMap);

    const memberMap = {
        "인우": "ec786768-90cb-41e1-9019-017842af9ccb",
        "병식": "38f05c6c-0410-4abe-bbf4-0cd18a89f5d6",
        "재형": "f0967987-c117-4acb-90ae-2291b1165569",
        "정호": "1317fe26-b92a-4c15-89a3-fb2e9df8d9db",
        "동석": "0159df6d-7c53-4aaa-86e5-7269ea096c4f",
        "형원": "233f4e41-8659-4253-858d-204d89eda601",
        "헌섭": "dd8b0752-4338-4b5d-8c3a-179412716155",
        "내현": "55782358-bff3-48e2-8fc7-41fcb3dcd646",
        "민섭": "23704379-e26a-4394-8727-d92b547db2af",
        "민준": "072fe950-a420-495a-b700-92c93f00d26f",
        "봉준": "b15208b7-8898-4135-a975-5844ef3811ba",
        "상윤": "d6dce426-3c84-4c3c-8e7f-c5ae1f4e7597",
        "영호": "21b0f073-551a-4d66-bbf6-a9620d930348",
        "광현": "d0ff3119-fc51-4d03-84ba-731191f794ed",
        "현민": "4dbfea34-94a3-481d-b990-c2ea9ccab1b3",
        "영우": "1b529547-8efc-44ee-a9c7-a10c11287de8",
        "효철": "0efdeb9e-4f67-4a7e-a7e8-4e380e81fb0a",
        "석": "93758045-f5a9-4406-9569-73fb63d69fda",
        ...guestMap
    };

    const groupA = [
        ["인우", "병식", "재형", "이슬(G)"], ["호영(G)", "정호", "동석", "형원"], ["헌섭", "내현", "민섭", "민준"],
        ["인우", "재형", "호영(G)", "동석"], ["병식", "이슬(G)", "헌섭", "민섭"], ["정호", "형원", "내현", "민준"],
        ["재형", "호영(G)", "정호", "내현"], ["인우", "헌섭", "병식", "민섭"], ["이슬(G)", "동석", "형원", "민준"],
        ["병식", "헌섭", "호영(G)", "내현"], ["인우", "민섭", "정호", "민준"], ["재형", "동석", "이슬(G)", "형원"]
    ];

    const groupB = [
        ["봉준", "상윤", "영호", "광현"], ["현민", "영우", "진희(G)", "효철"], ["현민", "흥기(G)", "석", "은지(G)"],
        ["영호", "진희(G)", "광현", "효철"], ["봉준", "광현", "효철", "석"], ["상윤", "영우", "흥기(G)", "은지(G)"],
        ["봉준", "영호", "현민", "은지(G)"], ["상윤", "석", "영우", "진희(G)"], ["봉준", "효철", "상윤", "흥기(G)"],
        ["영호", "은지(G)", "진희(G)", "석"], ["광현", "현민", "영우", "흥기(G)"]
    ];

    const sessionId = `SP-RESCUE-260428`;
    const sessionTitle = "260428_SPECIAL_RESCUE";

    // Delete old rescue matches to clean up
    await supabase.from('matches').delete().eq('session_id', sessionId);

    const dbMatches = [];
    [...groupA, ...groupB].forEach((names, idx) => {
        const pIds = names.map(n => memberMap[n]);
        dbMatches.push({
            session_id: sessionId, session_title: sessionTitle, club_id: clubId,
            round: idx + 1, player_ids: pIds, player_names: names, mode: 'SPECIAL', status: 'waiting'
        });
    });

    console.log("Inserting matches with real guest records...");
    const { error } = await supabase.from('matches').insert(dbMatches);
    
    if (error) console.error("Rescue Error:", error);
    else console.log("Final Rescue Complete! Session ID: SP-RESCUE-260428");
}

createGuestsAndRescue();
