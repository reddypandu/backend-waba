import "dotenv/config";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import whatsappRoutes from "./routes/whatsapp.js";
import webhookRoutes from "./routes/webhook.js";
import razorpayRoutes from "./routes/razorpay.js";
import subscriptionRoutes from "./routes/subscription.js";
import cloudinaryRoutes from "./routes/cloudinary.js";
import otpRoutes from "./routes/otp.js";
import adminRoutes from "./routes/admin.js";
import mongoRoutes from "./routes/mongo.js";
import authRoutes from "./routes/auth.js";
import pool from "./config/db.js";

const app = express();

// Test database connection
pool
  .getConnection()
  .then((conn) => {
    console.log("✅ Database connected successfully");
    conn.release();
  })
  .catch((err) => {
    console.error("❌ Database connection failed:", err.message);
  });

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    credentials: true,
  }),
);
app.options("*", cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// ── Request Logging ──────────────────────────────────────────────────────────
app.use((req, res, next) => {
  console.log(
    `[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`,
    req.body ? `Body: ${JSON.stringify(req.body).substring(0, 100)}` : "",
  );
  next();
});

// ── Rate Limiting ────────────────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  message: { error: "Too many requests. Please try again after an hour." },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === "OPTIONS", // Skip preflight requests
});

const apiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 100,
  message: { error: "Too many requests. Please slow down." },
  skip: (req) => req.method === "OPTIONS", // Skip preflight requests
});

app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/otp", apiLimiter, otpRoutes);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/api/whatsapp", whatsappRoutes);
app.use("/api/webhook", webhookRoutes);
app.use("/api/razorpay", razorpayRoutes);
app.use("/api/subscription", subscriptionRoutes);
app.use("/api/upload", cloudinaryRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/mongo", mongoRoutes);

app.get("/", (req, res) =>
  res.json({ message: "Backend API is running", version: "1.0.0" }),
);
app.get("/health", (req, res) =>
  res.json({ status: "ok", uptime: process.uptime() }),
);

// ── 404 Handler ──────────────────────────────────────────────────────────────
app.use((req, res) => {
  console.warn(`404 - ${req.method} ${req.originalUrl}`);
  res.status(404).json({ error: "Route not found" });
});

// ── Global Error Handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error("Global Error Handler:", err);
  res.status(err.status || 500).json({
    error: err.message || "Internal server error",
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
});

const PORT = process.env.PORT || 5005;
app.listen(PORT, () => console.log(`✅ Backend running on port ${PORT}`));
