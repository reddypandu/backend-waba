import { Router } from "express";
import { apiKeyAuth } from "../middleware/apiKeyAuth.js";
import { requireAuth } from "../middleware/auth.js";
import ApiKey from "../models/ApiKey.js";
import Template from "../models/Template.js";
import Contact from "../models/Contact.js";
import User from "../models/User.js";
import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";
import { normalizePhone } from "../utils/phoneUtils.js";
import cors from "cors";

const router = Router();
const META_API = "https://graph.facebook.com/v22.0";

const findTemplateComponent = (components = [], type) =>
  components.find((component) => component.type?.toUpperCase() === type);

const replaceTemplateParams = (text = "", parameters = []) =>
  text.replace(/\{\{(\d+)\}\}/g, (_match, index) => {
    const value = parameters[Number(index) - 1]?.text;
    return value === undefined || value === null ? "" : String(value);
  });

const getMediaFromParameter = (parameter = {}) =>
  parameter.image?.link ||
  parameter.video?.link ||
  parameter.document?.link ||
  null;

const buildTemplateSnapshot = (templateRecord, sentComponents = []) => {
  const templateComponents = Array.isArray(templateRecord?.components)
    ? templateRecord.components
    : [];
  const header = findTemplateComponent(templateComponents, "HEADER");
  const body = findTemplateComponent(templateComponents, "BODY");
  const footer = findTemplateComponent(templateComponents, "FOOTER");
  const buttons = findTemplateComponent(templateComponents, "BUTTONS");
  const sentHeader = findTemplateComponent(sentComponents, "HEADER");
  const sentBody = findTemplateComponent(sentComponents, "BODY");

  const mediaUrl =
    getMediaFromParameter(sentHeader?.parameters?.[0]) ||
    templateRecord?.local_url ||
    header?.example?.header_url?.[0] ||
    header?.example?.header_handle?.[0] ||
    null;

  return {
    name: templateRecord?.name,
    language: templateRecord?.language,
    category: templateRecord?.category,
    header: header
      ? {
          format: header.format,
          text:
            header.format === "TEXT"
              ? replaceTemplateParams(header.text || "", sentHeader?.parameters)
              : header.text || "",
          media_url: ["IMAGE", "VIDEO", "DOCUMENT"].includes(header.format)
            ? mediaUrl
            : null,
        }
      : null,
    body: replaceTemplateParams(
      body?.text || templateRecord?.body_text || "",
      sentBody?.parameters,
    ),
    footer: footer?.text || templateRecord?.footer_text || "",
    buttons: buttons?.buttons || templateRecord?.buttons || [],
  };
};

// ── Key Management (requires user login) ─────────────────────────────────────
// Allow all origins for public API
router.use(
  cors({
    origin: "*",
    methods: ["POST", "GET", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

router.options("*", cors());

// Generate or get existing API key
router.post("/keys/generate", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if ((user?.subscription?.plan || 'paid') === 'free') { // Existing users without a plan are 'paid'
      return res.status(403).json({ 
        error: "API Keys are available on paid plans. Please upgrade to use this feature." 
      });
    }
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
    const user = await User.findById(req.user.id);
    if ((user?.subscription?.plan || 'paid') === 'free') { // Existing users without a plan are 'paid'
      return res.status(403).json({ 
        error: "API Keys are available on paid plans. Please upgrade." 
      });
    }
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
// ── Public API Endpoints (requires API key) ───────────────────────────────────

router.post("/send-template", apiKeyAuth, async (req, res) => {
  try {
    let { to, template_name, components = [] } = req.body;

    if (!to) return res.status(400).json({ error: "to is required" });
    if (!template_name)
      return res.status(400).json({ error: "template_name is required" });

    to = normalizePhone(to);

    const { access_token, phone_number_id } = req.waAccount;
    const userId = req.apiUser.user_id;

    // Get template language
    const templateRecord = await Template.findOne({
      user_id: userId,
      name: template_name,
    });
    const language = templateRecord?.language || "en_US";

    // Send via Meta API
    const r = await fetch(`${META_API}/${phone_number_id}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: template_name,
          language: { code: language },
          components,
        },
      }),
    });

    const data = await r.json();
    if (!r.ok) {
      return res.status(400).json({
        error: data.error?.message || "Failed to send template",
      });
    }

    const msgId = data.messages?.[0]?.id;

    // Save contact + conversation + message (phone already normalized)
    const contact = await Contact.findOneAndUpdate(
      { user_id: userId, phone_number: to },
      { $setOnInsert: { user_id: userId, phone_number: to, name: to } },
      { upsert: true, new: true },
    );

    const conv = await Conversation.findOneAndUpdate(
      { user_id: userId, contact_id: contact._id },
      {
        $set: {
          phone_number: to,
          last_message: `[Template: ${template_name}]`,
          last_message_at: new Date(),
        },
      },
      { upsert: true, new: true },
    );

    // Deep clone components to replace variables per-contact
    const contactComponents = JSON.parse(JSON.stringify(components || []));
    contactComponents.forEach(comp => {
      if (comp.parameters) {
        comp.parameters.forEach(param => {
          if (param.type === 'text' && typeof param.text === 'string') {
            param.text = param.text.replace(/\{\{name(?:\|([^}]*))?\}\}/gi, (match, fallback) => {
              const cName = contact.name?.trim();
              const isValidName = cName && cName.toLowerCase() !== "user" && cName !== contact.phone_number;
              return isValidName ? cName : (fallback || "");
            });
          }
        });
      }
    });

    const templateSnapshot = buildTemplateSnapshot(
      templateRecord,
      contactComponents,
    );
    const messageContent =
      templateSnapshot.body || `[Template: ${template_name}]`;

    // Extract media URL if present
    const headerComp = (components || []).find((c) => c.type === "header");
    const mediaUrl =
      headerComp?.parameters?.[0]?.image?.link ||
      headerComp?.parameters?.[0]?.video?.link ||
      headerComp?.parameters?.[0]?.document?.link;

    await Message.create({
      user_id: userId,
      conversation_id: conv._id,
      contact_id: contact._id,
      direction: "outbound",
      message_type: "template",
      template_name,
      content: messageContent,
      media_url: mediaUrl || templateSnapshot.header?.media_url,
      template_snapshot: templateSnapshot,
      phone_number: to,
      whatsapp_message_id: msgId,
      status: "sent",
    });

    res.json({
      success: true,
      message_id: msgId,
      to,
      template_name,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
