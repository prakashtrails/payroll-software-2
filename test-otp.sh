#!/bin/bash
curl -s -X POST \
  "https://yxueywgrqrfgynqknsqs.supabase.co/functions/v1/send-otp" \
  -H "authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl4dWV5d2dycXJmZ3lucWtuc3FzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4NzMyMTEsImV4cCI6MjA5MjQ0OTIxMX0.HPddy4u4Qy4E1RHZXt3yUcrv8yO-ha5z1tYhNrH42J4" \
  -H "content-type: application/json" \
  -d "{\"to\":\"+919187404711\",\"channel\":\"sms\"}"
