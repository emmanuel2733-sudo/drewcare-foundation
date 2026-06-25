# DrewCare Foundation

Static NGO website with a small Node server for Paystack donations.

## Start the site

PowerShell on this machine blocks `npm.ps1`, so use:

```bash
npm.cmd run dev
```

In Command Prompt, Git Bash, or a normal deployment shell, this also works:

```bash
npm run dev
```

The local URL is configured in `.env`:

```bash
http://localhost:3001
```

## Environment variables

Copy `.env.example` values into `.env` and set your real Paystack secret key:

```bash
PORT=3001
SITE_URL=http://localhost:3001
DONATION_CURRENCY=NGN
PAYSTACK_SECRET_KEY=sk_test_or_sk_live_your_key_here
```

Do not put the Paystack secret key in the HTML file. The browser sends donation details to `/api/donations/initialize`, and `server.js` talks to Paystack securely from the server.

## Donation flow

1. Donor fills the donation form on the homepage.
2. Browser posts to `/api/donations/initialize`.
3. Server initializes the Paystack transaction.
4. Donor is redirected to Paystack checkout.
5. Paystack returns to `/donation-success.html`.
6. Success page calls `/api/donations/verify?reference=...`.

The contact form and newsletter form are still visual only.
