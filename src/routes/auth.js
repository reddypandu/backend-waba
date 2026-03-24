import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pool from "../config/db.js";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret";

// Signup
router.post("/signup", async (req, res) => {
  let connection;
  try {
    const { email, password, full_name } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: "Email and password required" });

    connection = await pool.getConnection();
    await connection.beginTransaction();

    const hashedPassword = await bcrypt.hash(password, 10);

    const [userResult] = await connection.execute(
      "INSERT INTO users (email, password, full_name, role) VALUES (?, ?, ?, ?)",
      [email, hashedPassword, full_name || "", "user"],
    );

    const userId = userResult.insertId;

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

    const token = jwt.sign({ id: userId, email }, JWT_SECRET, {
      expiresIn: "7d",
    });
    res.json({ user: { id: userId, email, full_name }, token });
  } catch (err) {
    console.error("Signup Error:", err);
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackErr) {
        console.error("Rollback Error:", rollbackErr);
      }
    }
    if (err.code === "ER_DUP_ENTRY")
      return res.status(400).json({ error: "Email already exists" });
    res.status(500).json({ error: err.message || "Signup failed" });
  } finally {
    if (connection) connection.release();
  }
});

// Login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: "Email and password required" });

    const [users] = await pool.execute("SELECT * FROM users WHERE email = ?", [
      email,
    ]);
    const user = users[0];

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

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
    console.error("Login Error:", err);
    res.status(500).json({ error: err.message || "Login failed" });
  }
});

export default router;
