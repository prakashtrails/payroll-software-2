# CrewCore — SMS OTP, WhatsApp, Slack, Email & AI: setup and costing

_Prepared 3 Oct 2026. Prices exclude 18% GST unless stated. USD→INR assumed at ₹88._

## 1. What it costs per unit

| Channel | Provider | Unit price | Notes |
|---|---|---|---|
| SMS OTP | MSG91 OTP API | ₹0.15–0.20 per SMS (₹0.13 negotiated at volume) | Only registered, active numbers get an SMS. 1/min and 5/hour per number, 300/hour platform cap |
| DLT registration (India, mandatory for SMS) | Jio / Vi (ViLPower) / Airtel portals | ~₹5,900 one-time (entity), then sender ID + OTP template approval | Pay once on the first portal; other portals free. 3–5 working days |
| WhatsApp task alerts | Meta utility template via MSG91 | ₹0.115 per message (Meta, from 1 Jul 2026) + MSG91 platform fee | Confirm MSG91's per-message markup/plan before go-live. Needs a verified WhatsApp Business number |
| Slack task alerts | Slack incoming webhook | Free | Per company, pasted by HR in Settings |
| Email task alerts | Existing Gmail SMTP (same as OTP email) | Free | Gmail caps ~500 mails/day (Workspace ~2,000/day). Move to a mail API if a company needs more |
| In-app + mobile push | Existing | Free | Always on |
| AI Assistant (chat) | Claude Opus 5.5 — $4 / $20 per M tokens in/out, cached reads $0.20/M | ≈ $0.02–0.04 (₹2–3.5) per message | Help content is prompt-cached; low effort; 1–2 tool calls typical. Cap 40 messages/user/day |
| AI Meeting Notes | Claude Opus 5.5 | ≈ ₹5–7 for a 1-hour meeting (~10k tokens); ≈ ₹16 at the 120k-character limit | Medium effort. Cap 10 extractions/user/day. Transcript never stored |

## 2. Monthly estimates

**SMS OTP** (login + forgot-password by phone only — email OTP stays free)

| Logins by SMS / month | SMS cost | With GST |
|---|---|---|
| 1,000 | ₹200 | ₹236 |
| 5,000 | ₹1,000 | ₹1,180 |
| 20,000 | ₹3,000 (₹0.15) | ₹3,540 |

**WhatsApp task alerts** (per company that turns it on; ~2 alerts per user per working day)

| Users | Messages / month | Meta cost | + GST |
|---|---|---|---|
| 25 | ~1,100 | ₹127 | ₹150 |
| 100 | ~4,400 | ₹506 | ₹597 |
| 250 | ~11,000 | ₹1,265 | ₹1,493 |
Plus the MSG91 WhatsApp plan fee.

**AI** (only companies where the premium feature is switched on)

| Usage | Monthly |
|---|---|
| 50 users × 5 chat messages/working day | ~5,500 msgs ≈ $110–220 (₹9,700–19,400) |
| 50 users × 1 chat message/working day | ~1,100 msgs ≈ $22–44 (₹1,900–3,900) |
| 40 one-hour meetings | ≈ ₹200–280 |

Usage per user/day/feature (requests + tokens) is recorded in `ai_usage_daily` — use it to bill premium customers or tune the caps (`DAILY_CAP` in the two edge functions).

## 3. Go-live checklist (owner: CrewCore admin)

**SMS OTP (MSG91)**
1. Register the company on a DLT portal (Jio/Vi/Airtel), then register a sender ID (header, e.g. `CRWCOR`) and an OTP content template, e.g.
   `{#var#} is your CrewCore login code. It expires in 5 minutes. Do not share it. - CrewCore`
2. In MSG91: add the DLT entity ID, sender ID and template; create an **OTP template** using `##OTP##` and copy its template ID.
3. Set Supabase function secrets: `MSG91_AUTH_KEY`, `MSG91_OTP_TEMPLATE_ID`.
4. Test: Login → OTP Login → enter a registered 10-digit mobile.

**WhatsApp (MSG91)**
1. Connect a WhatsApp Business number in MSG91 (Meta Business verification).
2. Create a **Utility** template with two body variables, e.g. name `task_update`:
   `Hi {{1}}, {{2}} — open CrewCore to view your tasks.`
3. Set secrets: `MSG91_WA_NUMBER` (integrated number), `MSG91_WA_TEMPLATE` (template name), optional `MSG91_WA_LANG` (default `en`).
4. HR turns WhatsApp on in Settings → Task Notifications & Reminders → Test.

**AI**
1. Create an Anthropic API key (console.anthropic.com), set a monthly spend limit there.
2. Set secret `ANTHROPIC_API_KEY`.
3. Super admin → Toggle Services → enable **AI Assistant** / **AI Meeting Notes** per company (both are premium and off by default).

Set secrets with: `npx supabase secrets set NAME=value --project-ref yxueywgrqrfgynqknsqs`

## Sources
- MSG91 SMS pricing — https://msg91.com/in/pricing/sms
- SMS OTP pricing in India 2026 — https://www.messagecentral.com/blog/sms-otp-pricing-india
- WhatsApp Business API pricing India 2026 — https://chatmaxima.com/whatsapp-api-pricing/india/ , https://aisensy.com/pricing
- DLT registration — https://developer.exotel.com/docs/sms-support/dlt-registration
- Claude API pricing — Anthropic model table (Claude Opus 5.5: $4 / $20 per million input/output tokens)
