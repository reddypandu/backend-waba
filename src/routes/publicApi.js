import { Router } from "express";
import { apiKeyAuth } from "../middleware/apiKeyAuth.js";
import { requireAuth } from "../middleware/auth.js";
import ApiKey from "../models/ApiKey.js";
import Template from "../models/Template.js";
import Contact from "../models/Contact.js";
import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";

const router = Router();
const META_API = "https://graph.facebook.com/v22.0";

// ── Key Management (requires user login) ─────────────────────────────────────

// Generate or get existing API key
router.post("/keys/generate", requireAuth, async (req, res) => {
  try {
    let apiKey = await ApiKey.findOne({ user_id: req.user.id });
    if (apiKey) {
      return res.json({
        success: true,
        api_key: apiKey.key,
        message:
          "Existing key returned. Use /keys/regenerate to create a new one.",
      });
    }
    apiKey = await ApiKey.create({ user_id: req.user.id });
    res.json({ success: true, api_key: apiKey.key });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Regenerate key (invalidates old one)
router.post("/keys/regenerate", requireAuth, async (req, res) => {
  try {
    const crypto = await import("crypto");
    const newKey = "yt_" + crypto.randomBytes(32).toString("hex");
    const apiKey = await ApiKey.findOneAndUpdate(
      { user_id: req.user.id },
      { key: newKey, is_active: true },
      { upsert: true, new: true },
    );
    res.json({ success: true, api_key: apiKey.key });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// View key info
router.get("/keys", requireAuth, async (req, res) => {
  try {
    const apiKey = await ApiKey.findOne({ user_id: req.user.id });
    if (!apiKey) return res.json({ api_key: null });
    res.json({
      api_key: apiKey.key,
      is_active: apiKey.is_active,
      last_used_at: apiKey.last_used_at,
      created_at: apiKey.createdAt,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Revoke key
router.delete("/keys", requireAuth, async (req, res) => {
  try {
    await ApiKey.findOneAndUpdate(
      { user_id: req.user.id },
      { is_active: false },
    );
    res.json({ success: true, message: "API key revoked" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
