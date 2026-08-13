import { supabase } from '@/lib/supabase';

export const EMPTY_PROFILE_DETAILS = {
  date_of_birth: '',
  gender: '',
  marital_status: '',
  blood_group: '',
  physically_handicapped: false,
  nationality: 'India',
  personal_email: '',
  work_number: '',
  residence_number: '',
  current_address: {},
  permanent_address: {},
  about_me: '',
  about_job: '',
  hobbies: '',
  emergency_contacts: [],
  education: [],
  experience: [],
};

/** The current user's own profile details — returns an empty-shape default on first visit. */
export async function getMyProfileDetails(profileId) {
  const { data, error } = await supabase
    .from('profile_details')
    .select('*')
    .eq('profile_id', profileId)
    .maybeSingle();
  if (error) return { data: null, error };
  return { data: data || { ...EMPTY_PROFILE_DETAILS, profile_id: profileId }, error: null };
}

export async function upsertProfileDetails(tenantId, profileId, payload) {
  const { data, error } = await supabase
    .from('profile_details')
    .upsert([{ tenant_id: tenantId, profile_id: profileId, ...payload }], { onConflict: 'profile_id' })
    .select()
    .single();
  return { data, error };
}

/** Minimal profile lookup — used to show a reporting manager's name on the Welcome page. */
export async function getProfileName(profileId) {
  if (!profileId) return { data: null, error: null };
  const { data, error } = await supabase
    .from('profiles')
    .select('id, first_name, middle_name, last_name')
    .eq('id', profileId)
    .maybeSingle();
  return { data, error };
}

/** Employees with a birthday in the next `days` days (default 30), for the Home dashboard. */
export async function listUpcomingBirthdays(tenantId, days = 30) {
  const { data, error } = await supabase
    .from('profile_details')
    .select('date_of_birth, profile:profiles!profile_details_profile_id_fkey(id, first_name, middle_name, last_name)')
    .eq('tenant_id', tenantId)
    .not('date_of_birth', 'is', null);
  if (error) return { data: [], error };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const msPerDay = 24 * 60 * 60 * 1000;

  const upcoming = (data || [])
    .map((row) => {
      const dob = new Date(row.date_of_birth + 'T00:00:00');
      let next = new Date(today.getFullYear(), dob.getMonth(), dob.getDate());
      if (next < today) next = new Date(today.getFullYear() + 1, dob.getMonth(), dob.getDate());
      const diffDays = Math.round((next - today) / msPerDay);
      return { ...row, nextOccurrence: next, diffDays };
    })
    .filter((row) => row.diffDays <= days)
    .sort((a, b) => a.nextOccurrence - b.nextOccurrence);

  return { data: upcoming, error: null };
}
