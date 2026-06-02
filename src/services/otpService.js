/**
 * otpService.js
 *
 * This version uses Nodemailer for Email OTP 
 */

import { supabase } from '@/lib/supabase';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Detect whether an identifier is an email or a phone number.
 */
export function detectIdentifierType(identifier) {
    const id = (identifier || '').trim();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(id)) return 'email';
    if (/^\d{10}$/.test(id)) return 'phone';
    return null;
}

/**
 * Send a 6-digit OTP to the given email using Custom Edge Function + Nodemailer.
 */
export async function sendOtp(identifier, options = { shouldCreateUser: true }) {
    const id = (identifier || '').trim();
    const type = detectIdentifierType(id);

    if (!type) {
        throw new Error('Please enter a valid email address.');
    }

    if (type !== 'email') {
        throw new Error('Phone OTP is currently disabled. Please use your email address.');
    }

    const resolvedId = id.toLowerCase();

    try {
        const { data, error } = await supabase.functions.invoke('send-otp', {
            body: { identifier: resolvedId, type: 'email' },
        });

        if (error) {
            console.error('send-otp error:', error);
            let msg = error.message || '';
            if (error.context) {
                try {
                    const body = await error.context.clone().json();
                    msg = body.error || body.message || msg;
                } catch (_) { /* body already consumed or not JSON */ }
            }
            throw new Error(msg || 'Failed to send OTP. Please try again.');
        }

        return { type: 'email', identifier: resolvedId };
    } catch (err) {
        const finalMsg = err.message || 'Failed to send OTP. Please try again.';
        throw new Error(finalMsg);
    }
}



/**
 * Verify the OTP token and perform the "Magic Bridge" login/signup.
 * For signup (isSignup=true): edge function atomically creates the user,
 * sets the password, confirms the email, and returns a token_hash.
 * For login (isSignup=false): edge function just generates a magic link token_hash.
 * Both paths exchange token_hash for a real Supabase session here.
 */
export async function verifyOtp(identifier, token, isSignup = false, password = null, firstName = null, lastName = null) {
    const requestBody = { identifier, otp: token, isSignup };
    if (isSignup) {
        if (password)   requestBody.password  = password;
        if (firstName)  requestBody.firstName = firstName;
        if (lastName)   requestBody.lastName  = lastName;
    }

    const { data, error } = await supabase.functions.invoke('verify-otp', {
        body: requestBody,
    });

    if (error) {
        console.error('verify-otp error:', error);
        let msg = error.message || '';
        if (error.context) {
            try {
                const body = await error.context.clone().json();
                msg = body.error || body.message || msg;
            } catch (_) { /* body already consumed or not JSON */ }
        }
        throw new Error(msg || 'OTP verification failed. Please try again.');
    }

    // For signup: edge function created/confirmed the user and returned user_id
    // Sign in with password to get a real session (no magic link needed!)
    if (data?.usePasswordLogin && password) {
        console.log('OTP verified. Signing in with password for user:', data.user_id);
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
            email: identifier,
            password: password,
        });

        if (authError) {
            console.error('Password Sign-In Error:', authError);
            throw new Error(`Sign-in failed: ${authError.message}`);
        }

        return authData; // { user, session }
    }

    // For login: use the magic link token_hash approach
    if (!data?.token_hash) {
        throw new Error('Verification failed: no session token returned from server.');
    }

    const { data: authData, error: authError } = await supabase.auth.verifyOtp({
        token_hash: data.token_hash,
        type: 'magiclink',
    });

    if (authError) {
        console.error('Supabase Session Exchange Error:', authError);
        throw new Error(`Session Login Failed: ${authError.message}`);
    }

    return authData; // { user, session }
}

/**
 * Signup helper
 */
export async function signUp(email, password, metadata = {}) {
    const { data, error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: { data: metadata }
    });
    
    if (error) throw error;
    return { type: 'email', identifier: email.trim().toLowerCase(), ...data };
}