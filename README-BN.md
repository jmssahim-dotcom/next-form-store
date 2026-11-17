# NEXT FORM — Secure online store setup (বাংলা নির্দেশিকা)

এই project-এ original NEXT FORM storefront design রাখা হয়েছে এবং secure backend integration যোগ করা হয়েছে। এটি deploy-ready starter project; তবে আপনার নিজের Supabase account, SSLCOMMERZ merchant credentials, domain/HTTPS এবং WhatsApp business number না বসালে live admin/payment/contact চালু হবে না।

## কী যোগ করা হয়েছে

- Supabase PostgreSQL shared product catalogue ও shared orders database
- Supabase Auth দিয়ে admin email/password login
- Server-side admin allow-list (`admin_users`) — শুধু অনুমোদিত user product add/edit/delete ও order দেখতে পারবে
- Server-side product price ও stock validation
- Supabase Storage-এ product image upload (JPG/PNG/WebP, সর্বোচ্চ 5 MB)
- SSLCOMMERZ hosted checkout, callback validation এবং IPN endpoint
- Cash on Delivery order option
- Floating WhatsApp contact button এবং order confirmation WhatsApp link
- Online payment credentials, service-role key এবং merchant password শুধু server `.env`-এ থাকে

## ১) প্রয়োজনীয় account

1. Supabase project: https://supabase.com/
2. SSLCOMMERZ merchant/sandbox account: https://developer.sslcommerz.com/
3. Production deployment-এর জন্য HTTPS domain এবং Node.js hosting

## ২) Supabase database তৈরি

1. Supabase Dashboard-এ একটি project তৈরি করুন।
2. SQL Editor খুলুন।
3. `supabase/schema.sql` ফাইলের সম্পূর্ণ SQL paste করে Run করুন।
4. এতে `products`, `orders`, `admin_users`, `product-images` Storage bucket এবং stock/payment functions তৈরি হবে। চারটি demo product-ও যোগ হবে যদি catalogue খালি থাকে।

## ৩) Admin account তৈরি ও অনুমতি দেওয়া

1. Supabase Dashboard → Authentication → Users → Add user-এ আপনার নিজের admin email ও শক্তিশালী password দিয়ে user তৈরি করুন।
2. ঐ user-এর UUID কপি করুন।
3. Supabase SQL Editor-এ নিচের query চালান (UUID-এর জায়গায় আপনার আসল user UUID দিন):

```sql
insert into public.admin_users (user_id)
values ('PASTE-YOUR-AUTH-USER-UUID-HERE');
```

শুধু আপনার বিশ্বস্ত admin account-এর UUID-ই এখানে যোগ করবেন। Admin email/password কাউকে দেবেন না।

## ৪) Environment variables বসান

1. Project folder-এ `.env.example` কপি করে `.env` নামে রাখুন।
2. Supabase Dashboard → Project Settings → API থেকে URL, publishable/anon key এবং server-only `service_role` key বসান।
3. SSLCOMMERZ sandbox/live Store ID ও Store Password বসান।
4. নিজের WhatsApp Business number `WHATSAPP_PHONE`-এ বসান।

উদাহরণ format:

```env
SITE_URL=http://localhost:3000
SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_OR_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_ONLY_SERVICE_ROLE_KEY
SSL_COMMERZ_MODE=sandbox
SSL_COMMERZ_STORE_ID=YOUR_SANDBOX_STORE_ID
SSL_COMMERZ_STORE_PASSWORD=YOUR_SANDBOX_STORE_PASSWORD
WHATSAPP_PHONE=8801XXXXXXXXX
DELIVERY_FEE_BDT=80
```

`WHATSAPP_PHONE`-এ `+`, space বা hyphen দেবেন না। বাংলাদেশের নম্বর `8801...` format-এ লিখুন। `8801XXXXXXXXX` শুধু placeholder—এটি বাস্তব ফোন নম্বর নয়; আপনার নম্বর বসাতে হবে।

**কখনোই `.env`, `SUPABASE_SERVICE_ROLE_KEY` বা `SSL_COMMERZ_STORE_PASSWORD` frontend-এ দেবেন না, GitHub-এ upload করবেন না, বা কারও সঙ্গে public chat-এ শেয়ার করবেন না।**

## ৫) Website চালু করুন

কম্পিউটারে Node.js 22 বা newer install করে terminal-এ project folder খুলুন। Windows-এ `start-local.bat` double-click করেও server চালু করতে পারবেন (প্রথমবার `npm install` হবে):

```bash
npm install
npm start
```

তারপর browser-এ `http://localhost:3000` খুলুন। `index.html`-এ double-click করে `file://` থেকে চালাবেন না; API কাজ করার জন্য server দিয়ে site চালু করতে হবে।

## ৬) Admin panel ব্যবহার

1. Website-এর Admin button চাপুন।
2. Supabase Auth-এ তৈরি করা admin email/password দিয়ে sign in করুন।
3. Product details দিন, ছবি URL দিন বা JPG/PNG/WebP image upload করুন।
4. `Feature on storefront` tick করলে product homepage Featured section-এ দেখাবে।
5. Orders tab-এ customer order ও payment status দেখা যাবে।

কোনো Auth user `admin_users` table-এ না থাকলে সে admin panel ব্যবহার করতে পারবে না।

## ৭) SSLCOMMERZ payment setup

1. প্রথমে SSLCOMMERZ sandbox account ও sandbox Store ID/Password নিন।
2. `.env`-এ `SSL_COMMERZ_MODE=sandbox` রেখে credentials বসান।
3. Website deploy করার পর merchant dashboard-এর IPN Settings-এ এই URL দিন:

```text
https://YOUR-DOMAIN/api/payment/ipn
```

4. Gateway success/fail/cancel callback URL server নিজে তৈরি করে। Site-টি public HTTPS domain-এ deploy থাকতে হবে।
5. Sandbox transaction দিয়ে payment, failed payment, cancel এবং IPN flow পরীক্ষা করুন।
6. SSLCOMMERZ merchant approval ও live credentials পাওয়ার পর `.env`-এ `SSL_COMMERZ_MODE=live` এবং live Store ID/Password দিন।

Payment gateway session এবং validation server থেকে করা হয়। Browser থেকে পাঠানো product price/total বিশ্বাস করা হয় না; server database থেকে price ও stock পুনরায় হিসাব করে। Gateway-এর callback/IPN এলে server validation API-তে `val_id`, transaction, currency ও amount মিলিয়ে তারপর order paid করে। Gateway merchant onboarding/approval ও fees SSLCOMMERZ-এর নিজস্ব শর্তের ওপর নির্ভর করে।

## ৮) WhatsApp contact

Website-এর নিচের ডান পাশে “Chat with us” WhatsApp button থাকবে। `.env`-এর `WHATSAPP_PHONE`-এ আপনার দোকানের WhatsApp নম্বর বসালে customer সরাসরি আপনার WhatsApp-এ message করতে পারবে। Checkout-এর পরে order number-সহ chat link-ও দেখানো হবে।

আপনার আসল WhatsApp number এখনো project-এ দেওয়া হয়নি; তাই `.env.example`-এ placeholder রাখা হয়েছে।

## ৯) Deploy করার আগে checklist

- [ ] Supabase SQL সম্পূর্ণ run হয়েছে
- [ ] নিজের Auth user `admin_users`-এ যোগ করা হয়েছে
- [ ] `.env`-এ সব Supabase values বসানো হয়েছে
- [ ] WhatsApp number ঠিকভাবে বসানো হয়েছে
- [ ] Sandbox payment ও IPN test সফল
- [ ] নিজের product photos, size/price/stock বসানো হয়েছে
- [ ] HTTPS domain ও SSLCOMMERZ IPN URL configure করা হয়েছে
- [ ] Privacy Policy, Terms, Delivery/Returns এবং Contact information যোগ করা হয়েছে
- [ ] Live credentials পাওয়ার পরই production payment চালু করা হয়েছে

## Security and operational notes

- `.env` file version control-এ commit করবেন না।
- Supabase service-role key শুধু server-এ রাখবেন; এটি RLS bypass করতে পারে।
- Database backup ও access control চালু রাখুন।
- Admin user-দের 2FA/password policy Supabase Auth settings থেকে configure করুন।
- COD order stock order তৈরির সময় reserve হয়। COD বাতিল হলে admin-কে stock ফেরত দেওয়ার workflow যোগ/পরিচালনা করতে হবে।
- Refunds, courier tracking, SMS/email notifications, customer accounts, abandoned-cart recovery এবং order status editing এখনো এই starter-এ অন্তর্ভুক্ত নয়।
- Online order-এর amount 10–500,000 BDT সীমায় রাখা হয়েছে; gateway account-এর প্রকৃত সীমা ও merchant configuration আলাদা হতে পারে।


## ৯) Admin password reset

Admin sign-in modal-এ password recovery email থেকে ফিরে এলে এখন recovery token শনাক্ত করে নতুন password ও confirm password form দেখাবে। নতুন password কমপক্ষে ১০ অক্ষরের হতে হবে। Supabase-এর URL Configuration-এ Site URL `http://localhost:3000` এবং Redirect URL `http://localhost:3000/**` রাখুন। Recovery email-এর সর্বশেষ লিংকটি একবারই ব্যবহার করুন; পুরোনো/আগে খোলা লিংক আবার ব্যবহার করবেন না।
