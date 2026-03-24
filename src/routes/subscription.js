import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import User from '../models/User.js';
import WalletTransaction from '../models/WalletTransaction.js';
import crypto from 'crypto';

const router = Router();

router.post('/create-order', requireAuth, async (req, res) => {
  try {
    const { plan, amount } = req.body;
    if (!plan || !amount) return res.status(400).json({ error: 'plan and amount required' });
    const credentials = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
    const r = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${credentials}` },
      body: JSON.stringify({ amount, currency: 'INR', receipt: `sub_${Date.now()}`.slice(0, 40), notes: { plan, user_id: req.user.id } }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.description || 'Order creation failed');
    res.json({ id: data.id, amount: data.amount, currency: 'INR' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/verify-payment', requireAuth, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan } = req.body;
    const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${razorpay_order_id}|${razorpay_payment_id}`).digest('hex');
    if (expected !== razorpay_signature) return res.status(400).json({ error: 'Signature mismatch' });

    const now = new Date();
    const end = new Date(now);
    end.setMonth(end.getMonth() + 1);

    await User.findByIdAndUpdate(req.user.id, {
      'subscription.plan': plan,
      'subscription.status': 'active',
      'subscription.messages_used': 0,
      'subscription.start_date': now,
      'subscription.end_date': end,
    });

    res.json({ success: true, plan });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
