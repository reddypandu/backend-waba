import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import User from '../models/User.js';
import WalletTransaction from '../models/WalletTransaction.js';
import crypto from 'crypto';
import { sendWhatsAppMessage, sendTemplateMessage } from '../utils/whatsappNotify.js';

const router = Router();

const normalizePlan = (plan) => {
  return plan === 'paid' ? 'paid' : 'free';
};

const supportedPlans = ['paid'];
const PAID_PLAN_PRICE = 30000; // ₹30,000

router.get('/plans', async (req, res) => {
  res.json({
    free: {
      name: "Free Trial",
      price: 0,
      features: ["10 Contacts", "Connect WhatsApp Business", "Basic Messaging"]
    },
    paid: {
      name: "Paid Plan",
      price: PAID_PLAN_PRICE,
      currency: "INR",
      features: [
        "Send bulk WhatsApp campaigns",
        "Manage chats in a Shared Team Inbox & set up simple greeting / OOO automations",
        "Unlimited Messages (Based on your WhatsApp Number)",
        "Unlimited Contacts",
        "Auto Replies",
        "Auto Work flows"
      ]
    }
  });
});

router.post('/create-order', requireAuth, async (req, res) => {
  try {
    const { plan } = req.body;
    const normalizedPlan = normalizePlan(plan);
    if (!normalizedPlan || !supportedPlans.includes(normalizedPlan)) {
      return res.status(400).json({ error: 'Invalid plan selected' });
    }

    // Fixed price for the Paid Plan
    const orderAmount = PAID_PLAN_PRICE * 100; // Convert to paise

    const credentials = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
    const r = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${credentials}` },
      body: JSON.stringify({ amount: orderAmount, currency: 'INR', receipt: `sub_${Date.now()}`.slice(0, 40), notes: { plan: normalizedPlan, user_id: req.user.id } }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.description || 'Order creation failed');
    res.json({ id: data.id, amount: data.amount, currency: 'INR', key_id: process.env.RAZORPAY_KEY_ID });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/verify-payment', requireAuth, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan, amount } = req.body;
    const normalizedPlan = normalizePlan(plan);
    if (!normalizedPlan || !supportedPlans.includes(normalizedPlan)) {
      return res.status(400).json({ error: 'Invalid plan selected' });
    }
    if (!amount) {
      return res.status(400).json({ error: 'Payment amount is required' });
    }

    const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${razorpay_order_id}|${razorpay_payment_id}`).digest('hex');
    if (expected !== razorpay_signature) return res.status(400).json({ error: 'Signature mismatch' });

    const now = new Date();
    const end = new Date(now);
    end.setFullYear(end.getFullYear() + 1);

    const user = await User.findByIdAndUpdate(req.user.id, {
      'subscription.plan': normalizedPlan,
      'subscription.status': 'active',
      'subscription.messages_used': 0,
      'subscription.start_date': now,
      'subscription.end_date': end,
    }, { new: true });

    await WalletTransaction.create({
      user_id: req.user.id,
      type: 'credit',
      amount,
      balance_after: user.wallet?.balance,
      description: `Subscription payment for ${normalizedPlan} plan`,
      reference_id: razorpay_payment_id,
      status: 'completed',
    });
    res.json({ success: true, plan: normalizedPlan });

    // SaaS WhatsApp notifications (non-blocking, try-catch wrapped)
    (async () => {
      try {
        const istDate = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
        const expiryDateIST = new Date(end).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
        const userPhone = (user.phone || '').replace(/\D/g, '');
        const adminPhone = (process.env.ADMIN_WHATSAPP_NUMBER || '').replace(/\D/g, '');

        // Send to USER — try template first, fall back to plain text if not approved yet
        if (userPhone) {
          try {
            await sendTemplateMessage(userPhone, "upgrade_success", [user.full_name || 'there', expiryDateIST]);
            console.log("[Upgrade Notifications] ✅ Template message sent to user:", userPhone);
          } catch (templateErr) {
            const isTemplateMissing = templateErr.message.includes('132001') || templateErr.message.toLowerCase().includes('template name does not exist');
            if (isTemplateMissing) {
              console.warn("[Upgrade Notifications] ⚠️ Template not approved yet, sending plain text fallback...");
              const fallbackMsg = `💰 Payment Successful - YestickAI!\n\nHi ${user.full_name || 'there'}, your account upgraded to Paid Plan 🎉\n\n✅ Unlimited Contacts\n✅ Bulk WhatsApp Campaigns\n✅ Shared Team Inbox\n✅ Auto Replies & Workflows\n\n📅 Valid Until: ${expiryDateIST}\n💵 Amount: ₹30,000/year\n\n👉 Dashboard: https://yestickai.com/dashboard\n\nThank you for choosing YestickAI! 🚀\nTeam YestickAI`;
              await sendWhatsAppMessage(userPhone, fallbackMsg);
              console.log("[Upgrade Notifications] ✅ Fallback plain text sent to user:", userPhone);
            } else {
              throw templateErr;
            }
          }
        }

        // Send to ADMIN (plain text) — skip if sender & recipient are the same number
        if (adminPhone && adminPhone !== userPhone) {
          const adminMsg = `💰 New Payment - YestickAI!\n\n👤 Name: ${user.full_name || ''}\n📧 Email: ${user.email}\n📱 WhatsApp: ${user.phone}\n💵 Amount: ₹30,000/year\n🔖 Payment ID: ${razorpay_payment_id}\n📅 Date: ${istDate}\n\n👉 https://yestickai.com/admin/users`;
          await sendWhatsAppMessage(adminPhone, adminMsg);
          console.log("[Upgrade Notifications] ✅ Admin payment alert sent");
        }
      } catch (err) {
        console.error("[Upgrade Notifications] Error sending notifications:", err.message);
      }
    })();

  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
