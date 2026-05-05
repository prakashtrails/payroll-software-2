import { supabase } from '@/lib/supabase';
import { todayStr, timeStr, diffHours } from '@/lib/helpers';

/** Full month attendance (with punches) for one employee — used in calendar views. */
export async function fetchMyMonthAttendance(profileId, year, month) {
  const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const endDay    = new Date(year, month + 1, 0).getDate();
  const endDate   = `${year}-${String(month + 1).padStart(2, '0')}-${endDay}`;

  const { data, error } = await supabase
    .from('attendance')
    .select('*, punches(*)')
    .eq('profile_id', profileId)
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date');
  return { data: data || [], error };
}

/** Clock in for today. Creates or reuses the attendance row, then inserts a punch-in. */
export async function clockIn(tenantId, profileId, tenant, locationData = null) {
  const today = todayStr();

  // Reuse existing row if present
  const { data: existing, error: fetchErr } = await supabase
    .from('attendance')
    .select('id')
    .eq('profile_id', profileId)
    .eq('date', today)
    .maybeSingle();
  if (fetchErr) throw fetchErr;

  let attId;
  if (existing) {
    attId = existing.id;
  } else {
    // Custom shift logic
    const { data: profile } = await supabase.from('profiles').select('shift_id').eq('id', profileId).single();
    let shiftStart = tenant?.shift_start || '09:00';
    if (profile?.shift_id) {
      const { data: shift } = await supabase.from('shifts').select('start_time').eq('id', profile.shift_id).single();
      if (shift) shiftStart = shift.start_time;
    }

    const lateMin     = tenant?.late_threshold || 15;
    const [sh, sm]    = shiftStart.split(':').map(Number);
    const now         = new Date();
    const diffMin     = (now.getHours() * 60 + now.getMinutes()) - (sh * 60 + sm);
    const status      = diffMin > lateMin ? 'Late' : 'Present';

    const { data: newAtt, error: insErr } = await supabase
      .from('attendance')
      .insert([{ 
        tenant_id: tenantId, 
        profile_id: profileId, 
        date: today, 
        status, 
        location: 'Office',
        punch_in_lat: locationData?.lat,
        punch_in_lng: locationData?.lng
      }])
      .select()
      .single();
    if (insErr) throw insErr;
    attId = newAtt.id;
  }

  const { error: punchErr } = await supabase
    .from('punches')
    .insert([{ attendance_id: attId, punch_time: timeStr(new Date()), punch_type: 'in' }]);
  if (punchErr) throw punchErr;
}

/** Clock out for today. Inserts punch-out and recalculates total_hours + status. */
export async function clockOut(profileId, locationData = null) {
  const today = todayStr();

  const { data: att, error: fetchErr } = await supabase
    .from('attendance')
    .select('id, tenant_id')
    .eq('profile_id', profileId)
    .eq('date', today)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!att) throw new Error('No clock-in found for today. Please clock in first.');

  const punchOutTime = timeStr(new Date());
  const { error: punchErr } = await supabase
    .from('punches')
    .insert([{ attendance_id: att.id, punch_time: punchOutTime, punch_type: 'out' }]);
  if (punchErr) throw punchErr;

  const { data: allPunches, error: allErr } = await supabase
    .from('punches')
    .select('*')
    .eq('attendance_id', att.id)
    .order('punch_time');
  if (allErr) throw allErr;

  const ins  = allPunches.filter((p) => p.punch_type === 'in');
  const outs = allPunches.filter((p) => p.punch_type === 'out');
  let total  = 0;
  for (let i = 0; i < ins.length; i++) {
    if (outs[i]) total += diffHours(ins[i].punch_time, outs[i].punch_time);
  }

  // Get tenant thresholds
  const { data: tenant } = await supabase.from('tenants').select('min_half_day_hours, min_full_day_hours').eq('id', att.tenant_id).single();
  const halfMin = tenant?.min_half_day_hours || 4;
  const fullMin = tenant?.min_full_day_hours || 8;

  let status = 'Absent';
  if (total >= fullMin) {
    status = 'Present';
  } else if (total >= halfMin) {
    status = 'Half Day';
  }

  await supabase
    .from('attendance')
    .update({ 
      total_hours: Math.round(total * 100) / 100, 
      status,
      punch_out_lat: locationData?.lat,
      punch_out_lng: locationData?.lng
    })
    .eq('id', att.id);

  return { total };
}

/** Team attendance snapshot for a specific date (admin view). */
export async function fetchTeamAttendance(tenantId, date) {
  const [empsRes, deptsRes, attRes] = await Promise.all([
    supabase.from('profiles').select('*').eq('tenant_id', tenantId).eq('status', 'Active'),
    supabase.from('departments').select('name').eq('tenant_id', tenantId),
    supabase.from('attendance').select('*, punches(*)').eq('tenant_id', tenantId).eq('date', date),
  ]);

  return {
    employees:   empsRes.data   || [],
    departments: (deptsRes.data || []).map((d) => d.name),
    records:     attRes.data    || [],
    error:       empsRes.error || deptsRes.error || attRes.error,
  };
}

export async function fetchTodayAttendanceSummary(tenantId, date) {
  const [profilesRes, attendanceRes] = await Promise.all([
    supabase.from('profiles').select('id').eq('tenant_id', tenantId).eq('status', 'Active'),
    supabase.from('attendance').select('profile_id, status').eq('tenant_id', tenantId).eq('date', date),
  ]);

  const error = profilesRes.error || attendanceRes.error;
  const statusMap = {};
  (attendanceRes.data || []).forEach((row) => {
    statusMap[row.profile_id] = row.status;
  });

  const summary = { total: 0, present: 0, absent: 0, late: 0, halfDay: 0, leave: 0 };
  summary.total = (profilesRes.data || []).length;

  (profilesRes.data || []).forEach((profile) => {
    const status = statusMap[profile.id];
    if (status === 'Present') summary.present += 1;
    else if (status === 'Late') { summary.present += 1; summary.late += 1; }
    else if (status === 'Half Day') summary.halfDay += 1;
    else if (status === 'Leave') summary.leave += 1;
  });

  summary.absent = summary.total - summary.present - summary.halfDay - summary.leave;
  if (summary.absent < 0) summary.absent = 0;
  return { ...summary, error };
}

/** Upsert a manual attendance entry (admin override) with audit logging. */
export async function saveManualAttendance(tenantId, { profile_id, date, clockIn: ci, clockOut: co, status, reason }, changedBy) {
  const hours = (ci && co) ? Math.round(diffHours(ci, co) * 100) / 100 : 0;

  // Fetch existing record to capture old values for audit
  const { data: existing, error: fetchErr } = await supabase
    .from('attendance')
    .select('id, status, total_hours')
    .eq('profile_id', profile_id)
    .eq('date', date)
    .maybeSingle();
  if (fetchErr) throw fetchErr;

  let attId;
  let action = 'create';
  let oldStatus = null;
  let oldHours = null;

  if (existing) {
    action = 'update';
    oldStatus = existing.status;
    oldHours = existing.total_hours;
    await supabase.from('attendance')
      .update({ status, total_hours: hours, location: 'Office (Manual)' })
      .eq('id', existing.id);
    await supabase.from('punches').delete().eq('attendance_id', existing.id);
    attId = existing.id;
  } else {
    const { data: newAtt, error: insErr } = await supabase
      .from('attendance')
      .insert([{ tenant_id: tenantId, profile_id, date, status, total_hours: hours, location: 'Office (Manual)' }])
      .select()
      .single();
    if (insErr) throw insErr;
    attId = newAtt.id;
  }

  const punches = [];
  if (ci) punches.push({ attendance_id: attId, punch_time: ci, punch_type: 'in' });
  if (co) punches.push({ attendance_id: attId, punch_time: co, punch_type: 'out' });
  if (punches.length) {
    const { error: punchErr } = await supabase.from('punches').insert(punches);
    if (punchErr) throw punchErr;
  }

  // Write audit log entry
  if (changedBy) {
    await supabase.from('attendance_audit_log').insert([{
      tenant_id: tenantId,
      attendance_id: attId,
      profile_id: profile_id,
      changed_by: changedBy,
      date,
      action,
      old_status: oldStatus,
      new_status: status,
      old_hours: oldHours,
      new_hours: hours,
      reason: reason || '',
    }]);
  }
}

/** Attendance stats for the current month — for the employee self-service dashboard. */
export async function fetchMyMonthStats(profileId, year, month) {
  const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const endDay    = new Date(year, month + 1, 0).getDate();
  const endDate   = `${year}-${String(month + 1).padStart(2, '0')}-${endDay}`;

  const { data, error } = await supabase
    .from('attendance')
    .select('status')
    .eq('profile_id', profileId)
    .gte('date', startDate)
    .lte('date', endDate);

  const presentDays = (data || []).filter((r) => r.status === 'Present' || r.status === 'Late').length;
  return { presentDays, error };
}

/** Fetch all attendance records for a tenant for a given month/year. */
export async function fetchAllTenantAttendance(tenantId, year, month) {
  const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const endDay    = new Date(year, month + 1, 0).getDate();
  const endDate   = `${year}-${String(month + 1).padStart(2, '0')}-${endDay}`;

  const { data, error } = await supabase
    .from('attendance')
    .select('profile_id, status, date')
    .eq('tenant_id', tenantId)
    .gte('date', startDate)
    .lte('date', endDate);
  return { data: data || [], error };
}

/** Fetch audit log entries for a tenant, optionally filtered by date. */
export async function fetchAttendanceAuditLog(tenantId, date) {
  let query = supabase
    .from('attendance_audit_log')
    .select('*, changed_by_profile:profiles!attendance_audit_log_changed_by_fkey(first_name, last_name), target_profile:profiles!attendance_audit_log_profile_id_fkey(first_name, last_name)')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (date) {
    query = query.eq('date', date);
  }

  const { data, error } = await query;
  return { data: data || [], error };
}
