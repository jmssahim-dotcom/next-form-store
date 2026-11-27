import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createClient } from '@supabase/supabase-js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import multer from 'multer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const app = express();
const PORT = Number(process.env.PORT || 3000);
const SITE_URL = (process.env.SITE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const DELIVERY_FEE = Math.max(0, Math.round(Number(process.env.DELIVERY_FEE_BDT || 80) || 0));
const supabaseReady = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY);
const supabase = supabaseReady
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;
const authClient = supabaseReady
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;
const imageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: (_req, file, cb) => {
  cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype));
} });
const modelUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many login attempts. Try again later.' } });
const checkoutLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 12, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many checkout attempts. Please wait a moment.' } });

function requireDatabase(req, res, next) {
  if (!supabase) return res.status(503).json({ error: 'Backend is not configured yet. Complete the Supabase settings in .env.' });
  next();
}

function mapProduct(row) {
  return {
    id: row.id, name: row.name, category: row.category, price: Number(row.price), oldPrice: Number(row.old_price || 0),
    stock: Number(row.stock || 0), sizes: row.sizes || [], image: row.image_url, imageNoModel: row.image_url_no_model || '', description: row.description || '',
    color: row.color || '', featured: Boolean(row.featured), created: new Date(row.created_at).getTime()
  };
}

const SOCIAL_PROFILE_HOSTS = {
  facebook: new Set(['facebook.com', 'www.facebook.com', 'm.facebook.com']),
  instagram: new Set(['instagram.com', 'www.instagram.com']),
  tiktok: new Set(['tiktok.com', 'www.tiktok.com'])
};

function validateSocialLinks(input) {
  const links = {};
  for (const platform of Object.keys(SOCIAL_PROFILE_HOSTS)) {
    const value = typeof input?.[platform] === 'string' ? input[platform].trim() : '';
    if (value.length > 2048) return { error: 'Social profile URLs must be 2048 characters or less.' };
    if (!value) {
      links[platform] = '';
      continue;
    }

    let url;
    try { url = new URL(value); } catch { return { error: `Enter a valid ${platform} profile URL.` }; }
    if (url.protocol !== 'https:' || !SOCIAL_PROFILE_HOSTS[platform].has(url.hostname.toLowerCase()) || url.username || url.password) {
      return { error: `Enter a valid HTTPS ${platform} profile URL.` };
    }
    links[platform] = url.toString();
  }
  return { links };
}

function getBearer(req) {
  const value = req.headers.authorization || '';
  return value.startsWith('Bearer ') ? value.slice(7) : '';
}

async function requireAdmin(req, res, next) {
  try {
    if (!supabase) return res.status(503).json({ error: 'Supabase is not configured.' });
    const token = getBearer(req);
    if (!token) return res.status(401).json({ error: 'Please sign in as a store administrator.' });
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ error: 'Your admin session is invalid or expired. Sign in again.' });
    const { data: adminRow, error } = await supabase.from('admin_users').select('user_id').eq('user_id', user.id).maybeSingle();
    if (error || !adminRow) return res.status(403).json({ error: 'This account does not have store administrator access.' });
    req.adminUser = user;
    next();
  } catch (error) {
    console.error('Admin auth error:', error.message);
    res.status(500).json({ error: 'Could not verify administrator access.' });
  }
}

app.get('/api/config', (_req, res) => {
  const phone = String(process.env.WHATSAPP_PHONE || '').replace(/\D/g, '');
  res.json({
    backendReady: supabaseReady,
    supabaseUrl: supabaseReady ? process.env.SUPABASE_URL : '',
    supabaseAnonKey: supabaseReady ? process.env.SUPABASE_ANON_KEY : '',
    whatsappPhone: /^\d{10,15}$/.test(phone) ? phone : '',
    deliveryFee: DELIVERY_FEE,
    onlinePaymentConfigured: Boolean(process.env.SSL_COMMERZ_STORE_ID && process.env.SSL_COMMERZ_STORE_PASSWORD)
  });
});

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'NEXT FORM commerce API', databaseConfigured: supabaseReady }));

app.get('/api/products', requireDatabase, async (_req, res) => {
  const { data, error } = await supabase.from('products').select('*').eq('is_active', true).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Could not load products.' });
  res.json(data.map(mapProduct));
});

app.get('/api/hero-product', requireDatabase, async (_req, res) => {
  const { data, error } = await supabase.from('storefront_settings').select('hero_product_id,hero_model_url').eq('id', true).maybeSingle();
  if (error) {
    console.error('Homepage product read:', error.message);
    return res.status(503).json({ error: 'Apply the homepage product database migration to enable this setting.' });
  }
  res.json({ productId: data?.hero_product_id || null, modelUrl: data?.hero_model_url || null });
});

app.get('/api/admin/hero-product', requireAdmin, async (_req, res) => {
  const { data, error } = await supabase.from('storefront_settings').select('hero_product_id,hero_model_url').eq('id', true).maybeSingle();
  if (error) {
    console.error('Admin homepage product read:', error.message);
    return res.status(503).json({ error: 'Apply the homepage product database migration to enable this setting.' });
  }
  res.json({ productId: data?.hero_product_id || '', modelUrl: data?.hero_model_url || '' });
});

app.put('/api/admin/hero-product', requireAdmin, async (req, res) => {
  const productId = typeof req.body?.productId === 'string' ? req.body.productId.trim() : '';
  const modelUrl = typeof req.body?.modelUrl === 'string' ? req.body.modelUrl.trim() : '';
  if (modelUrl) {
    let parsedModelUrl;
    try { parsedModelUrl = new URL(modelUrl); } catch { return res.status(400).json({ error: 'Upload a valid 3D model first.' }); }
    const expectedHost = new URL(process.env.SUPABASE_URL).host;
    if (parsedModelUrl.protocol !== 'https:' || parsedModelUrl.host !== expectedHost || !parsedModelUrl.pathname.includes('/storage/v1/object/public/3d-models/')) {
      return res.status(400).json({ error: 'Choose a 3D model uploaded to the NEXT FORM model library.' });
    }
  }
  if (productId) {
    const { data: product, error: productError } = await supabase.from('products').select('id').eq('id', productId).eq('is_active', true).maybeSingle();
    if (productError) return res.status(500).json({ error: 'Could not verify the selected product.' });
    if (!product) return res.status(400).json({ error: 'Choose an available product from the catalogue.' });
  }
  const { data, error } = await supabase.from('storefront_settings').upsert({
    id: true,
    hero_product_id: productId || null,
    hero_model_url: modelUrl || null,
    updated_at: new Date().toISOString()
  }).select('hero_product_id,hero_model_url').single();
  if (error) {
    console.error('Homepage product save:', error.message);
    return res.status(503).json({ error: 'Could not save. Apply the homepage product database migration first.' });
  }
  res.json({ productId: data.hero_product_id || '', modelUrl: data.hero_model_url || '' });
});

app.post('/api/admin/upload-3d-model', requireAdmin, modelUpload.single('model'), async (req, res) => {
  const buffer = req.file?.buffer;
  if (!buffer || buffer.length < 20 || buffer.toString('ascii', 0, 4) !== 'glTF') {
    return res.status(400).json({ error: 'Choose a valid binary .glb 3D model (maximum 20 MB).' });
  }
  const objectPath = `${new Date().toISOString().slice(0, 10)}/${randomBytes(12).toString('hex')}.glb`;
  const { error } = await supabase.storage.from('3d-models').upload(objectPath, buffer, { contentType: 'model/gltf-binary', upsert: false, cacheControl: '31536000' });
  if (error) {
    console.error('3D model upload:', error.message);
    return res.status(500).json({ error: 'Could not upload the model. Apply the 3D model database migration first.' });
  }
  const { data } = supabase.storage.from('3d-models').getPublicUrl(objectPath);
  res.json({ modelUrl: data.publicUrl });
});

app.post('/api/admin/login', loginLimiter, requireDatabase, async (req, res) => {
  const email = String(req.body?.email || '').trim();
  const password = String(req.body?.password || '');
  if (!email || !password || password.length > 256) return res.status(400).json({ error: 'Enter your administrator email and password.' });
  try {
    const { data, error } = await authClient.auth.signInWithPassword({ email, password });
    if (error || !data?.session || !data?.user) return res.status(401).json({ error: 'Email or password is incorrect.' });
    const { data: adminRow, error: adminError } = await supabase.from('admin_users').select('user_id').eq('user_id', data.user.id).maybeSingle();
    if (adminError || !adminRow) {
      await authClient.auth.signOut();
      return res.status(403).json({ error: 'This account is not authorised as a NEXT FORM administrator.' });
    }
    res.json({ accessToken: data.session.access_token, refreshToken: data.session.refresh_token, expiresAt: data.session.expires_at, user: { id: data.user.id, email: data.user.email } });
  } catch (error) {
    res.status(500).json({ error: 'Could not sign in. Please try again.' });
  }
});


// Complete a Supabase email password-recovery flow. Recovery tokens are supplied
// by Supabase in the URL hash and are never sent to the server until this form submits.
app.post('/api/auth/update-password', loginLimiter, requireDatabase, async (req, res) => {
  const accessToken = String(req.body?.accessToken || '');
  const refreshToken = String(req.body?.refreshToken || '');
  const password = String(req.body?.password || '');
  if (!accessToken || !refreshToken) return res.status(400).json({ error: 'The recovery link is missing or expired. Request a new password reset email.' });
  if (password.length < 10 || password.length > 128) return res.status(400).json({ error: 'Choose a password between 10 and 128 characters.' });
  try {
    const recoveryClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const { data: sessionData, error: sessionError } = await recoveryClient.auth.setSession({
      access_token: accessToken, refresh_token: refreshToken
    });
    if (sessionError || !sessionData?.session) {
      return res.status(400).json({ error: 'This password reset link is invalid or expired. Request a new one.' });
    }
    const { data, error } = await recoveryClient.auth.updateUser({ password });
    if (error || !data?.user) {
      return res.status(400).json({ error: error?.message || 'Could not update the password. Please request a new reset link.' });
    }
    res.json({ ok: true });
  } catch (error) {
    console.error('Password recovery error:', error.message);
    res.status(500).json({ error: 'Could not update the password. Please try again.' });
  }
});

app.post('/api/admin/refresh', requireDatabase, async (req, res) => {
  const refreshToken = String(req.body?.refreshToken || '');
  if (!refreshToken) return res.status(400).json({ error: 'Missing refresh token.' });
  const { data, error } = await authClient.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data?.session || !data?.user) return res.status(401).json({ error: 'Admin session expired. Sign in again.' });
  const { data: adminRow } = await supabase.from('admin_users').select('user_id').eq('user_id', data.user.id).maybeSingle();
  if (!adminRow) return res.status(403).json({ error: 'This account is not authorised as an administrator.' });
  res.json({ accessToken: data.session.access_token, refreshToken: data.session.refresh_token, expiresAt: data.session.expires_at, user: { id: data.user.id, email: data.user.email } });
});

app.post('/api/admin/upload', requireAdmin, imageUpload.single('image'), async (req, res) => {
  if (!req.file || !['image/jpeg', 'image/png', 'image/webp'].includes(req.file.mimetype)) return res.status(400).json({ error: 'Upload a JPG, PNG or WebP image (maximum 5 MB).' });
  const extension = req.file.mimetype === 'image/png' ? 'png' : req.file.mimetype === 'image/webp' ? 'webp' : 'jpg';
  const objectPath = `${new Date().toISOString().slice(0, 10)}/${randomBytes(12).toString('hex')}.${extension}`;
  const { error } = await supabase.storage.from('product-images').upload(objectPath, req.file.buffer, { contentType: req.file.mimetype, upsert: false, cacheControl: '31536000' });
  if (error) return res.status(500).json({ error: 'Could not upload image. Check the product-images Storage bucket.' });
  const { data } = supabase.storage.from('product-images').getPublicUrl(objectPath);
  res.json({ imageUrl: data.publicUrl });
});

app.get('/api/admin/me', requireAdmin, (req, res) => res.json({ id: req.adminUser.id, email: req.adminUser.email }));

async function readSocialLinks(res) {
  const { data, error } = await supabase.from('store_social_links')
    .select('facebook,instagram,tiktok')
    .eq('id', true)
    .maybeSingle();
  if (error) {
    console.error('Social links read:', error.message);
    return res.status(500).json({ error: 'Could not load social links. Apply the social links database migration.' });
  }
  res.json({ facebook: data?.facebook || '', instagram: data?.instagram || '', tiktok: data?.tiktok || '' });
}

app.get('/api/social-links', requireDatabase, async (_req, res) => readSocialLinks(res));
app.get('/api/admin/social-links', requireAdmin, async (_req, res) => readSocialLinks(res));

app.put('/api/admin/social-links', requireAdmin, async (req, res) => {
  const validated = validateSocialLinks(req.body);
  if (validated.error) return res.status(400).json({ error: validated.error });

  const { data, error } = await supabase.from('store_social_links').upsert({
    id: true,
    ...validated.links,
    updated_at: new Date().toISOString()
  }).select('facebook,instagram,tiktok').single();
  if (error) {
    console.error('Social links save:', error.message);
    return res.status(500).json({ error: 'Could not save social links. Apply the social links database migration.' });
  }
  res.json({ facebook: data.facebook || '', instagram: data.instagram || '', tiktok: data.tiktok || '' });
});

app.get('/api/admin/orders', requireAdmin, async (_req, res) => {
  const { data, error } = await supabase.from('orders').select('*').order('created_at', { ascending: false }).limit(300);
  if (error) return res.status(500).json({ error: 'Could not load orders.' });
  res.json(data.map(o => ({
    id: o.order_number, created: o.created_at, customer: o.customer, items: o.items,
    subtotal: Number(o.subtotal ?? 0), deliveryFee: Number(o.delivery_fee ?? 0),
    total: Number(o.total), transactionId: o.transaction_id || '',
    status: o.order_status, paymentStatus: o.payment_status, paymentMethod: o.payment_method
  })));
});

app.post('/api/admin/products', requireAdmin, async (req, res) => {
  const p = req.body || {};
  let imageUrl;
  try { imageUrl = new URL(String(p.image || '')); } catch { imageUrl = null; }
  let imageNoModelUrl;
  try { imageNoModelUrl = new URL(String(p.imageNoModel || '')); } catch { imageNoModelUrl = null; }
  if (!p.name || !p.category || !imageUrl || imageUrl.protocol !== 'https:' || !imageNoModelUrl || imageNoModelUrl.protocol !== 'https:' || !Number.isFinite(Number(p.price)) || Number(p.price) < 1 || !Number.isInteger(Number(p.stock)) || Number(p.stock) < 0) {
    return res.status(400).json({ error: 'Name, category, model photo, product-only photo, valid price and stock are required.' });
  }
  const row = {
    ...(p.id ? { id: p.id } : {}), name: String(p.name).trim().slice(0, 120), category: String(p.category).slice(0, 60),
    price: Math.round(Number(p.price)), old_price: Math.max(0, Math.round(Number(p.oldPrice || 0))),
    stock: Number(p.stock), sizes: Array.isArray(p.sizes) ? p.sizes.map(String).slice(0, 20) : [],
    image_url: imageUrl.toString(), image_url_no_model: imageNoModelUrl.toString(), description: String(p.description || '').slice(0, 3000), color: String(p.color || '').slice(0, 120),
    featured: Boolean(p.featured), is_active: true
  };
  const { data, error } = await supabase.from('products').upsert(row).select('*').single();
  if (error) {
    console.error('Product save:', error.message);
    return res.status(400).json({ error: 'Could not save product. Check the product ID and database schema.' });
  }
  res.json(mapProduct(data));
});

app.delete('/api/admin/products/:id', requireAdmin, async (req, res) => {
  const { error } = await supabase.from('products').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: 'Could not delete this product.' });
  res.json({ ok: true });
});

function sslBase() {
  return process.env.SSL_COMMERZ_MODE === 'live' ? 'https://securepay.sslcommerz.com' : 'https://sandbox.sslcommerz.com';
}

async function validateSslPayment(valId) {
  const base = sslBase();
  const url = new URL('/validator/api/validationserverAPI.php', base);
  url.searchParams.set('val_id', valId);
  url.searchParams.set('store_id', process.env.SSL_COMMERZ_STORE_ID || '');
  url.searchParams.set('store_passwd', process.env.SSL_COMMERZ_STORE_PASSWORD || '');
  url.searchParams.set('format', 'json');
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('Payment validation service returned an error.');
  return response.json();
}

async function verifyAndCompletePayment(valId) {
  if (!valId) throw new Error('Missing payment validation ID.');
  const validation = await validateSslPayment(valId);
  if (!['VALID', 'VALIDATED'].includes(validation.status)) throw new Error('Payment has not been validated as successful.');
  const tranId = validation.tran_id;
  const { data: order, error } = await supabase.from('orders').select('id,total,payment_status,transaction_id').eq('transaction_id', tranId).single();
  if (error || !order) throw new Error('Payment transaction does not match a known store order.');
  const amount = Number(validation.amount);
  if (validation.currency !== 'BDT' || Math.abs(amount - Number(order.total)) > 0.01) throw new Error('Payment amount or currency did not match the order.');
  if (String(validation.risk_level) === '1') {
    await supabase.from('orders').update({ payment_status: 'manual_review', gateway_validation: validation }).eq('id', order.id);
    return { orderId: order.id, review: true };
  }
  const { error: finalizeError } = await supabase.rpc('nf_finalize_paid_order', { p_order_id: order.id, p_val_id: valId, p_gateway_validation: validation });
  if (finalizeError) throw new Error(`Order finalization failed: ${finalizeError.message}`);
  return { orderId: order.id, review: false };
}

app.post('/api/checkout', checkoutLimiter, requireDatabase, async (req, res) => {
  try {
    const { customer, items, paymentMethod } = req.body || {};
    if (!customer?.name || !customer?.phone || !customer?.address || !customer?.city || !Array.isArray(items) || !items.length || items.length > 30) {
      return res.status(400).json({ error: 'Please provide your delivery details and at least one product.' });
    }
    if (!['sslcommerz', 'cod'].includes(paymentMethod)) return res.status(400).json({ error: 'Select online payment or cash on delivery.' });
    if (paymentMethod === 'sslcommerz' && process.env.SSL_COMMERZ_MODE === 'live' && !SITE_URL.startsWith('https://')) return res.status(503).json({ error: 'Live payment requires your deployed HTTPS website URL in SITE_URL.' });
    if (paymentMethod === 'sslcommerz' && (!process.env.SSL_COMMERZ_STORE_ID || !process.env.SSL_COMMERZ_STORE_PASSWORD)) {
      return res.status(503).json({ error: 'Online payment is not configured yet. Please choose cash on delivery or contact the store.' });
    }
    if (paymentMethod === 'sslcommerz' && !customer.email) return res.status(400).json({ error: 'Email is required for the online payment gateway.' });

    const quantities = new Map();
    for (const item of items) {
      if (!item?.id || !Number.isInteger(Number(item.qty)) || Number(item.qty) < 1 || Number(item.qty) > 10 || !item.size) return res.status(400).json({ error: 'Invalid product quantity or size.' });
      const id = String(item.id);
      quantities.set(id, (quantities.get(id) || 0) + Number(item.qty));
    }
    const ids = [...quantities.keys()];
    const { data: products, error: productError } = await supabase.from('products').select('id,name,price,stock,sizes,image_url').in('id', ids).eq('is_active', true);
    if (productError || products.length !== ids.length) return res.status(400).json({ error: 'One or more products are no longer available.' });
    const orderItems = [];
    let subtotal = 0;
    for (const product of products) {
      const productLines = items.filter(x => String(x.id) === product.id);
      const qty = quantities.get(product.id);
      if (qty > product.stock) return res.status(409).json({ error: `${product.name} does not have enough stock.` });
      const sizes = product.sizes || [];
      for (const line of productLines) {
        if (sizes.length && !sizes.includes(line.size)) return res.status(400).json({ error: `Invalid size selected for ${product.name}.` });
        const lineQty = Number(line.qty);
        subtotal += Number(product.price) * lineQty;
        orderItems.push({ product_id: product.id, name: product.name, size: String(line.size), qty: lineQty, price: Number(product.price), image: product.image_url });
      }
    }
    const total = subtotal + DELIVERY_FEE;
    if (paymentMethod === 'sslcommerz' && (total < 10 || total > 500000)) return res.status(400).json({ error: 'Online payment amount must be between ৳10 and ৳500,000.' });
    const orderNumber = `NF-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`;
    const tranId = `NF${Date.now()}${randomBytes(3).toString('hex')}`.slice(0, 30);
    const customerData = {
      name: String(customer.name).trim().slice(0, 100), phone: String(customer.phone).trim().slice(0, 25),
      email: String(customer.email || '').trim().slice(0, 150), address: String(customer.address).trim().slice(0, 500),
      city: String(customer.city).trim().slice(0, 100)
    };
    const { data: order, error: orderError } = await supabase.from('orders').insert({
      order_number: orderNumber, transaction_id: tranId, customer: customerData, items: orderItems,
      subtotal, delivery_fee: DELIVERY_FEE, total, payment_method: paymentMethod,
      payment_status: paymentMethod === 'cod' ? 'unpaid' : 'pending', order_status: 'new'
    }).select('*').single();
    if (orderError) throw new Error('Could not create the order in the database.');

    if (paymentMethod === 'cod') {
      const { error: reserveError } = await supabase.rpc('nf_confirm_cod_order', { p_order_id: order.id });
      if (reserveError) {
        await supabase.from('orders').update({ order_status: 'stock_error' }).eq('id', order.id);
        throw new Error('The selected items are no longer available in the requested quantity. Please refresh your bag.');
      }
      return res.json({ orderNumber: order.order_number, paymentMethod: 'cod', total, whatsappMessage: `Hello NEXT FORM, I placed order ${order.order_number}. Please confirm delivery.` });
    }

    const base = sslBase();
    const form = new URLSearchParams({
      store_id: process.env.SSL_COMMERZ_STORE_ID, store_passwd: process.env.SSL_COMMERZ_STORE_PASSWORD,
      total_amount: total.toFixed(2), currency: 'BDT', tran_id: tranId,
      success_url: `${SITE_URL}/api/payment/success`, fail_url: `${SITE_URL}/api/payment/fail`, cancel_url: `${SITE_URL}/api/payment/cancel`,
      ipn_url: `${SITE_URL}/api/payment/ipn`, cus_name: customerData.name, cus_email: customerData.email,
      cus_add1: customerData.address.slice(0, 50), cus_city: customerData.city.slice(0, 50), cus_postcode: '0000',
      cus_country: 'Bangladesh', cus_phone: customerData.phone, shipping_method: 'NO', num_of_item: String(orderItems.reduce((n, i) => n + i.qty, 0)),
      product_name: orderItems.map(i => i.name).join(', ').slice(0, 250), product_category: 'clothing', product_profile: 'physical-goods',
      value_a: order.id
    });
    const gatewayResponse = await fetch(`${base}/gwprocess/v4/api.php`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form, signal: AbortSignal.timeout(20000) });
    const gateway = await gatewayResponse.json();
    if (!gatewayResponse.ok || gateway.status !== 'SUCCESS' || !gateway.GatewayPageURL) {
      await supabase.from('orders').update({ payment_status: 'initiation_failed' }).eq('id', order.id);
      throw new Error(gateway.failedreason || 'Could not start the payment gateway session.');
    }
    await supabase.from('orders').update({ gateway_session_key: gateway.sessionkey || null }).eq('id', order.id);
    res.json({ gatewayUrl: gateway.GatewayPageURL, orderNumber: order.order_number, total });
  } catch (error) {
    console.error('Checkout error:', error.message);
    res.status(400).json({ error: error.message || 'Could not complete checkout.' });
  }
});

async function paymentCallback(req, res, isIpn = false) {
  try {
    const incomingStatus = String(req.body?.status || req.query?.status || '').toUpperCase();
    const tranId = String(req.body?.tran_id || req.query?.tran_id || '');
    if (isIpn && ['FAILED', 'CANCELLED', 'CANCELED'].includes(incomingStatus)) {
      if (tranId) {
        const paymentStatus = incomingStatus === 'FAILED' ? 'failed' : 'cancelled';
        await supabase.from('orders').update({ payment_status: paymentStatus }).eq('transaction_id', tranId).eq('payment_status', 'pending');
      }
      return res.status(200).send('Non-success IPN recorded');
    }
    const valId = req.body?.val_id || req.query?.val_id;
    const result = await verifyAndCompletePayment(valId);
    if (isIpn) return res.status(200).send('IPN received and validated');
    return res.redirect(`${SITE_URL}/?payment=${result.review ? 'review' : 'success'}`);
  } catch (error) {
    console.error('Payment validation error:', error.message);
    if (isIpn) return res.status(400).send('Payment not validated');
    return res.redirect(`${SITE_URL}/?payment=not-confirmed`);
  }
}
app.post('/api/payment/ipn', (req, res) => paymentCallback(req, res, true));
app.post('/api/payment/success', (req, res) => paymentCallback(req, res, false));
app.get('/api/payment/success', (req, res) => paymentCallback(req, res, false));
async function markPaymentOutcome(req, outcome) {
  const tranId = String(req.body?.tran_id || req.query?.tran_id || '');
  if (tranId && supabase) {
    await supabase.from('orders').update({ payment_status: outcome }).eq('transaction_id', tranId).eq('payment_status', 'pending');
  }
}
app.post('/api/payment/fail', async (req, res) => { await markPaymentOutcome(req, 'failed'); res.redirect(`${SITE_URL}/?payment=failed`); });
app.get('/api/payment/fail', async (req, res) => { await markPaymentOutcome(req, 'failed'); res.redirect(`${SITE_URL}/?payment=failed`); });
app.post('/api/payment/cancel', async (req, res) => { await markPaymentOutcome(req, 'cancelled'); res.redirect(`${SITE_URL}/?payment=cancelled`); });
app.get('/api/payment/cancel', async (req, res) => { await markPaymentOutcome(req, 'cancelled'); res.redirect(`${SITE_URL}/?payment=cancelled`); });

app.use(express.static(path.join(rootDir, 'public'), { extensions: ['html'] }));
app.get('*', (_req, res) => res.sendFile(path.join(rootDir, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`NEXT FORM server listening on ${SITE_URL}`);
  if (!supabaseReady) console.warn('Supabase is not configured. Copy .env.example to .env and fill the Supabase values.');
});
