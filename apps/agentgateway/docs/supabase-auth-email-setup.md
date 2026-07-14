# Astrail Production Auth Setup

Use this checklist for the production Supabase project behind Astrail.

The application uses Supabase Auth for:

- Google OAuth
- GitHub OAuth
- passwordless email magic links
- server-side dashboard session checks
- user-owned Supabase rows through RLS

Local demo mode is only active in non-production development when Supabase public env vars are missing. In production, demo auth is disabled, dashboard routes fail closed, and sign-in requires real Supabase Auth with Google/email configured.

After auth is configured, set up paid plans and credit metering with `docs/billing-credits-setup.md`.

## App Environment

Set these in Vercel for Production, Preview, and Development as needed:

```txt
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>
NEXT_PUBLIC_SITE_URL=https://astrail-agentgateway.vercel.app
NEXT_PUBLIC_APP_URL=https://astrail-agentgateway.vercel.app
NEXT_PUBLIC_RUNTIME_BASE_URL=https://astrail-agentgateway.vercel.app
ASTRAIL_APP_URL=https://astrail-agentgateway.vercel.app
ASTRAIL_CORS_ORIGINS=https://astrail-agentgateway.vercel.app
ASTRAIL_REQUIRE_AUTH=true
NEXT_PUBLIC_ASTRAIL_GOOGLE_OAUTH_ENABLED=false
NEXT_PUBLIC_ASTRAIL_GITHUB_OAUTH_ENABLED=false
ANTHROPIC_API_KEY=<anthropic key>
CREDENTIAL_ENCRYPTION_KEY=<32 byte hex key or base64:...>
RATE_LIMIT_MODE=in_memory
```

Use your final product domain instead of `astrail-agentgateway.vercel.app` once DNS is attached.

Generate a credential key:

```bash
openssl rand -hex 32
```

Then redeploy after changing Vercel env vars.

## Required Supabase URLs

In Supabase, open **Authentication -> URL Configuration**.

Set **Site URL** to the domain where the app dashboard runs:

```txt
https://astrail-agentgateway.vercel.app
```

Add these **Redirect URLs**:

```txt
https://astrail-agentgateway.vercel.app/auth/complete
https://astrail-agentgateway.vercel.app/auth/complete?next=%2Fdashboard
https://astrail-agentgateway.vercel.app/api/auth/callback
https://astrail-agentgateway.vercel.app/api/auth/callback?next=%2Fdashboard
http://localhost:3000/auth/complete
http://localhost:3000/auth/complete?next=%2Fdashboard
http://localhost:3000/api/auth/callback
http://localhost:3000/api/auth/callback?next=%2Fdashboard
```

If you use a custom domain, add the same `/auth/complete` and `/api/auth/callback` URLs for that domain too.

## Google OAuth

Open **Authentication -> Providers -> Google** in Supabase and copy the callback URL shown there. It will look like:

```txt
https://<project-ref>.supabase.co/auth/v1/callback
```

In Google Cloud:

1. Create or select a Google Cloud project.
2. Open **APIs & Services -> OAuth consent screen**.
3. Configure app name, support email, developer contact, and publishing status.
4. Open **APIs & Services -> Credentials**.
5. Create **OAuth client ID**.
6. Choose **Web application**.
7. Add Authorized JavaScript origins:

```txt
https://astrail-agentgateway.vercel.app
http://localhost:3000
```

8. Add Authorized redirect URI:

```txt
https://<project-ref>.supabase.co/auth/v1/callback
```

9. Copy the Google Client ID and Client Secret into Supabase **Authentication -> Providers -> Google**.
10. Enable the Google provider and save.
11. Set `NEXT_PUBLIC_ASTRAIL_GOOGLE_OAUTH_ENABLED=true` in Vercel and redeploy.

Important: the Google redirect URI is the Supabase callback URL, not `/api/auth/callback`. Supabase then redirects back to Astrail using the allow-listed app callback URL above.

Production behavior:

```txt
/login -> /api/auth/oauth?provider=google -> Supabase OAuth -> Google account chooser/consent screen -> /auth/complete -> /dashboard
```

The Astrail OAuth route requests `openid email profile` and `prompt=select_account`, so users see the real Google account chooser instead of a demo workspace. If Google does not open, one of these is missing:

```txt
1. NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel
2. NEXT_PUBLIC_ASTRAIL_GOOGLE_OAUTH_ENABLED=true in Vercel
3. Google provider enabled in Supabase
4. Google OAuth Client ID and Client Secret saved in Supabase
5. Supabase callback URL added in Google Authorized redirect URIs
6. Astrail callback URL added in Supabase Redirect URLs
```

## GitHub OAuth

Open **Authentication -> Providers -> GitHub** in Supabase and copy the callback URL. In GitHub Developer Settings, create an OAuth app with:

```txt
Homepage URL: https://astrail-agentgateway.vercel.app
Authorization callback URL: https://<project-ref>.supabase.co/auth/v1/callback
```

Paste the GitHub client ID and secret into Supabase, enable the provider, then set `NEXT_PUBLIC_ASTRAIL_GITHUB_OAUTH_ENABLED=true` in Vercel and redeploy.

## Email Provider

Open **Authentication -> Providers -> Email**.

Enable:

```txt
Confirm email: ON
Secure email change: ON
Magic Link / OTP email sign-in: ON
```

The app calls `/api/auth/otp`. Signup sends `mode=signup` and creates a Supabase user. Login sends `mode=login` and expects the user to already exist.

Email links redirect to `/auth/complete` first because Supabase may return the session in a URL hash such as `#access_token=...`. Server routes cannot read URL hashes; the client completion page saves the session and clears the temporary tokens from the address bar. Keep `/api/auth/callback` allow-listed too because OAuth/code-exchange flows can still use it.

## Custom SMTP

Open **Project Settings -> Authentication -> SMTP Settings**.

Use a real sender so emails do not look like Supabase. Without this, Supabase can still send auth emails, but Gmail will show Supabase as the sender and default sending limits are strict.

```txt
Sender name: Astrail
Sender email: login@astrail.dev
Reply-to: hi@astrail.dev
```

Recommended providers: Resend, Postmark, SendGrid, or Amazon SES.

Do not use a personal Gmail sender for production auth.

For `login@astrail.dev`, the DNS owner must add the SMTP provider's SPF, DKIM, and return-path records. Until DNS verification passes, keep using the Supabase sender for testing only.

## Magic Link Email Template

Open **Authentication -> Email Templates -> Magic Link**.

Subject:

```txt
Log in to Astrail
```

Body:

```html
<div style="margin:0;padding:32px;background:#080906;font-family:Inter,Arial,sans-serif;color:#fff8eb;">
  <div style="max-width:560px;margin:0 auto;border:1px solid rgba(255,255,255,0.14);background:#141510;padding:28px;">
    <div style="display:inline-block;background:#10110d;color:#fff8eb;border:1px solid rgba(255,140,0,0.65);font-weight:800;font-family:monospace;padding:8px 12px;box-shadow:3px 3px 0 rgba(255,140,0,0.34);">A</div>
    <h1 style="margin:24px 0 8px;font-size:28px;line-height:1.1;">Log in to Astrail</h1>
    <p style="margin:0 0 24px;color:#aaa597;font-size:16px;line-height:1.6;">
      Use the secure link below to access your Astrail workspace.
    </p>
    <a href="{{ .ConfirmationURL }}" style="display:block;text-align:center;background:#f8f1e7;color:#080906;text-decoration:none;font-weight:800;padding:14px 18px;box-shadow:4px 4px 0 rgba(255,140,0,0.34);">
      Open Astrail
    </a>
    <p style="margin:28px 0 0;color:#777267;font-size:13px;line-height:1.6;">
      If you did not request this email, you can ignore it.
    </p>
  </div>
</div>
```

## Confirm Signup Email Template

Open **Authentication -> Email Templates -> Confirm signup**.

Subject:

```txt
Confirm your Astrail account
```

Body:

```html
<div style="margin:0;padding:32px;background:#080906;font-family:Inter,Arial,sans-serif;color:#fff8eb;">
  <div style="max-width:560px;margin:0 auto;border:1px solid rgba(255,255,255,0.14);background:#141510;padding:28px;">
    <div style="display:inline-block;background:#10110d;color:#fff8eb;border:1px solid rgba(255,140,0,0.65);font-weight:800;font-family:monospace;padding:8px 12px;box-shadow:3px 3px 0 rgba(255,140,0,0.34);">A</div>
    <h1 style="margin:24px 0 8px;font-size:28px;line-height:1.1;">Confirm your Astrail account</h1>
    <p style="margin:0 0 24px;color:#aaa597;font-size:16px;line-height:1.6;">
      Click below to finish creating your Astrail workspace.
    </p>
    <a href="{{ .ConfirmationURL }}" style="display:block;text-align:center;background:#f8f1e7;color:#080906;text-decoration:none;font-weight:800;padding:14px 18px;box-shadow:4px 4px 0 rgba(255,140,0,0.34);">
      Confirm account
    </a>
    <p style="margin:28px 0 0;color:#777267;font-size:13px;line-height:1.6;">
      If you did not request this email, you can ignore it.
    </p>
  </div>
</div>
```

## Production Smoke Test

After saving the templates and SMTP settings, redeploy Vercel and run:

```bash
curl -s -X POST https://astrail.dev/api/auth/otp \
  -H "Content-Type: application/json" \
  -d '{"email":"your-email@gmail.com","mode":"signup","redirectTo":"/dashboard"}'
```

Expected response:

```json
{"ok":true}
```

The email should come from Astrail, not Supabase.

If clicking the email redirects back to login with an error, check:

```txt
1. The Vercel env vars point to the same Supabase project that sent the email.
2. NEXT_PUBLIC_APP_URL matches the product app domain.
3. The callback URL is allow-listed in Supabase Redirect URLs.
4. You requested a fresh email link after changing Supabase or Vercel settings.
```

If `/api/auth/otp` returns `over_email_send_rate_limit` or HTTP `429`, Supabase is temporarily blocking more auth emails. Stop retrying, wait for the limit window to clear, and request one fresh link. For production, configure custom SMTP so Astrail controls sender reputation and avoids the strict default Supabase mailer limits.

## Google Login Smoke Test

1. Open `/login`.
2. Click **Continue with Google**.
3. Confirm the browser leaves Astrail and opens Google's account chooser or consent screen.
4. Pick a real Google account.
5. Confirm that you land on `/dashboard`.
6. Confirm the lower-left workspace switcher shows the Google account name/email, not `Demo workspace`.
7. Log out and confirm `/dashboard` redirects back to `/login`.

## Production Verification

Run locally with the production env loaded:

```bash
npm run verify:env
npm run verify:schema
npm run lint
npm run build
```

Then verify hosted:

```bash
curl -i https://astrail-agentgateway.vercel.app/dashboard
curl -s https://astrail-agentgateway.vercel.app/api/health
```

The dashboard request should redirect to `/login` when you are not signed in.
