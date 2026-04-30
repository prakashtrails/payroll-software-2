import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import nodemailer from 'npm:nodemailer'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-app-name',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const { identifier, type } = body

    if (!identifier || type !== 'email') {
      return new Response(
        JSON.stringify({ 
          error: 'Missing identifier or unsupported type.',
          received: { identifier, type } 
        }), 
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        }
      )
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    
    if (!supabaseUrl || !supabaseServiceKey) {
       throw new Error('Missing Supabase environment variables in Edge Function.')
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString()
    
    // Set expiration to 5 minutes from now
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString()

    // 1. Delete any previous OTPs for this email (prevents stale entries)
    await supabase.from('otp_table').delete().eq('user_id', identifier)

    // 2. Store new OTP in database
    const { error: dbError } = await supabase
      .from('otp_table')
      .insert([
        { 
          user_id: identifier, 
          otp: otp,
          expires_at: expiresAt
        }
      ])

    if (dbError) {
      console.error('Database Error:', dbError)
      return new Response(JSON.stringify({ error: `Database error: ${dbError.message}` }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      })
    }

    // 3. Send OTP via Nodemailer
    const smtpHost = Deno.env.get('SMTP_HOST')
    const smtpPort = Deno.env.get('SMTP_PORT')
    const smtpUser = Deno.env.get('SMTP_USER')
    const smtpPass = Deno.env.get('SMTP_PASS')
    const smtpFrom = Deno.env.get('SMTP_FROM')

    if (!smtpHost || !smtpUser || !smtpPass) {
       throw new Error('SMTP configuration is incomplete in Supabase Secrets.')
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: parseInt(smtpPort || '465'),
      secure: parseInt(smtpPort || '465') === 465,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    })

    try {
      await transporter.sendMail({
        from: smtpFrom || smtpUser,
        to: identifier,
        subject: `Your PayrollPro OTP: ${otp}`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
            <h2 style="color: #333; text-align: center;">Verification Code</h2>
            <p style="font-size: 16px; color: #666; text-align: center;">Use the following code to complete your login to PayrollPro:</p>
            <div style="background: #f8f9fa; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0;">
              <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #007bff;">${otp}</span>
            </div>
            <p style="font-size: 14px; color: #999; text-align: center;">This code will expire in 5 minutes.</p>
            <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
            <p style="font-size: 12px; color: #ccc; text-align: center;">If you didn't request this code, you can safely ignore this email.</p>
          </div>
        `,
      })
    } catch (mailError) {
      console.error('Mail Error:', mailError)
      return new Response(JSON.stringify({ error: `Mail delivery failed: ${mailError.message}` }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      })
    }

    return new Response(JSON.stringify({ message: 'OTP sent successfully' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error) {
    console.error('Unhandled Error in send-otp:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})

