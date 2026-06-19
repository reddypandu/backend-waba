import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Otp from '../models/Otp.js';
import WhatsAppAccount from '../models/WhatsAppAccount.js';
import Contact from '../models/Contact.js';
import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import Template from '../models/Template.js';
import { sendOtpEmail } from '../utils/mailer.js';
import { normalizePhone } from '../utils/phoneUtils.js';
import { sendWhatsAppMessage, sendTemplateMessage } from '../utils/whatsappNotify.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret';
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v22.0';
const META_API = `https://graph.facebook.com/${GRAPH_VERSION}`;

const isValidPhone = (phone) => /^\d{10,15}$/.test(phone);

const getTemplateBodyPlaceholderCount = (templateRecord) => {
  const body = templateRecord?.components?.find((component) => component.type === 'BODY');
  const text = body?.text || templateRecord?.body_text || '';
  const matches = text.match(/\{\{\s*\d+\s*\}\}/g);
  return matches?.length || 0;
};

const buildWelcomeTemplateComponents = async (adminUserId, templateName, registeredUser) => {
  const templateRecord = await Template.findOne({
    user_id: adminUserId,
    name: templateName,
  }).lean();
  const bodyPlaceholderCount = getTemplateBodyPlaceholderCount(templateRecord);

  if (!bodyPlaceholderCount) return [];

  const values = [
    registeredUser.full_name || 'there',
    registeredUser.email || '',
    registeredUser.phone || '',
  ];

  return [
    {
      type: 'body',
      parameters: Array.from({ length: bodyPlaceholderCount }, (_, index) => ({
        type: 'text',
        text: values[index] || values[0],
      })),
    },
  ];
};

const getAdminWhatsAppAccount = async () => {
  const configuredAdminId = process.env.ADMIN_WHATSAPP_USER_ID;
  if (configuredAdminId) {
    const configuredAccount = await WhatsAppAccount.findOne({
      user_id: configuredAdminId,
      phone_number_id: { $exists: true, $ne: '' },
      access_token: { $exists: true, $ne: '' },
    });
    if (configuredAccount) return configuredAccount;
  }

  const admins = await User.find({ role: 'admin' }).select('_id').sort({ createdAt: 1 });
  if (!admins.length) return null;

  return WhatsAppAccount.findOne({
    user_id: { $in: admins.map((admin) => admin._id) },
    phone_number_id: { $exists: true, $ne: '' },
    access_token: { $exists: true, $ne: '' },
  });
};

const sendWelcomeWhatsApp = async (registeredUser) => {
  if (!registeredUser.phone) return;

  const adminWaAccount = await getAdminWhatsAppAccount();
  if (!adminWaAccount) {
    console.warn('[Signup Welcome] No connected admin WhatsApp account found.');
    return;
  }

  const recipientPhone = normalizePhone(registeredUser.phone);
  if (!isValidPhone(recipientPhone)) {
    console.warn('[Signup Welcome] Invalid recipient phone:', registeredUser.phone);
    return;
  }

  const welcomeMessage =
    process.env.WELCOME_WHATSAPP_MESSAGE ||
    `Welcome to Yestick, ${registeredUser.full_name || 'there'}! Your account is ready.`;
  const welcomeTemplateName = process.env.WELCOME_WHATSAPP_TEMPLATE_NAME;
  const welcomeTemplateLanguage = process.env.WELCOME_WHATSAPP_TEMPLATE_LANGUAGE || 'en_US';
  const endpoint = `${META_API}/${adminWaAccount.phone_number_id}/messages`;
  const templateComponents = welcomeTemplateName
    ? await buildWelcomeTemplateComponents(adminWaAccount.user_id, welcomeTemplateName, registeredUser)
    : [];
  const requestBody = welcomeTemplateName
    ? {
        messaging_product: 'whatsapp',
        to: recipientPhone,
        type: 'template',
        template: {
          name: welcomeTemplateName,
          language: { code: welcomeTemplateLanguage },
          ...(templateComponents.length ? { components: templateComponents } : {}),
        },
      }
    : {
        messaging_product: 'whatsapp',
        to: recipientPhone,
        type: 'text',
        text: { body: welcomeMessage },
      };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminWaAccount.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });
  const data = await response.json().catch(() => ({}));

  const contact = await Contact.findOneAndUpdate(
    { user_id: adminWaAccount.user_id, phone_number: recipientPhone },
    {
      $setOnInsert: {
        user_id: adminWaAccount.user_id,
        phone_number: recipientPhone,
        name: registeredUser.full_name || recipientPhone,
        email: registeredUser.email,
      },
    },
    { upsert: true, new: true },
  );

  const conversation = await Conversation.findOneAndUpdate(
    { user_id: adminWaAccount.user_id, contact_id: contact._id },
    {
      $set: {
        phone_number: recipientPhone,
        last_message: welcomeMessage,
        last_message_at: new Date(),
      },
    },
    { upsert: true, new: true },
  );

  await Message.create({
    user_id: adminWaAccount.user_id,
    conversation_id: conversation._id,
    contact_id: contact._id,
    direction: 'outbound',
    message_type: welcomeTemplateName ? 'template' : 'text',
    content: welcomeMessage,
    template_name: welcomeTemplateName || undefined,
    phone_number: recipientPhone,
    whatsapp_message_id: data.messages?.[0]?.id,
    status: response.ok ? 'sent' : 'failed',
    error_details: response.ok ? undefined : data.error?.message || 'Failed to send welcome message',
  });

  if (!response.ok) {
    console.warn('[Signup Welcome] Failed to send welcome WhatsApp:', data.error || data);
  }
};

// ── OTP Handlers ──────────────────────────────────────────────────────────────
router.post('/send-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const exists = await User.findOne({ email });
    if (exists) return res.status(400).json({ error: 'Email is already registered' });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    await Otp.findOneAndUpdate(
      { email },
      { email, otp, createdAt: new Date() },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const sent = await sendOtpEmail(email, otp, 'signup');
    if (!sent) return res.status(500).json({ error: 'Failed to send OTP email. Please check SMTP settings.' });

    res.json({ success: true, message: 'OTP sent successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ error: 'Email and OTP required' });

    const record = await Otp.findOne({ email, otp });
    if (!record) return res.status(400).json({ error: 'Invalid or expired OTP' });

    if (!req.body.isReset) {
      await Otp.deleteOne({ _id: record._id });
    }
    
    res.json({ success: true, message: 'OTP verified successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Password Reset Handlers ──────────────────────────────────────────────────
router.post('/send-reset-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const exists = await User.findOne({ email });
    if (!exists) return res.status(400).json({ error: 'Email is not registered' });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    await Otp.findOneAndUpdate(
      { email },
      { email, otp, createdAt: new Date() },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const sent = await sendOtpEmail(email, otp, 'reset');
    if (!sent) return res.status(500).json({ error: 'Failed to send OTP email. Please check SMTP settings.' });

    res.json({ success: true, message: 'OTP sent successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) {
      return res.status(400).json({ error: 'Email, OTP, and new password required' });
    }

    const record = await Otp.findOne({ email, otp });
    if (!record) return res.status(400).json({ error: 'Invalid or expired OTP' });

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await User.findOneAndUpdate({ email }, { password: hashedPassword });
    await Otp.deleteOne({ _id: record._id });

    res.json({ success: true, message: 'Password reset successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Signup ───────────────────────────────────────────────────────────────────
router.post('/signup', async (req, res) => {
  try {
    const { email, password, full_name } = req.body;
    const phone = normalizePhone(req.body.phone);
    if (!email || !password || !phone) return res.status(400).json({ error: 'Email, password, and phone number required' });
    if (!isValidPhone(phone)) return res.status(400).json({ error: 'Please enter a valid phone number with country code' });

    const exists = await User.findOne({ email });
    if (exists) return res.status(400).json({ error: 'Email already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({
      email,
      password: hashedPassword,
      full_name: full_name || '',
      phone,
      role: 'user',
      subscription: { plan: 'free', status: 'active', messages_used: 0, start_date: new Date() },
      wallet: { balance: 0 },
    });

    // Old welcome system disabled - replaced by new SaaS notification system below
    // sendWelcomeWhatsApp(user).catch((err) => {
    //   console.error('[Signup Welcome] Unexpected error:', err.message);
    // });
const token = jwt.sign({ id: user._id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({
      user: { id: user._id, email: user.email, full_name: user.full_name, phone: user.phone, role: user.role },
      token,
    });
    // SaaS WhatsApp notifications (non-blocking, try-catch wrapped)
   (async () => {
  try {
    const istDate = new Date().toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
    });
    const userPhone = (user.phone || "").replace(/\D/g, "");
    const adminPhone = (process.env.ADMIN_WHATSAPP_NUMBER || "").replace(/\D/g, "");

    // Send to USER — template first, fallback to plain text
    if (userPhone) {
      try {
        await sendTemplateMessage(
          userPhone,
          "registration_success",
          [user.full_name || "there", user.email]
        );
        console.log("[Signup] ✅ Template sent to user:", userPhone);
      } catch (templateErr) {
        const isTemplateMissing =
          templateErr.message.includes("132001") ||
          templateErr.message.toLowerCase().includes("template name does not exist");

        if (isTemplateMissing) {
          console.warn("[Signup] ⚠️ Template not approved, sending plain text...");
          await sendWhatsAppMessage(
            userPhone,
            `🎉 Welcome to YestickAI, ${user.full_name || "there"}!\n\nYour account has been successfully created ✅\n\n📧 Email: ${user.email}\n📦 Plan: Free Trial\n\nWhat you can do now:\n✅ Connect your WhatsApp Business\n✅ Add up to 10 Contacts\n✅ Send Basic Messages\n\n👉 Login: https://yestickai.com/login\n\nNeed help? Reply anytime 😊\nTeam YestickAI`
          );
          console.log("[Signup] ✅ Fallback plain text sent to user:", userPhone);
        } else {
          throw templateErr;
        }
      }
    }

    // Send to ADMIN — skip if same number as user
    if (adminPhone && adminPhone !== userPhone) {
      await sendWhatsAppMessage(
        adminPhone,
        `🆕 New Registration - YestickAI!\n\n👤 Name: ${user.full_name || ""}\n📧 Email: ${user.email}\n📱 WhatsApp: ${user.phone}\n📦 Plan: Free Trial\n📅 Date: ${istDate}\n\n👉 https://yestickai.com/admin/users`
      );
      console.log("[Signup] ✅ Admin alert sent");
    }
  } catch (err) {
    console.error("[Signup] ❌ Notification error:", err.message);
  }
})();

    
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Alias /register to /signup
router.post('/register', (req, res, next) => {
  req.url = '/signup';
  next();
});

// ── Login ────────────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const token = jwt.sign({ id: user._id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({
      user: { id: user._id, email: user.email, full_name: user.full_name, phone: user.phone, role: user.role },
      token,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
