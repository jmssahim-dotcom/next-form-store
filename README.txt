NEXT FORM — Secure commerce starter

IMPORTANT: This project now requires a Node.js server. Do NOT open index.html directly from file://.

Quick start
1. Install Node.js 22+ (Windows users can run start-local.bat after editing .env).
2. Copy .env.example to .env and add your Supabase, SSLCOMMERZ sandbox, and WhatsApp details.
3. In Supabase SQL Editor, run supabase/schema.sql.
4. Create your admin in Supabase Authentication > Users, then add that user's UUID to public.admin_users (instructions in README-BN.md).
5. Run: npm install
6. Run: npm start
7. Open: http://localhost:3000

Included
- Existing NEXT FORM responsive storefront UI.
- Shared Supabase product and order database.
- Secure allow-listed admin authentication.
- Admin product add/edit/delete, featured homepage toggle and cloud image upload.
- Server-side price/stock validation.
- SSLCOMMERZ hosted checkout, validation API and IPN callback.
- Cash on delivery.
- WhatsApp contact button and order chat link.

Before going live
- Replace placeholder values in .env with your own keys and phone number.
- Use HTTPS, test with SSLCOMMERZ sandbox, configure the gateway IPN URL, and only then switch to live merchant credentials.
- Never expose SUPABASE_SERVICE_ROLE_KEY or SSL_COMMERZ_STORE_PASSWORD in browser code or source control.
- See README-BN.md for the full setup guide.
