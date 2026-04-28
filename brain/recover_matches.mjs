
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://wvhwpdgerjngmkhagxom.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2aHdwZGdlcmpuZ21raGFneG9tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNTIzODgsImV4cCI6MjA4OTkyODM4OH0.3F904LE0OM_HhFpqYFheJv34jcuiUD_hBohaz-RUUkc'
);

async function recover() {
  const { data, error } = await supabase
    .from('teyeon_archive_v1')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error("Error:", error);
    return;
  }

  data.forEach(m => {
    const raw = m.raw_data;
    if (raw && raw.snapshot_data && raw.snapshot_data.length > 10) {
        console.log(`[${m.created_at}] ID: ${m.id} - Title: ${raw.title} - Match Count: ${raw.snapshot_data.length}`);
    }
  });
}

recover();
