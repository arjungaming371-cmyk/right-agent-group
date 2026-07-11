# WhatsApp Cloud API — Simple Setup Guide
**Follow these steps in order. Total time: ~1 hour of work + waiting for Meta approvals.**
**Your code is already done — you only need to get 4 values from Meta and put them in `.env`.**

---

## What you're collecting (the goal)

By the end, your `.env` will have these filled:

```
WHATSAPP_TOKEN=EAAxxxx...            ← Step 5
WHATSAPP_PHONE_NUMBER_ID=1234567890  ← Step 3
WHATSAPP_VERIFY_TOKEN=rag-verify-2026   ← you invent this yourself (any random text)
WHATSAPP_APP_SECRET=abc123...        ← Step 6
```

---

## Step 1 — Meta Business Portfolio (15 min)
1. Go to **business.facebook.com** → log in with the client's Facebook account (or create one).
2. Create a Business Portfolio: name = **LS Right Agent Services OPC Pvt Ltd**.
3. Go to **Settings → Security Centre → Start Verification**. Upload GST certificate or CIN + a document showing the business name and address. Submit.
   - ⏳ Takes 1–5 days. **Don't wait — continue to Step 2**, everything else works while this is pending. Verification just unlocks higher sending limits later.

## Step 2 — Create the App (5 min)
1. Go to **developers.facebook.com** → My Apps → **Create App**.
2. Choose **Business** type → name it "Right Agent WhatsApp" → link it to the portfolio from Step 1.
3. On the app dashboard, find **WhatsApp** → click **Set Up**.

## Step 3 — Add the new number (10 min)
1. In the app: **WhatsApp → API Setup**. You'll see a free TEST number — ignore it.
2. Click **Add phone number**. Enter the NEW SIM's number, business display name = **Right Agent Group**, category = Finance.
3. Meta sends an **OTP by SMS or call to the new SIM** — this is the only moment the SIM is needed. Enter it.
4. On the API Setup page, copy the **Phone Number ID** (a long number shown under the phone) → this is `WHATSAPP_PHONE_NUMBER_ID`.

> ⚠️ Important: this number must NOT have WhatsApp installed on any phone. If someone opened WhatsApp with this SIM, delete that account first (WhatsApp app → Settings → Account → Delete my account).

## Step 4 — Create the form-link template (10 min + approval wait)
1. Go to **business.facebook.com → WhatsApp Manager → Message Templates → Create Template**.
2. Category: **Utility** (NOT Marketing — utility is ₹0.115, marketing is ₹0.86).
3. Name: `loan_application_form`  ·  Language: **English**
4. **Body** (copy exactly):
   ```
   Hi {{1}}! Thanks for speaking with Priya from Right Agent Group. Tap the button below to complete your loan application.

   We never ask for OTP, PIN, or any payment. — Right Agent Group, Hyderabad
   ```
   Sample value for {{1}}: `Ramesh`
5. **Add a Button** → type **Visit Website** → URL type **Dynamic**:
   ```
   https://YOUR-DOMAIN.com/form/{{1}}
   ```
   (put your real domain; sample value for {{1}}: `abc123`)
6. Submit. ⏳ Approval: minutes to 48 hours. Until approved, the code automatically falls back to a plain text message for customers who messaged you in the last 24 hours.

## Step 5 — Permanent token (10 min)
The token shown on the API Setup page **expires in 24 hours** — don't use that one. Make a permanent one:
1. **business.facebook.com → Settings → Users → System Users → Add**. Name: `rag-system`, role: Admin.
2. Click the system user → **Add Assets** → Apps → select your app → Full Control.
3. Click **Generate New Token** → select your app → expiry: **Never** → tick permissions: `whatsapp_business_messaging` and `whatsapp_business_management` → Generate.
4. Copy the token (starts with `EAA...`) → this is `WHATSAPP_TOKEN`. Save it somewhere safe — Meta shows it only once.

## Step 6 — App Secret (2 min)
developers.facebook.com → your app → **Settings → Basic** → App Secret → Show → copy → this is `WHATSAPP_APP_SECRET`.

## Step 7 — Webhook (5 min)
This is how Meta delivers incoming customer messages to your app.
1. Make sure your site is running and reachable at your public URL (named Cloudflare tunnel).
2. In the app: **WhatsApp → Configuration → Webhook → Edit**:
   - Callback URL: `https://YOUR-DOMAIN.com/api/whatsapp`
   - Verify token: the exact text you put in `WHATSAPP_VERIFY_TOKEN` in `.env`
3. Click **Verify and Save**. (Your app must be running — Meta calls the URL instantly to check.)
4. Below that, click **Manage** → subscribe to the **messages** field.

## Step 8 — Fill .env, restart, test
1. Put all 4 values in `.env` on the laptop.
2. Restart everything: `.\START.ps1`
3. **Test 1 (inbound + auto-reply):** from your personal phone, send "Hi" to the new business number → Priya's AI should reply within seconds, and the chat appears in the dashboard.
4. **Test 2 (form link):** in the dashboard, send a form link to your own number → you should receive the template with the button.
5. **Test 3 (dashboard status):** the WhatsApp tab should show "Connected" with the business name.

---

## Costs (so you can quote the client)

| What | Cost |
|---|---|
| Setup, verification, templates, webhook | ₹0 (all free from Meta) |
| Customer messages you / AI auto-replies | ₹0 — always free |
| Form link after a call (utility template) | ₹0.115 + GST per message |
| Promo blast to old leads (marketing template) | ₹0.8631 + GST per message |
| New SIM | ₹100–200 one-time + small recharge every few months |

**Example:** 2,000 leads/month = 2,000 form links ≈ **₹271/month incl. GST**. All AI chatting: free.

## Two rules to protect the account
1. **New numbers start limited** (~250 new customers/day, auto-increases to 1K → 10K as quality stays good). Ramp up outbound gradually in week 1.
2. **Watch the quality rating** (WhatsApp Manager → phone number). If too many people block/report the number, Meta restricts it. Priya's polite "remove my number" handling already protects this — never blast people who said stop.
