import { supabase } from '@/lib/supabase';
import { todayStr, timeStr, diffHours, checkGeofence } from '@/lib/helpers';
import { getOrCreateQuota, determineApproverRole, incrementSelfCount, incrementManagerCount } from './requestQuotaService';
import { resolveAttendanceSettings } from './tenantService';

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

  // Custom shift logic — computed unconditionally so the upsert below has a full
  // row ready; on conflict (row already exists) it's ignored and the existing
  // row's status/location are left untouched.
  const { data: profile } = await supabase.from('profiles').select('shift_id, outlet_id').eq('id', profileId).single();
  let shiftStart = tenant?.shift_start || '09:00';
  if (profile?.shift_id) {
    const { data: shift } = await supabase.from('shifts').select('start_time').eq('id', profile.shift_id).single();
    if (shift) shiftStart = shift.start_time;
  }

  const lateMin  = tenant?.late_threshold || 15;
  const [sh, sm] = shiftStart.split(':').map(Number);
  const now      = new Date();
  const diffMin  = (now.getHours() * 60 + now.getMinutes()) - (sh * 60 + sm);
  const status   = diffMin > lateMin ? 'Late' : 'Present';

  // Geofence check — flags, never blocks, since field staff legitimately punch off-site sometimes.
  const { data: outlet } = profile?.outlet_id
    ? await supabase.from('outlets').select('geofence_lat, geofence_lng, geofence_radius').eq('id', profile.outlet_id).maybeSingle()
    : { data: null };
  const outOfGeofence = checkGeofence(locationData?.lat, locationData?.lng, outlet, tenant) || false;

  // Atomic create-if-missing on (profile_id, date) — a select-then-insert here let a
  // double-tap (or slow network + retry) create two attendance rows for the same day.
  const { error: upsertErr } = await supabase
    .from('attendance')
    .upsert(
      [{
        tenant_id: tenantId,
        profile_id: profileId,
        date: today,
        status,
        location: 'Office',
        punch_in_lat: locationData?.lat,
        punch_in_lng: locationData?.lng,
        out_of_geofence: outOfGeofence,
      }],
      { onConflict: 'profile_id,date', ignoreDuplicates: true }
    );
  if (upsertErr) throw upsertErr;

  const { data: att, error: fetchErr } = await supabase
    .from('attendance')
    .select('id')
    .eq('profile_id', profileId)
    .eq('date', today)
    .single();
  if (fetchErr) throw fetchErr;

  const { error: punchErr } = await supabase
    .from('punches')
    .insert([{ attendance_id: att.id, punch_time: timeStr(new Date()), punch_type: 'in' }]);
  if (punchErr) throw punchErr;
}

/** Clock out for today. Inserts punch-out and recalculates total_hours + status. */
export async function clockOut(profileId, locationData = null) {
  const today = todayStr();

  const { data: att, error: fetchErr } = await supabase
    .from('attendance')
    .select('id, tenant_id, profile:profiles!attendance_profile_id_fkey(outlet_id)')
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

  // Thresholds: the employee's outlet override, falling back to the tenant default.
  const outletId = att.profile?.outlet_id;
  const [{ data: tenant }, { data: outlet }] = await Promise.all([
    supabase.from('tenants').select('min_half_day_hours, min_full_day_hours, geofence_lat, geofence_lng, geofence_radius').eq('id', att.tenant_id).single(),
    outletId
      ? supabase.from('outlets').select('min_half_day_hours, min_full_day_hours, geofence_lat, geofence_lng, geofence_radius').eq('id', outletId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const { min_half_day_hours: halfMin, min_full_day_hours: fullMin } = resolveAttendanceSettings(tenant, outlet);

  let status = 'Absent';
  if (total >= fullMin) {
    status = 'Present';
  } else if (total >= halfMin) {
    status = 'Half Day';
  }

  // Only ever flips out_of_geofence to true, never back to false — preserves
  // a flag already set at clock-in if this punch-out happens to be in range.
  const outOfGeofence = checkGeofence(locationData?.lat, locationData?.lng, outlet, tenant);

  await supabase
    .from('attendance')
    .update({
      total_hours: Math.round(total * 100) / 100,
      status,
      punch_out_lat: locationData?.lat,
      punch_out_lng: locationData?.lng,
      ...(outOfGeofence === true ? { out_of_geofence: true } : {}),
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

export async function fetchTodayAttendanceSummary(tenantId, date, outletProfileIds = null) {
  let profilesQuery = supabase.from('profiles').select('id').eq('tenant_id', tenantId).eq('status', 'Active');
  if (outletProfileIds) profilesQuery = profilesQuery.in('id', [...outletProfileIds]);

  const [profilesRes, attendanceRes] = await Promise.all([
    profilesQuery,
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

  const action = existing ? 'update' : 'create';
  const oldStatus = existing?.status ?? null;
  const oldHours  = existing?.total_hours ?? null;

  // Atomic upsert on (profile_id, date) — a select-then-insert/update here could create
  // a duplicate row for the same day under a race (e.g. two admin tabs saving at once).
  const { data: saved, error: upsertErr } = await supabase
    .from('attendance')
    .upsert(
      [{ tenant_id: tenantId, profile_id, date, status, total_hours: hours, location: 'Office (Manual)' }],
      { onConflict: 'profile_id,date' }
    )
    .select('id')
    .single();
  if (upsertErr) throw upsertErr;
  const attId = saved.id;

  await supabase.from('punches').delete().eq('attendance_id', attId);

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
    .select('profile_id, status, date, total_hours')
    .eq('tenant_id', tenantId)
    .gte('date', startDate)
    .lte('date', endDate);
  return { data: data || [], error };
}

/** Fetch audit log entries for a tenant, optionally filtered by date. */
export async function fetchAttendanceAuditLog(tenantId, date) {
  let query = supabase
    .from('attendance_audit_log')
    .select('*, changed_by_profile:profiles!attendance_audit_log_changed_by_fkey(first_name, middle_name, last_name), target_profile:profiles!attendance_audit_log_profile_id_fkey(first_name, middle_name, last_name)')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (date) {
    query = query.eq('date', date);
  }

  const { data, error } = await query;
  return { data: data || [], error };
}

/**
 * Fetch attendance records with punches for every employee in a tenant, scoped to one
 * calendar year — used for master report. An unbounded all-time fetch here would pull
 * hundreds of thousands of rows once a few years of daily attendance accumulate.
 */
export async function fetchAllAttendanceWithPunches(tenantId, year = new Date().getFullYear()) {
  const { data, error } = await supabase
    .from('attendance')
    .select('id, profile_id, date, status, total_hours, punches(punch_time, punch_type)')
    .eq('tenant_id', tenantId)
    .gte('date', `${year}-01-01`)
    .lte('date', `${year}-12-31`)
    .order('date');
  return { data: data || [], error };
}

/** Fetch just the profile info for an employee (join_date, name, etc.) */
export async function fetchEmployeeProfileInfo(profileId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('first_name, middle_name, last_name, join_date, department, designation')
    .eq('id', profileId)
    .single();
  return { profile: data, error };
}

/** Fetch complete attendance history for one employee from their join date. */
export async function fetchEmployeeFullHistory(profileId) {
  const { data: prof } = await supabase
    .from('profiles')
    .select('first_name, middle_name, last_name, join_date, department, designation')
    .eq('id', profileId)
    .single();

  // Fetch all attendance records (no date filter yet — need earliest to compute fromDate)
  const { data: allRecords, error } = await supabase
    .from('attendance')
    .select('date, status, total_hours, punches(punch_time, punch_type)')
    .eq('profile_id', profileId)
    .order('date');

  // Determine start date: join_date → first attendance record → today
  let fromDate = prof?.join_date || null;
  if (!fromDate && allRecords && allRecords.length > 0) {
    fromDate = allRecords[0].date;
  }
  if (!fromDate) {
    fromDate = todayStr();
  }

  return { data: allRecords || [], profile: prof, fromDate, error };
}

// ── Regularization Requests (employee-initiated) ──────────────────────────────

/**
 * Employee submits a regularize request with tiered quota routing.
 * Returns { data, error, tier } where tier is 'self' | 'manager' | 'admin'.
 * When tier === 'self' the attendance change is applied immediately (no approval wait).
 */
export async function submitRegularizeRequest(tenantId, profileId, { date, clockInTime, clockOutTime, reason }) {
  const quota = await getOrCreateQuota(tenantId, profileId);
  const tier  = determineApproverRole(quota);

  const payload = {
    tenant_id:      tenantId,
    profile_id:     profileId,
    date,
    clock_in_time:  clockInTime  || null,
    clock_out_time: clockOutTime || null,
    reason,
    status:                 tier === 'self' ? 'Approved' : 'Pending',
    required_approver_role: tier,
    approval_level:         tier === 'self' ? 'self' : null,
  };

  if (tier === 'self') {
    await regularizeAttendance(tenantId, {
      fromDate:    date,
      toDate:      date,
      employeeIds: [profileId],
      status:      'Present',
      clockInTime,
      clockOutTime,
      reason,
      changedBy:   profileId,
    });
  }

  const { data, error } = await supabase
    .from('regularize_requests')
    .insert([payload])
    .select()
    .single();

  // Only spend a self-approval slot once the attendance change AND the request
  // record both succeeded — incrementing earlier burned quota on failed attempts
  // (e.g. a blocked audit-log insert) with nothing actually recorded.
  if (tier === 'self' && !error) {
    await incrementSelfCount(tenantId, profileId);
  }

  return { data, error, tier };
}

/**
 * Admin/Manager: list all regularization requests for a tenant.
 * Pass forRole='manager' to restrict to manager-routed requests only.
 */
export async function listRegularizeRequests(tenantId, forRole = null) {
  let query = supabase
    .from('regularize_requests')
    .select(`
      *,
      profile:profiles!regularize_requests_profile_id_fkey(first_name, middle_name, last_name, department, designation),
      reviewer:profiles!regularize_requests_reviewed_by_fkey(first_name, middle_name, last_name, role)
    `)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });

  if (forRole === 'manager') {
    query = query.eq('required_approver_role', 'manager');
  }

  const { data, error } = await query;
  return { data: data || [], error };
}

/** Employee: list their own regularization requests */
export async function listMyRegularizeRequests(profileId) {
  const { data, error } = await supabase
    .from('regularize_requests')
    .select('*')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false })
    .limit(20);
  return { data: data || [], error };
}

/**
 * Approve a regularize request: apply attendance change and mark Approved.
 * reviewerRole: 'manager' | 'admin' | 'superadmin'
 * When manager approves, increments that employee's manager quota.
 */
export async function approveRegularizeRequest(request, reviewerId, reviewerRole = 'admin') {
  // Claim the request first (only if still Pending) — otherwise a double-click, or two
  // reviewers acting at once, would re-apply the attendance change a second time.
  const reviewedAt = new Date().toISOString();
  const { data: claimed, error: claimErr } = await supabase
    .from('regularize_requests')
    .update({ status: 'Approved', reviewed_by: reviewerId, reviewed_at: reviewedAt })
    .eq('id', request.id)
    .eq('status', 'Pending')
    .select('id');

  if (claimErr) return { error: claimErr };
  if (claimed?.length === 0) return { error: new Error('This request has already been reviewed.') };

  await regularizeAttendance(request.tenant_id, {
    fromDate:     request.date,
    toDate:       request.date,
    employeeIds:  [request.profile_id],
    status:       'Present',
    clockInTime:  request.clock_in_time,
    clockOutTime: request.clock_out_time,
    reason:       request.reason,
    changedBy:    reviewerId,
  });

  if (reviewerRole === 'manager') {
    await incrementManagerCount(request.tenant_id, request.profile_id);
  }

  return { error: null };
}

/** Reject a regularization request */
export async function rejectRegularizeRequest(requestId, reviewerId) {
  const reviewedAt = new Date().toISOString();
  const { data: updated, error } = await supabase
    .from('regularize_requests')
    .update({ status: 'Rejected', reviewed_by: reviewerId, reviewed_at: reviewedAt })
    .eq('id', requestId)
    .eq('status', 'Pending')
    .select('id');

  if (!error && updated?.length === 0) {
    return { error: new Error('This request has already been reviewed.') };
  }
  return { error };
}

// ─────────────────────────────────────────────────────────────────────────────

/** Bulk regularize attendance for multiple employees across a date range */
export async function regularizeAttendance(tenantId, {
  fromDate,
  toDate,
  employeeIds,
  status,
  clockInTime = null,
  clockOutTime = null,
  reason = '',
  changedBy
}) {
  if (!fromDate || !toDate || !employeeIds || employeeIds.length === 0 || !status) {
    throw new Error('Missing required fields: fromDate, toDate, employeeIds, status');
  }

  if (!reason || reason.trim() === '') {
    throw new Error('Reason is required for attendance regularization');
  }

  if (fromDate > toDate) {
    throw new Error('From date must be less than or equal to To date');
  }

  if (toDate > todayStr()) {
    throw new Error('Cannot regularize future dates');
  }

  // Parse as local dates to avoid UTC-midnight timezone shifts
  const [ffy, ffm, ffd] = fromDate.split('-').map(Number);
  const [tty, ttm, ttd] = toDate.split('-').map(Number);
  const from = new Date(ffy, ffm - 1, ffd);
  const to = new Date(tty, ttm - 1, ttd);

  const dates = [];
  for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    dates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }

  // Get tenant configuration for hour calculations, plus each employee's outlet
  // (if any) so an outlet's own half/full-day thresholds override the tenant default.
  const [{ data: tenantData, error: tenantErr }, { data: employeeOutlets }, { data: tenantOutlets }] = await Promise.all([
    supabase.from('tenants').select('min_half_day_hours, min_full_day_hours').eq('id', tenantId).single(),
    supabase.from('profiles').select('id, outlet_id').in('id', employeeIds),
    supabase.from('outlets').select('id, min_half_day_hours, min_full_day_hours').eq('tenant_id', tenantId),
  ]);
  if (tenantErr) throw tenantErr;

  const outletIdByProfile = Object.fromEntries((employeeOutlets || []).map((p) => [p.id, p.outlet_id]));
  const outletById = Object.fromEntries((tenantOutlets || []).map((o) => [o.id, o]));

  // Calculate hours if clock times provided
  let hours = 0;
  if (clockInTime && clockOutTime) {
    hours = Math.round(diffHours(clockInTime, clockOutTime) * 100) / 100;
  }

  // Batch-fetch every existing attendance row in range for these employees in
  // ONE query, instead of one SELECT per (employee, date) pair.
  const { data: existingRows, error: existingErr } = await supabase
    .from('attendance')
    .select('id, profile_id, date, status, total_hours')
    .in('profile_id', employeeIds)
    .gte('date', fromDate)
    .lte('date', toDate);
  if (existingErr) throw existingErr;
  const existingByKey = Object.fromEntries((existingRows || []).map((r) => [`${r.profile_id}_${r.date}`, r]));

  // Build the full (employee x date) payload in memory, then write it in
  // chunked batch calls instead of one round-trip per cell.
  const upsertPayload = [];
  const rowMeta = [];
  for (const empId of employeeIds) {
    const outlet = outletById[outletIdByProfile[empId]] || null;
    const { min_half_day_hours: halfMin, min_full_day_hours: fullMin } = resolveAttendanceSettings(tenantData, outlet);

    // Determine final status based on hours and provided status (per employee, since
    // thresholds can differ by outlet)
    let finalStatus = status;
    if (hours > 0) {
      if (status === 'Present' && hours < fullMin && hours >= halfMin) {
        finalStatus = 'Half Day';
      } else if (status === 'Present' && hours < halfMin) {
        finalStatus = 'Absent';
      }
    }

    for (const dateStr of dates) {
      const existing = existingByKey[`${empId}_${dateStr}`];
      upsertPayload.push({
        tenant_id: tenantId,
        profile_id: empId,
        date: dateStr,
        status: finalStatus,
        total_hours: hours,
        location: 'Office (Regularized)',
      });
      rowMeta.push({
        empId,
        dateStr,
        finalStatus,
        action: existing ? 'update' : 'create',
        oldStatus: existing?.status ?? null,
        oldHours: existing?.total_hours ?? null,
      });
    }
  }

  const CHUNK = 500;
  const chunks = (arr) => {
    const out = [];
    for (let i = 0; i < arr.length; i += CHUNK) out.push(arr.slice(i, i + CHUNK));
    return out;
  };

  // Atomic upsert on (profile_id, date) per row — avoids creating a duplicate row
  // if this races with a concurrent clock-in/manual edit for the same day —
  // batched in chunks instead of one upsert per cell.
  const attIdByKey = {};
  for (const part of chunks(upsertPayload)) {
    const { data: saved, error: upsertErr } = await supabase
      .from('attendance')
      .upsert(part, { onConflict: 'profile_id,date' })
      .select('id, profile_id, date');
    if (upsertErr) throw upsertErr;
    for (const r of saved) attIdByKey[`${r.profile_id}_${r.date}`] = r.id;
  }

  const attIds = rowMeta.map((m) => attIdByKey[`${m.empId}_${m.dateStr}`]);

  for (const part of chunks(attIds)) {
    const { error: delErr } = await supabase.from('punches').delete().in('attendance_id', part);
    if (delErr) throw delErr;
  }

  if (clockInTime && clockOutTime) {
    const punchRows = attIds.flatMap((attId) => [
      { attendance_id: attId, punch_time: clockInTime, punch_type: 'in' },
      { attendance_id: attId, punch_time: clockOutTime, punch_type: 'out' },
    ]);
    for (const part of chunks(punchRows)) {
      const { error: punchErr } = await supabase.from('punches').insert(part);
      if (punchErr) throw punchErr;
    }
  }

  const auditLogs = rowMeta.map((m) => ({
    tenant_id: tenantId,
    attendance_id: attIdByKey[`${m.empId}_${m.dateStr}`],
    profile_id: m.empId,
    changed_by: changedBy,
    date: m.dateStr,
    action: m.action,
    old_status: m.oldStatus,
    new_status: m.finalStatus,
    old_hours: m.oldHours,
    new_hours: hours,
    reason: reason,
  }));

  for (const part of chunks(auditLogs)) {
    const { error: auditErr } = await supabase.from('attendance_audit_log').insert(part);
    if (auditErr) throw auditErr;
  }

  return {
    success: true,
    recordsUpdated: auditLogs.length,
    auditLogs
  };
}
