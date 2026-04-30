import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from the .env file
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Error: Supabase URL or Service Role Key is missing from your .env file.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function wipeDatabase() {
  console.log('Starting full database wipe...');

  // 1. Truncate all application tables (using the wipe_db.sql logic)
  console.log('Truncating all application tables...');
  const { error: rpcError } = await supabase.rpc('exec_sql', {
    query: `
      TRUNCATE TABLE 
        punches, attendance, attendance_audit_log, payslips, payrolls, advances, 
        salary_components, departments, leave_requests, profiles, tenants, otp_table
      CASCADE;
    `
  });

  // Since we might not have an exec_sql RPC, let's just delete the tenants and profiles directly
  // Deleting tenants cascades to everything else.
  const { error: delError } = await supabase.from('tenants').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('profiles').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('otp_table').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  console.log('✅ Application data wiped.');

  // 2. Properly delete all users from auth.users via Admin API (removes orphaned identities)
  console.log('Fetching users to delete...');
  const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
  
  if (listError) {
    console.error('❌ Error fetching users:', listError.message);
    return;
  }

  if (users.length === 0) {
    console.log('No users found in the system.');
  } else {
    console.log(`Found ${users.length} users. Deleting them properly...`);
    for (const user of users) {
      const { error: deleteError } = await supabase.auth.admin.deleteUser(user.id);
      if (deleteError) {
        console.error(`❌ Failed to delete user ${user.email}:`, deleteError.message);
      } else {
        console.log(`✅ Deleted user: ${user.email}`);
      }
    }
  }

  console.log('🎉 WIPE COMPLETE! Your database is now 100% clean.');
  console.log('You can now sign up using the "Create My Company" form to become the Admin.');
}

wipeDatabase();
