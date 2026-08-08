import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import WhatsAppAccount from "../models/WhatsAppAccount.js";

const router = Router();
const META_API = "https://graph.facebook.com/v22.0";

/**
 * Note: These endpoints are ordinary Meta Graph API reads and do NOT satisfy
 * Meta's "App Solution" / Tech Provider App Review requirement — that's a separate API surface.
 */

/**
 * Helper to execute Meta Graph API GET requests.
 */
const graphGet = async (endpoint, accessToken, params = {}) => {
  const queryParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      queryParams.append(key, String(value));
    }
  }
  queryParams.append("access_token", accessToken);

  const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const url = `${META_API}${cleanEndpoint}?${queryParams.toString()}`;

  const response = await fetch(url);
  const data = await response.json();

  if (!response.ok || data.error) {
    const error = new Error(data.error?.message || "Meta API request failed");
    error.meta_error_code = data.error?.code;
    error.status = response.status;
    throw error;
  }

  return data;
};

/**
 * Helper to format error responses for the frontend.
 */
const handleError = (res, err, label) => {
  console.error(`[${label}] error`, err);
  const status = err.status || 500;
  return res.status(status).json({
    error: err.message || "Meta API request failed",
    ...(err.meta_error_code !== undefined && { meta_error_code: err.meta_error_code }),
  });
};

/**
 * Helper to retrieve user's WhatsAppAccount and access_token.
 * Admins can pass ?user_id=... to view another user's Meta account details.
 */
const getWaAccount = async (req, res) => {
  const targetUserId = req.query.user_id || req.user.id;
  if (String(targetUserId) !== String(req.user.id) && req.user.role !== "admin") {
    res.status(403).json({ error: "Access denied" });
    return null;
  }
  const waAccount = await WhatsAppAccount.findOne({ user_id: targetUserId });
  if (!waAccount || !waAccount.access_token) {
    res.status(400).json({ error: "WhatsApp account not configured for this user." });
    return null;
  }
  return waAccount;
};

// 1. GET /me — Graph API /me (Meta user id + name)
router.get("/me", requireAuth, async (req, res) => {
  try {
    const waAccount = await getWaAccount(req, res);
    if (!waAccount) return;
    const data = await graphGet("/me", waAccount.access_token, { fields: "id,name" });
    res.json(data);
  } catch (err) {
    handleError(res, err, "GET /me");
  }
});

// 2. GET /app — Graph API /app (app id, name, namespace)
router.get("/app", requireAuth, async (req, res) => {
  try {
    const waAccount = await getWaAccount(req, res);
    if (!waAccount) return;
    const data = await graphGet("/app", waAccount.access_token, { fields: "id,name,namespace" });
    res.json(data);
  } catch (err) {
    handleError(res, err, "GET /app");
  }
});

// 3. GET /businesses — /me/businesses with fields id,name,verification_status,created_time
router.get("/businesses", requireAuth, async (req, res) => {
  try {
    const waAccount = await getWaAccount(req, res);
    if (!waAccount) return;
    const data = await graphGet("/me/businesses", waAccount.access_token, {
      fields: "id,name,verification_status,created_time",
    });
    res.json(data);
  } catch (err) {
    handleError(res, err, "GET /businesses");
  }
});

// 4. GET /accounts — /me/accounts (Facebook Pages) with fields id,name,category,link
router.get("/accounts", requireAuth, async (req, res) => {
  try {
    const waAccount = await getWaAccount(req, res);
    if (!waAccount) return;
    const data = await graphGet("/me/accounts", waAccount.access_token, {
      fields: "id,name,category,link",
    });
    res.json(data);
  } catch (err) {
    handleError(res, err, "GET /accounts");
  }
});

// 5. GET /businesses/:businessId/whatsapp-accounts — /{businessId}/owned_whatsapp_business_accounts
router.get("/businesses/:businessId/whatsapp-accounts", requireAuth, async (req, res) => {
  try {
    const waAccount = await getWaAccount(req, res);
    if (!waAccount) return;
    const data = await graphGet(
      `/${req.params.businessId}/owned_whatsapp_business_accounts`,
      waAccount.access_token,
      { fields: "id,name,timezone_id,message_template_namespace" }
    );
    res.json(data);
  } catch (err) {
    handleError(res, err, "GET /businesses/:businessId/whatsapp-accounts");
  }
});

// 6. GET /waba/:wabaId/phone-numbers — /{wabaId}/phone_numbers
router.get("/waba/:wabaId/phone-numbers", requireAuth, async (req, res) => {
  try {
    const waAccount = await getWaAccount(req, res);
    if (!waAccount) return;
    const data = await graphGet(
      `/${req.params.wabaId}/phone_numbers`,
      waAccount.access_token,
      { fields: "id,display_phone_number,verified_name,code_verification_status,quality_rating" }
    );
    res.json(data);
  } catch (err) {
    handleError(res, err, "GET /waba/:wabaId/phone-numbers");
  }
});

// 7. GET /waba/:wabaId/templates — /{wabaId}/message_templates
router.get("/waba/:wabaId/templates", requireAuth, async (req, res) => {
  try {
    const waAccount = await getWaAccount(req, res);
    if (!waAccount) return;
    const limit = req.query.limit || 50;
    const data = await graphGet(
      `/${req.params.wabaId}/message_templates`,
      waAccount.access_token,
      { fields: "id,name,status,category,language", limit }
    );
    res.json(data);
  } catch (err) {
    handleError(res, err, "GET /waba/:wabaId/templates");
  }
});

// 8. GET /snapshot — convenience route chaining /me + /me/businesses, then WABAs, then phone numbers + templates
router.get("/snapshot", requireAuth, async (req, res) => {
  try {
    const waAccount = await getWaAccount(req, res);
    if (!waAccount) return;

    const accessToken = waAccount.access_token;

    // 1. Fetch /me and /me/businesses in parallel
    const [meData, businessesRes] = await Promise.all([
      graphGet("/me", accessToken, { fields: "id,name" }),
      graphGet("/me/businesses", accessToken, {
        fields: "id,name,verification_status,created_time",
      }).catch((err) => ({ data: [] })),
    ]);

    const me = meData || null;
    const businesses = businessesRes?.data || [];

    // 2. Determine WABA and fetch WABAs list
    let targetWabaId = waAccount.waba_id;
    let wabas = [];

    if (businesses.length > 0) {
      try {
        const wabasRes = await graphGet(
          `/${businesses[0].id}/owned_whatsapp_business_accounts`,
          accessToken,
          { fields: "id,name,timezone_id,message_template_namespace" }
        );
        wabas = wabasRes?.data || [];
      } catch (wabaErr) {
        console.error("[GET /snapshot] business WABAs error", wabaErr);
      }
    }

    if (!targetWabaId && wabas.length > 0) {
      targetWabaId = wabas[0].id;
    }

    if (targetWabaId && !wabas.some((w) => w.id === targetWabaId)) {
      try {
        const singleWaba = await graphGet(`/${targetWabaId}`, accessToken, {
          fields: "id,name,timezone_id,message_template_namespace",
        });
        if (singleWaba?.id) {
          wabas.unshift(singleWaba);
        }
      } catch (err) {
        console.error("[GET /snapshot] single WABA error", err);
      }
    }

    // 3. Fetch phone numbers and templates for target WABA in parallel
    let phoneNumbers = [];
    let templates = [];

    if (targetWabaId) {
      const [phoneRes, tmplRes] = await Promise.all([
        graphGet(`/${targetWabaId}/phone_numbers`, accessToken, {
          fields:
            "id,display_phone_number,verified_name,code_verification_status,quality_rating",
        }).catch((err) => ({ data: [] })),
        graphGet(`/${targetWabaId}/message_templates`, accessToken, {
          fields: "id,name,status,category,language",
          limit: 50,
        }).catch((err) => ({ data: [] })),
      ]);

      phoneNumbers = phoneRes?.data || [];
      templates = tmplRes?.data || [];
    }

    return res.json({
      me,
      businesses,
      wabas,
      phoneNumbers,
      templates,
      connected_phone_number_id: waAccount.phone_number_id || null,
    });
  } catch (err) {
    handleError(res, err, "GET /snapshot");
  }
});

export default router;
