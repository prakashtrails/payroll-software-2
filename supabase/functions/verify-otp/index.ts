import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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
    const { identifier, otp, isSignup, password, firstName, lastName } = body

    if (!identifier || !otp) {
      return new Response(JSON.stringify({ error: 'Email and OTP are required' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // 1. Check OTP in database (without time filter first, to see why it fails)
    const { data: otpData, error: otpError } = await supabase
      .from('otp_table')
      .select('*')
      .eq('user_id', identifier)
      .eq('otp', otp)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (otpError) {
      console.error('Database Error:', otpError)
      return new Response(JSON.stringify({ message: `Database error: ${otpError.message}`, error: otpError.message }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      })
    }

    const now = new Date().toISOString()

    if (!otpData) {
      return new Response(JSON.stringify({ message: 'Incorrect OTP. Please check your email.', error: 'Invalid OTP' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      })
    }

    // Check if expired
    if (new Date(otpData.expires_at) < new Date()) {
       return new Response(JSON.stringify({ 
         message: `OTP expired. Server time: ${now}, OTP expires: ${otpData.expires_at}`, 
         error: 'OTP expired' 
       }), {
         headers: { ...corsHeaders, 'Content-Type': 'application/json' },
         status: 401,
       })
    }

    // OTP is valid! Delete it so it can't be used again
    await supabase.from('otp_table').delete().eq('id', otpData.id)

    if (isSignup) {
      let userId: string

      // Try to create user first — if they already exist, we'll get an error and handle it
      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email: identifier,
        password: password || 'temp-will-be-set',
        email_confirm: true,
        user_metadata: {
          ...(firstName ? { first_name: firstName } : {}),
          ...(lastName  ? { last_name:  lastName  } : {}),
        },
      })

      if (createError) {
        // User already exists — look them up by email
        if (createError.message?.includes('already been registered') || 
            createError.message?.includes('already exists') ||
            createError.status === 422) {
          // Fetch existing user by email using generateLink (which returns the user object and recovers soft-deleted identities)
          const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
            type: 'magiclink',
            email: identifier,
          })
          
          if (linkError || !linkData?.user) {
            return new Response(JSON.stringify({
              error: 'User exists but could not be recovered. Please contact support.',
              message: linkError?.message || 'Recovery failed.'
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              status: 500,
            })
          }
          userId = linkData.user.id
        } else {
          console.error('Create User Error:', createError)
          return new Response(JSON.stringify({ error: createError.message, message: createError.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500,
          })
        }
      } else {
        userId = newUser.user.id
      }

      // Step B: Update password, confirm email, and set metadata
      const updatePayload: Record<string, unknown> = { email_confirm: true }
      if (password) updatePayload.password = password
      if (firstName || lastName) {
        updatePayload.user_metadata = {
          ...(firstName ? { first_name: firstName } : {}),
          ...(lastName  ? { last_name:  lastName  } : {}),
        }
      }

      const { error: updateError } = await supabase.auth.admin.updateUserById(userId, updatePayload)

      if (updateError) {
        console.error('Update User Error:', updateError)
        return new Response(JSON.stringify({ error: updateError.message, message: updateError.message }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500,
        })
      }

      // Return user_id + flag — frontend will use signInWithPassword instead of token_hash
      return new Response(JSON.stringify({
        message: 'OTP verified and user created successfully',
        user_id: userId,
        usePasswordLogin: true,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 })
    }

    // Login path: Magic Bridge
    const { data, error } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: identifier,
    })

    if (error) {
       console.error('Auth Link Error:', error)
       throw error
    }

    // Supabase returns 'hashed_token', frontend verifyOtp expects 'token_hash'
    const token_hash = data.properties.hashed_token ?? data.properties.token_hash

    return new Response(JSON.stringify({
      message: 'OTP verified successfully',
      token_hash,
      type: 'magiclink'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error) {
    console.error('Unhandled Error in verify-otp:', error)
    return new Response(JSON.stringify({ message: error.message, error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})

