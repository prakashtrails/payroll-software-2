import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://yxueywgrqrfgynqknsqs.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl4dWV5d2dycXJmZ3lucWtuc3FzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Njg3MzIxMSwiZXhwIjoyMDkyNDQ5MjExfQ.UHzcEiKK70HTu-w4mOBgiWGowilKdWqMsJGtknXlaTc';
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data: users, error: err1 } = await supabase.auth.admin.listUsers();
  console.log('--- auth.users ---');
  if (err1) console.error(err1);
  else console.log(users.users.map(u => ({ id: u.id, email: u.email })));

  const { data: profiles, error: err2 } = await supabase.from('profiles').select('*');
  console.log('\n--- profiles ---');
  if (err2) console.error(err2);
  else console.log(profiles);

  const { data: tenants, error: err3 } = await supabase.from('tenants').select('*');
  console.log('\n--- tenants ---');
  if (err3) console.error(err3);
  else console.log(tenants);
}

check();
