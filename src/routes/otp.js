import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import pool from '../config/db.js';

const router = Router();
const META_API = 'https://graph.facebook.com/v24.0';
const APP_ID = process.env.META_APP_ID;
const APP_SECRET = process.env.META_APP_SECRET;

router.post('/', requireAuth, async (req, res) => {
  try {
    const { action, ...params } = req.body;
    const userId = req.user.id;

    switch (action) {
      case 'get_app_id':
        return res.json({ app_id: APP_ID });

      case 'exchange_token': {
        const { code, waba_id, phone_number_id } = params;
        if (!code) return res.status(400).json({ error: 'Code is required' });

        // 1. Exchange code for user access token
        const tokenRes = await fetch(
          `${META_API}/oauth/access_token?client_id=${APP_ID}&client_secret=${APP_SECRET}&code=${code}`
        );
        const tokenData = await tokenRes.json();
        if (!tokenRes.ok) throw new Error(`Meta Token Error: ${JSON.stringify(tokenData)}`);
        const shortLivedToken = tokenData.access_token;

        // 2. Exchange for long-lived access token
        const llRes = await fetch(
          `${META_API}/oauth/access_token?grant_type=fb_exchange_token&client_id=${APP_ID}&client_secret=${APP_SECRET}&fb_exchange_token=${shortLivedToken}`
        );
        const llData = await llRes.json();
        if (!llRes.ok) throw new Error(`Meta LL Token Error: ${JSON.stringify(llData)}`);
        const accessToken = llData.access_token;

        // 3. Get business info from Meta (optional but nice)
        let metaBusinessId = null;
        try {
          const bizRes = await fetch(`${META_API}/${waba_id}?fields=id,name,message_template_namespace`, {
            headers: { Authorization: `Bearer ${accessToken}` }
          });
          const bizData = await bizRes.json();
          metaBusinessId = bizData?.id;
        } catch (_) {}

        // 4. Upsert business
        const [businesses] = await pool.execute('SELECT id FROM businesses WHERE user_id = ? LIMIT 1', [userId]);
        let businessId = businesses[0]?.id;
        if (!businessId) {
          const [bizResult] = await pool.execute(
            'INSERT INTO businesses (user_id, name, meta_business_id, meta_verification_status) VALUES (?, ?, ?, ?)',
            [userId, `Business ${userId}`, metaBusinessId, 'verified']
          );
          businessId = bizResult.insertId;
        } else {
          await pool.execute(
            'UPDATE businesses SET meta_business_id = ?, meta_verification_status = ? WHERE id = ?',
            [metaBusinessId, 'verified', businessId]
          );
        }

        // 5. Resolve phone number from Meta
        let phoneNumber = null;
        if (phone_number_id) {
          try {
            const pnRes = await fetch(`${META_API}/${phone_number_id}?fields=display_phone_number,verified_name`, {
              headers: { Authorization: `Bearer ${accessToken}` }
            });
            const pnData = await pnRes.json();
            phoneNumber = pnData?.display_phone_number;
          } catch (_) {}
        }

        // 6. Upsert WhatsApp Account
        await pool.execute(
          `INSERT INTO whatsapp_accounts (user_id, business_id, phone_number_id, waba_id, access_token, phone_number, verification_status, webhook_verified) 
           VALUES (?, ?, ?, ?, ?, ?, 'verified', TRUE) 
           ON DUPLICATE KEY UPDATE 
           phone_number_id = VALUES(phone_number_id),
           waba_id = VALUES(waba_id),
           access_token = VALUES(access_token),
           phone_number = VALUES(phone_number),
           verification_status = 'verified',
           webhook_verified = TRUE`,
          [userId, businessId, phone_number_id, waba_id, accessToken, phoneNumber]
        );

        // 7. Auto-subscribe WABA to webhooks
        try {
          await fetch(`${META_API}/${waba_id}/subscribed_apps`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          });
          console.log('WABA subscribed to webhooks');
        } catch (e) {
          console.warn('WABA webhook subscribe failed (non-critical):', e.message);
        }

        return res.json({ success: true, message: 'WhatsApp account connected successfully', phone_number: phoneNumber });
      }

      default:
        return res.status(400).json({ error: 'Unknown action' });
    }
  } catch (err) {
    console.error('OTP/Exchange error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
