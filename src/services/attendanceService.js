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

/** Fetch all attendance records with punches for every employee in a tenant — used for master report. */
export async function fetchAllAttendanceWithPunches(tenantId) {
  const { data, error } = await supabase
    .from('attendance')
    .select('id, profile_id, date, status, total_hours, punches(punch_time, punch_type)')
    .eq('tenant_id', tenantId)
    .order('date');
  return { data: data || [], error };
}

/** Fetch just the profile info for an employee (join_date, name, etc.) */
export async function fetchEmployeeProfileInfo(profileId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('first_name, last_name, join_date, department, designation')
    .eq('id', profileId)
    .single();
  return { profile: data, error };
}

/** Fetch complete attendance history for one employee from their join date. */
export async function fetchEmployeeFullHistory(profileId) {
  const { data: prof } = await supabase
    .from('profiles')
    .select('first_name, last_name, join_date, department, designation')
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

/** Employee submits a request to regularize attendance for a specific day */
export async function submitRegularizeRequest(tenantId, profileId, { date, clockInTime, clockOutTime, reason }) {
  const { data, error } = await supabase
    .from('regularize_requests')
    .insert([{
      tenant_id:      tenantId,
      profile_id:     profileId,
      date,
      clock_in_time:  clockInTime  || null,
      clock_out_time: clockOutTime || null,
      reason,
      status: 'Pending',
    }])
    .select()
    .single();
  return { data, error };
}

/** Admin/Manager: list all regularization requests for a tenant */
export async function listRegularizeRequests(tenantId) {
  const { data, error } = await supabase
    .from('regularize_requests')
    .select(`
      *,
      profile:profiles!regularize_requests_profile_id_fkey(first_name, last_name, department, designation),
      reviewer:profiles!regularize_requests_reviewed_by_fkey(first_name, last_name, role)
    `)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
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

/** Approve a request: apply attendance change then mark Approved */
export async function approveRegularizeRequest(request, reviewerId) {
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
  const reviewedAt = new Date().toISOString();
  const { error } = await supabase
    .from('regularize_requests')
    .update({ status: 'Approved', reviewed_by: reviewerId, reviewed_at: reviewedAt })
    .eq('id', request.id);
  return { error };
}

/** Reject a regularization request */
export async function rejectRegularizeRequest(requestId, reviewerId) {
  const reviewedAt = new Date().toISOString();
  const { error } = await supabase
    .from('regularize_requests')
    .update({ status: 'Rejected', reviewed_by: reviewerId, reviewed_at: reviewedAt })
    .eq('id', requestId);
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

  const auditLogs = [];

  // Get tenant configuration for hour calculations
  const { data: tenantData, error: tenantErr } = await supabase
    .from('tenants')
    .select('min_half_day_hours, min_full_day_hours')
    .eq('id', tenantId)
    .single();
  if (tenantErr) throw tenantErr;

  const halfMin = tenantData?.min_half_day_hours || 4;
  const fullMin = tenantData?.min_full_day_hours || 8;

  // Calculate hours if clock times provided
  let hours = 0;
  if (clockInTime && clockOutTime) {
    hours = Math.round(diffHours(clockInTime, clockOutTime) * 100) / 100;
  }

  // Determine final status based on hours and provided status
  let finalStatus = status;
  if (hours > 0) {
    if (status === 'Present' && hours < fullMin && hours >= halfMin) {
      finalStatus = 'Half Day';
    } else if (status === 'Present' && hours < halfMin) {
      finalStatus = 'Absent';
    }
  }

  // For each employee and each date in range
  for (const empId of employeeIds) {
    let currentDate = new Date(from);
    while (currentDate <= to) {
      const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;

      // Fetch existing attendance record
      const { data: existing, error: fetchErr } = await supabase
        .from('attendance')
        .select('id, status, total_hours')
        .eq('profile_id', empId)
        .eq('date', dateStr)
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

        // Update existing record
        const { error: updateErr } = await supabase
          .from('attendance')
          .update({
            status: finalStatus,
            total_hours: hours,
            location: 'Office (Regularized)'
          })
          .eq('id', existing.id);
        if (updateErr) throw updateErr;
        attId = existing.id;

        // Delete old punches if any
        await supabase.from('punches').delete().eq('attendance_id', existing.id);
      } else {
        // Create new record
        const { data: newAtt, error: insErr } = await supabase
          .from('attendance')
          .insert([{
            tenant_id: tenantId,
            profile_id: empId,
            date: dateStr,
            status: finalStatus,
            total_hours: hours,
            location: 'Office (Regularized)'
          }])
          .select()
          .single();
        if (insErr) throw insErr;
        attId = newAtt.id;
      }

      // Insert punches if clock times provided
      if (clockInTime && clockOutTime && attId) {
        const { error: punchErr } = await supabase
          .from('punches')
          .insert([
            { attendance_id: attId, punch_time: clockInTime, punch_type: 'in' },
            { attendance_id: attId, punch_time: clockOutTime, punch_type: 'out' }
          ]);
        if (punchErr) throw punchErr;
      }

      // Create audit log
      auditLogs.push({
        tenant_id: tenantId,
        attendance_id: attId,
        profile_id: empId,
        changed_by: changedBy,
        date: dateStr,
        action,
        old_status: oldStatus,
        new_status: finalStatus,
        old_hours: oldHours,
        new_hours: hours,
        reason: reason
      });

      currentDate.setDate(currentDate.getDate() + 1);
    }
  }

  // Insert all audit logs at once
  if (auditLogs.length > 0) {
    const { error: auditErr } = await supabase
      .from('attendance_audit_log')
      .insert(auditLogs);
    if (auditErr) throw auditErr;
  }

  return {
    success: true,
    recordsUpdated: auditLogs.length,
    auditLogs
  };
}
