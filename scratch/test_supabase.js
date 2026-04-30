const url = 'https://yxueywgrqrfgynqknsqs.supabase.co/rest/v1/profiles?select=*&limit=1';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl4dWV5d2dycXJmZ3lucWtuc3FzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4NzMyMTEsImV4cCI6MjA5MjQ0OTIxMX0.HPddy4u4Qy4E1RHZXt3yUcrv8yO-ha5z1tYhNrH42J4';

console.log('Testing connection to Supabase...');

fetch(url, {
  headers: {
    'apikey': key,
    'Authorization': `Bearer ${key}`
  }
})
.then(async r => {
  const text = await r.text();
  console.log('Status:', r.status);
  console.log('Headers:', JSON.stringify([...r.headers.entries()]));
  try {
    console.log('Body:', JSON.parse(text));
  } catch (e) {
    console.log('Body (text):', text);
  }
})
.catch(e => console.error('Fetch Error:', e));
