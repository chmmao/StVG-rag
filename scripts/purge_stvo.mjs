import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function purge() {
  console.log("Purging all stvo.xml entries...");
  const { data, error } = await supabase
    .from('documents')
    .delete()
    .contains('metadata', { source: 'stvo.xml' });
    
  if (error) {
    console.error("Purge Error:", error);
  } else {
    console.log("Successfully purged stvo.xml segments.");
  }
}

purge();
