import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import whatsappRoutes from './routes/whatsapp.js';
import webhookRoutes from './routes/webhook.js';
import razorpayRoutes from './routes/razorpay.js';
import subscriptionRoutes from './routes/subscription.js';
import cloudinaryRoutes from './routes/cloudinary.js';
import otpRoutes from './routes/otp.js';
import adminRoutes from './routes/admin.js';
import mongoRoutes from './routes/mongo.js';
import authRoutes from './routes/auth.js';

const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json());

// ── Rate Limiting ────────────────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  message: { error: 'Too many requests. Please try again after an hour.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 100,
  message: { error: 'Too many requests. Please slow down.' },
});

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/otp', apiLimiter, otpRoutes);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api/razorpay', razorpayRoutes);
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/upload', cloudinaryRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/mongo', mongoRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

const PORT = process.env.PORT || 5005;
app.listen(PORT, () => console.log(`✅ Backend running on port ${PORT}`));
