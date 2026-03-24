import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import crypto from 'crypto';
import User from '../models/User.js';
import WalletTransaction from '../models/WalletTransaction.js';

const router = Router();

const createRazorpayOrder = async (amountPaise, userId, purpose) => {
  const credentials = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
  const r = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${credentials}` },
    body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt: `${purpose}_${Date.now()}`.slice(0, 40), notes: { user_id: userId } }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error?.description || 'Failed to create order');
  return data;
};

const verifyRazorpaySignature = (orderId, paymentId, signature) => {
  const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
  return expected === signature;
};

// ── Wallet Recharge ───────────────────────────────────────────────────────────
router.post('/create-order', requireAuth, async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || amount < 10) return res.status(400).json({ error: 'Minimum recharge is ₹10' });
    const order = await createRazorpayOrder(Math.round(amount * 100), req.user.id, 'wallet');
    res.json({ id: order.id, amount: order.amount, currency: 'INR', key_id: process.env.RAZORPAY_KEY_ID });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/verify-payment', requireAuth, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, amount } = req.body;
    if (!verifyRazorpaySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
      return res.status(400).json({ error: 'Payment verification failed' });
    }
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $inc: { 'wallet.balance': amount } },
      { new: true }
    );
    await WalletTransaction.create({
      user_id: req.user.id, type: 'recharge', amount,
      balance_after: user.wallet.balance,
      description: `Wallet recharge of ₹${amount}`,
      reference_id: razorpay_payment_id,
    });
    res.json({ success: true, balance: user.wallet.balance });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Aliases for /order and /verify
router.post('/order', (req, res, next) => { req.url = '/create-order'; next(); });
router.post('/verify', (req, res, next) => { req.url = '/verify-payment'; next(); });

export default router;
