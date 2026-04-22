import { supabase } from '@/lib/supabase';

/**
 * Send an OTP to the given destination via Twilio Verify.
 * @param {string} to - Phone number (E.164 format, e.g. "+919876543210") or email address
 * @param {'sms'|'email'} channel - Delivery channel
 */
export async function sendOtp(to, channel) {
  const { data, error } = await supabase.functions.invoke('send-otp', {
    body: { to, channel },
  });

  if (error) throw new Error(error.message || 'Failed to send OTP');
  if (data?.error) throw new Error(data.error);
  return data;
}

/**
 * Verify an OTP code.
 * @param {string} to - The same phone/email the OTP was sent to
 * @param {string} code - The 6-digit OTP code entered by the user
 */
export async function verifyOtp(to, code) {
  const { data, error } = await supabase.functions.invoke('verify-otp', {
    body: { to, code },
  });

  if (error) throw new Error(error.message || 'Verification failed');
  if (data?.error) throw new Error(data.error);
  return data; // { verified: true/false }
}
