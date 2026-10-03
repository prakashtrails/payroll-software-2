import { supabase } from '@/lib/supabase';

// Reads CrewCore's mirror of the ESSL punch-machine feed (essl_employee_master
// / essl_daily_punches, kept in sync by the essl-web-poll edge function — see
// supabase/migrations/20260928_5_essl_full_mirror_and_code_sync.sql). The
// feed itself is plain http on Raniwala's network, so the browser never calls
// it directly; everything here is a normal RLS-scoped table read.

const PROFILE_COLS = 'id, first_name, middle_name, last_name, employee_id, essl_employee_code, department, designation, status, outlet_location';

/** Every ESSL code the machine knows, joined to the CrewCore employee it maps to (if any). */
export async function listEsslCodes(tenantId) {
  const [master, summary, profiles] = await Promise.all([
    supabase.from('essl_employee_master').select('essl_employee_code, name, department, location, shift, left_on').eq('tenant_id', tenantId),
    supabase.from('essl_code_summary').select('essl_employee_code, days_punched, first_date, last_date, days_this_month').eq('tenant_id', tenantId),
    supabase.from('profiles').select(PROFILE_COLS).eq('tenant_id', tenantId).not('essl_employee_code', 'is', null),
  ]);
  const error = master.error || summary.error || profiles.error;
  if (error) return { data: [], error };

  const byCode = new Map();
  const row = (code) => {
    if (!byCode.has(code)) byCode.set(code, { code, machine: null, stats: null, profile: null });
    return byCode.get(code);
  };
  for (const m of master.data || []) row(m.essl_employee_code).machine = m;
  for (const s of summary.data || []) row(s.essl_employee_code).stats = s;
  for (const p of profiles.data || []) row(p.essl_employee_code).profile = p;

  const data = [...byCode.values()].sort((a, b) => {
    const na = Number(a.code), nb = Number(b.code);
    return Number.isFinite(na) && Number.isFinite(nb) ? na - nb : a.code.localeCompare(b.code);
  });
  return { data, error: null };
}

/** One code's machine days, newest first, plus the CrewCore attendance on those days when mapped. */
export async function getEsslCodeDays(tenantId, code, profileId = null, { from = null, to = null } = {}) {
  let q = supabase
    .from('essl_daily_punches')
    .select('date, first_in, last_out, punch_count')
    .eq('tenant_id', tenantId)
    .eq('essl_employee_code', code)
    .order('date', { ascending: false });
  if (from) q = q.gte('date', from);
  if (to) q = q.lte('date', to);
  const { data: days, error } = await q;
  if (error || !profileId || !days?.length) return { data: (days || []).map((d) => ({ ...d, crewcore: null })), error };

  const { data: att, error: attErr } = await supabase
    .from('attendance')
    .select('date, status, total_hours, location')
    .eq('profile_id', profileId)
    .gte('date', days[days.length - 1].date)
    .lte('date', days[0].date);
  const attByDate = new Map((att || []).map((a) => [a.date, a]));
  return { data: days.map((d) => ({ ...d, crewcore: attByDate.get(d.date) || null })), error: attErr };
}

/**
 * Add/Edit Employee lookup: what the punch machine has for this code, and
 * whether another CrewCore employee already holds it.
 */
export async function lookupEsslCode(tenantId, code) {
  const c = String(code || '').trim().toUpperCase();
  if (!c) return { data: null, error: null };
  const [master, summary, recent, holder] = await Promise.all([
    supabase.from('essl_employee_master').select('essl_employee_code, name, department, location, shift, left_on, first_seen_at').eq('tenant_id', tenantId).eq('essl_employee_code', c).maybeSingle(),
    supabase.from('essl_code_summary').select('days_punched, first_date, last_date, days_this_month').eq('tenant_id', tenantId).eq('essl_employee_code', c).maybeSingle(),
    supabase.from('essl_daily_punches').select('date, first_in, last_out, punch_count').eq('tenant_id', tenantId).eq('essl_employee_code', c).order('date', { ascending: false }).limit(10),
    supabase.from('profiles').select(PROFILE_COLS).eq('tenant_id', tenantId).eq('essl_employee_code', c).maybeSingle(),
  ]);
  const error = master.error || summary.error || recent.error || holder.error;
  if (!master.data && !summary.data) return { data: null, error };

  // For a code that already belongs to an employee, show what CrewCore
  // recorded on those same days next to the machine's times.
  let recentDays = (recent.data || []).map((d) => ({ ...d, crewcore: null }));
  if (holder.data && recentDays.length) {
    const { data: att } = await supabase
      .from('attendance').select('date, status, total_hours')
      .eq('profile_id', holder.data.id)
      .gte('date', recentDays[recentDays.length - 1].date).lte('date', recentDays[0].date);
    const byDate = new Map((att || []).map((a) => [a.date, a]));
    recentDays = recentDays.map((d) => ({ ...d, crewcore: byDate.get(d.date) || null }));
  }
  return {
    data: { code: c, machine: master.data, stats: summary.data, lastDay: recentDays[0] || null, recentDays, holder: holder.data },
    error,
  };
}

/**
 * Asks the punch machine feed right now (essl-code-lookup edge function) and
 * stores what it returns, so a person enrolled since the last 2-minute poll
 * shows up immediately. Returns { live, found } — live=false for tenants
 * with no live feed. Callers re-read with lookupEsslCode() afterwards.
 */
export async function refreshEsslFromMachine(code) {
  const { data, error } = await supabase.functions.invoke('essl-code-lookup', { body: { code } });
  return { data: data || null, error };
}

/** Link (or move) an ESSL code to an employee. The DB trigger applies that code's punches in the same save. */
export async function linkEsslCode(profileId, code) {
  const { error } = await supabase
    .from('profiles')
    .update({ essl_employee_code: String(code).trim().toUpperCase() })
    .eq('id', profileId);
  return { error };
}

/** "AKASH BAIRWA" -> { first_name: 'AKASH', last_name: 'BAIRWA' } for prefilling Add Employee. */
export function splitMachineName(name) {
  const parts = String(name || '').trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first_name: '', middle_name: '', last_name: '' };
  if (parts.length === 1) return { first_name: parts[0], middle_name: '', last_name: '' };
  return { first_name: parts[0], middle_name: parts.slice(1, -1).join(' '), last_name: parts[parts.length - 1] };
}
