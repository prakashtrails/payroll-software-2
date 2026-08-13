import { supabase } from '@/lib/supabase';

const SELECT = `
  *,
  organizer:profiles!one_on_ones_organizer_id_fkey(id, first_name, middle_name, last_name),
  participant:profiles!one_on_ones_participant_id_fkey(id, first_name, middle_name, last_name)
`;

/** Meetings where the caller is either the organizer or the participant. */
export async function listMyMeetings(tenantId, profileId) {
  const { data, error } = await supabase
    .from('one_on_ones')
    .select(SELECT)
    .eq('tenant_id', tenantId)
    .or(`organizer_id.eq.${profileId},participant_id.eq.${profileId}`)
    .order('meeting_date', { ascending: false });
  return { data: data || [], error };
}

export async function scheduleMeeting({
  tenantId, organizerId, participantId, title, agendaTemplateId, agendaContent,
  meetingDate, startTime, endTime, location,
}) {
  const { data, error } = await supabase
    .from('one_on_ones')
    .insert([{
      tenant_id: tenantId,
      organizer_id: organizerId,
      participant_id: participantId,
      title: title || '1:1 Meeting',
      agenda_template_id: agendaTemplateId || null,
      agenda_content: agendaContent || '',
      meeting_date: meetingDate,
      start_time: startTime || null,
      end_time: endTime || null,
      location: location || '',
    }])
    .select()
    .single();
  return { data, error };
}

export async function updateMeetingStatus(id, status) {
  const { error } = await supabase.from('one_on_ones').update({ status }).eq('id', id);
  return { error };
}

export async function addMeetingSummary(id, summary) {
  const { error } = await supabase
    .from('one_on_ones')
    .update({ summary, status: 'Completed' })
    .eq('id', id);
  return { error };
}

export async function listAgendaTemplates(tenantId) {
  const { data, error } = await supabase
    .from('agenda_templates')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('title');
  return { data: data || [], error };
}

export async function createAgendaTemplate({ tenantId, createdBy, title, content, isShared }) {
  const { data, error } = await supabase
    .from('agenda_templates')
    .insert([{ tenant_id: tenantId, created_by: createdBy, title, content: content || '', is_shared: !!isShared }])
    .select()
    .single();
  return { data, error };
}
