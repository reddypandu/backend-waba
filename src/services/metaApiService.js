const META_API = "https://graph.facebook.com/v24.0"; // Using latest version specified in existing files
const APP_ID = process.env.META_APP_ID;
const APP_SECRET = process.env.META_APP_SECRET;

export class MetaApiService {
  static async exchangeOAuthToken(code) {
    const tokenRes = await fetch(
      `${META_API}/oauth/access_token?client_id=${APP_ID}&client_secret=${APP_SECRET}&code=${code}`
    );
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(`Token exchange failed: ${JSON.stringify(tokenData)}`);

    const llRes = await fetch(
      `${META_API}/oauth/access_token?grant_type=fb_exchange_token&client_id=${APP_ID}&client_secret=${APP_SECRET}&fb_exchange_token=${tokenData.access_token}`
    );
    const llData = await llRes.json();
    if (!llRes.ok) throw new Error(`Long-lived token failed: ${JSON.stringify(llData)}`);

    return llData.access_token;
  }

  static async getWabaInfo(wabaId, accessToken) {
    const res = await fetch(`${META_API}/${wabaId}?fields=id,name`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return res.ok ? await res.json() : null;
  }

  static async getPhoneNumber(phoneNumberId, accessToken) {
    const res = await fetch(`${META_API}/${phoneNumberId}?fields=display_phone_number,quality_rating,name`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return res.ok ? await res.json() : null;
  }

  static async getBusinessProfile(phoneNumberId, accessToken) {
    const res = await fetch(`${META_API}/${phoneNumberId}/whatsapp_business_profile`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return { ok: res.ok, status: res.status, data: await res.json().catch(() => null) };
  }

  static async registerPhoneNumber(phoneNumberId, accessToken, pin) {
    const res = await fetch(`${META_API}/${phoneNumberId}/register`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messaging_product: "whatsapp", pin }),
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, data };
  }

  static async subscribeAppToWaba(wabaId, accessToken) {
    const res = await fetch(`${META_API}/${wabaId}/subscribed_apps`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return res.ok;
  }

  static async fetchTemplates(wabaId, accessToken) {
    const res = await fetch(`${META_API}/${wabaId}/message_templates?limit=100`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Failed to fetch templates');
    return data.data || [];
  }
}
