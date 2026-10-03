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
    .from('profile_directory')
    .select('id, first_name, middle_name, last_name')
    .eq('id', profileId)
    .maybeSingle();
  return { data, error };
}

// Upcoming birthdays + work anniversaries come from the list_upcoming_celebrations()
// RPC (20260923_2_upcoming_celebrations_rpc.sql): RLS only lets an employee read their
// own profile row, so the RPC returns just the display fields, scoped to the caller's
// outlet for employees and the whole tenant for admin/manager.
const mapCelebration = (r) => ({
  profile: {
    id: r.profile_id, first_name: r.first_name, middle_name: r.middle_name, last_name: r.last_name,
    division: r.division, outlet_location: r.outlet_location,
  },
  date: r.event_date,
  diffDays: r.days_away,
  years: r.years,
});

async function listUpcomingCelebrations(kind, days) {
  const { data, error } = await supabase.rpc('list_upcoming_celebrations', { p_days: days });
  if (error) return { data: [], error };
  return { data: (data || []).filter((r) => r.kind === kind).map(mapCelebration), error: null };
}

/**
 * Birthdays and work anniversaries in the next `days` days (0 = today) from a
 * single RPC call, for Raniwala's combined "Birthdays & Anniversaries" Home
 * card. The RPC decides who sees what (Raniwala: HR everyone, managers/HODs
 * their team today only, everyone else nothing).
 */
export async function listCelebrations(days = 0) {
  const { data, error } = await supabase.rpc('list_upcoming_celebrations', { p_days: days });
  if (error) return { data: { birthdays: [], anniversaries: [] }, error };
  const rows = data || [];
  return {
    data: {
      birthdays: rows.filter((r) => r.kind === 'birthday').map(mapCelebration),
      anniversaries: rows.filter((r) => r.kind === 'anniversary').map(mapCelebration),
    },
    error: null,
  };
}

/** Employees with a birthday in the next `days` days (default 30), for the Home dashboard. */
export async function listUpcomingBirthdays(days = 30) {
  const { data, error } = await listUpcomingCelebrations('birthday', days);
  return { data: data.map(({ years, ...r }) => ({ ...r, date_of_birth: r.date })), error };
}

/** Employees with a work anniversary (based on profiles.join_date) in the next `days` days (default 30), for the Home dashboard. */
export async function listUpcomingAnniversaries(days = 30) {
  const { data, error } = await listUpcomingCelebrations('anniversary', days);
  return { data: data.map((r) => ({ ...r, join_date: r.date })), error };
}
