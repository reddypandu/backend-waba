import ApiKey from "../models/ApiKey.js";
import WhatsAppAccount from "../models/WhatsAppAccount.js";

export const apiKeyAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      error: "Missing API key. Use: Authorization: Bearer YOUR_API_KEY",
    });
  }

  const key = authHeader.replace("Bearer ", "").trim();

  const apiKey = await ApiKey.findOne({ key, is_active: true });
  if (!apiKey) {
    return res.status(401).json({ error: "Invalid or inactive API key" });
  }

  const waAccount = await WhatsAppAccount.findOne({ user_id: apiKey.user_id });
  if (!waAccount) {
    return res.status(400).json({ error: "WhatsApp account not configured" });
  }

  // Update last used
  apiKey.last_used_at = new Date();
  await apiKey.save();

  // Attach to request
  req.apiUser = { user_id: apiKey.user_id };
  req.waAccount = waAccount;
  next();
};
