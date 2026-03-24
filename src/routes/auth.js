import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pool from "../config/db.js";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret";

// Async error wrapper
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Signup
router.post(
  "/signup",
  asyncHandler(async (req, res) => {
    console.log("📝 Signup request received:", { email: req.body?.email });
    let connection;
    try {
      const { email, password, full_name } = req.body || {};
      if (!email || !password)
        return res.status(400).json({ error: "Email and password required" });

      console.log("🔗 Getting database connection...");
      connection = await pool.getConnection();
      console.log("✅ Connection acquired, starting transaction...");
      await connection.beginTransaction();

      const hashedPassword = await bcrypt.hash(password, 10);

      const [userResult] = await connection.execute(
        "INSERT INTO users (email, password, full_name, role) VALUES (?, ?, ?, ?)",
        [email, hashedPassword, full_name || "", "user"],
      );

      const userId = userResult.insertId;
      console.log("✅ User created:", userId);

      // Initialize Profile
      await connection.execute(
        "INSERT INTO profiles (user_id, full_name) VALUES (?, ?)",
        [userId, full_name || ""],
      );

      // Initialize Wallet
      await connection.execute(
        "INSERT INTO wallets (user_id, balance) VALUES (?, ?)",
        [userId, 0.0],
      );

      // Initialize free subscription
      await connection.execute(
        "INSERT INTO subscriptions (user_id, plan, status, messages_used, start_date) VALUES (?, ?, ?, ?, CURDATE())",
        [userId, "free", "active", 0],
      );

      // Initialize user role
      await connection.execute(
        "INSERT INTO user_roles (user_id, role) VALUES (?, ?)",
        [userId, "user"],
      );

      await connection.commit();
      console.log("✅ Transaction committed");

      const token = jwt.sign({ id: userId, email }, JWT_SECRET, {
        expiresIn: "7d",
      });
      res.status(201).json({ user: { id: userId, email, full_name }, token });
    } catch (err) {
      console.error("❌ Signup Error:", err.message, err.code);
      if (connection) {
        try {
          await connection.rollback();
        } catch (rollbackErr) {
          console.error("❌ Rollback Error:", rollbackErr.message);
        }
      }
      if (err.code === "ER_DUP_ENTRY")
        return res.status(400).json({ error: "Email already exists" });
      res.status(500).json({ error: err.message || "Signup failed" });
    } finally {
      if (connection) connection.release();
    }
  }),
);

// Login
router.post(
  "/login",
  asyncHandler(async (req, res) => {
    console.log("🔑 Login request received:", { email: req.body?.email });
    try {
      const { email, password } = req.body || {};
      if (!email || !password)
        return res.status(400).json({ error: "Email and password required" });

      console.log("🔍 Querying user...");
      const [users] = await pool.execute(
        "SELECT * FROM users WHERE email = ?",
        [email],
      );
      const user = users[0];
      console.log("✅ Query result:", user ? "User found" : "User not found");

      if (!user) {
        console.log("❌ Login failed: User not found");
        return res.status(401).json({ error: "Invalid email or password" });
      }

      console.log("🔐 Comparing passwords...");
      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) {
        console.log("❌ Login failed: Invalid password");
        return res.status(401).json({ error: "Invalid email or password" });
      }

      console.log("✅ Password valid, generating token...");
      const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, {
        expiresIn: "7d",
      });
      res.json({
        user: {
          id: user.id,
          email: user.email,
          full_name: user.full_name,
          role: user.role,
        },
        token,
      });
    } catch (err) {
      console.error("❌ Login Error:", err.message, err.code);
      res.status(500).json({ error: err.message || "Login failed" });
    }
  }),
);

export default router;
