
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://wvhwpdgerjngmkhagxom.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2aHdwZGdlcmpuZ21raGFneG9tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNTIzODgsImV4cCI6MjA4OTkyODM4OH0.3F904LE0OM_HhFpqYFheJv34jcuiUD_hBohaz-RUUkc'
);

async function recover() {
  const { data, error } = await supabase
    .from('teyeon_archive_v1')
    .select('*')
    .ilike('id', 'SP-%')
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) {
    console.error(error);
    return;
  }

  data.forEach(m => {
    const raw = m.raw_data;
    console.log(`\nSession: ${raw.title}`);
    console.log(`Guests: ${JSON.stringify(raw.player_metadata, null, 2)}`);
  });
}

recover();
