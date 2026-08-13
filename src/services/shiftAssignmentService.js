import { supabase } from '@/lib/supabase';
import { dateStr } from '@/lib/helpers';

/** Shift assignments in a date range (roster month-view). */
export async function fetchShiftAssignments(tenantId, startDate, endDate) {
  const { data, error } = await supabase
    .from('shift_assignments')
    .select('*, shift:shifts(name, start_time, end_time), profile:profiles!shift_assignments_profile_id_fkey(first_name, middle_name, last_name)')
    .eq('tenant_id', tenantId)
    .gte('date', startDate)
    .lte('date', endDate);
  return { data: data || [], error };
}

/**
 * Bulk-assign a shift to a set of employees across a date range, restricted
 * to the given weekdays (0=Sun…6=Sat, empty = every day). Upserts so
 * re-running the same range just overwrites the shift for those days.
 */
export async function bulkAssignShift(tenantId, createdBy, { profileIds, shiftId, startDate, endDate, weekdays = [] }) {
  const rows = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    if (weekdays.length && !weekdays.includes(d.getDay())) continue;
    const dateISO = dateStr(d);
    profileIds.forEach((profileId) => {
      rows.push({ tenant_id: tenantId, profile_id: profileId, shift_id: shiftId, date: dateISO, created_by: createdBy });
    });
  }
  if (!rows.length) return { error: null, count: 0 };

  const { error } = await supabase.from('shift_assignments').upsert(rows, { onConflict: 'profile_id,date' });
  return { error, count: rows.length };
}

export async function deleteShiftAssignment(id) {
  const { error } = await supabase.from('shift_assignments').delete().eq('id', id);
  return { error };
}
