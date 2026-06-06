const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v22.0";
const META_API = `https://graph.facebook.com/${GRAPH_VERSION}`;
const APP_ID = process.env.META_APP_ID;
const APP_SECRET = process.env.META_APP_SECRET;
const DEFAULT_TIMEOUT_MS = 15000;

const withTimeout = async (
  url,
  options = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const data = await res.json().catch(() => null);
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      data,
      headers: res.headers,
    };
  } finally {
    clearTimeout(timeout);
  }
};

const authHeaders = (accessToken, extra = {}) => ({
  Authorization: `Bearer ${accessToken}`,
  ...extra,
});

const first = (value) => (Array.isArray(value) ? value[0] : value);

const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80004]);

export const getMetaError = (result) => result?.data?.error || null;

export const isMetaRateLimitError = (resultOrError) => {
  const metaError = getMetaError(resultOrError);
  const message = `${
    metaError?.message ||
    resultOrError?.error ||
    resultOrError?.message ||
    ""
  }`.toLowerCase();

  return (
    resultOrError?.status === 429 ||
    RATE_LIMIT_CODES.has(Number(metaError?.code)) ||
    RATE_LIMIT_CODES.has(Number(metaError?.error_subcode)) ||
    message.includes("rate limit") ||
    message.includes("too many calls") ||
    message.includes("temporarily blocked")
  );
};

export const getMetaRetryAfterSeconds = (
  resultOrError,
  fallbackSeconds = 120,
) => {
  const retryAfter =
    typeof resultOrError?.headers?.get === "function"
      ? resultOrError.headers.get("retry-after")
      : null;
  const parsed = Number(retryAfter);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackSeconds;
};

export class MetaApiService {
  static graphVersion = GRAPH_VERSION;
  static baseUrl = META_API;

  static async exchangeOAuthToken(code) {
    const tokenRes = await withTimeout(
      `${META_API}/oauth/access_token?client_id=${APP_ID}&client_secret=${APP_SECRET}&code=${code}`,
    );
    if (!tokenRes.ok) {
      throw new Error(
        `Token exchange failed: ${JSON.stringify(tokenRes.data)}`,
      );
    }

    const llRes = await withTimeout(
      `${META_API}/oauth/access_token?grant_type=fb_exchange_token&client_id=${APP_ID}&client_secret=${APP_SECRET}&fb_exchange_token=${tokenRes.data.access_token}`,
    );
    if (!llRes.ok) {
      throw new Error(`Long-lived token failed: ${JSON.stringify(llRes.data)}`);
    }

    return llRes.data.access_token;
  }

  static async verifyToken(accessToken) {
    const appToken = `${APP_ID}|${APP_SECRET}`;
    const url = `${META_API}/debug_token?input_token=${accessToken}&access_token=${appToken}`;
    const res = await withTimeout(url);
    if (!res.ok) {
      console.warn("[Token Verify] Failed to verify token:", res.data);
      return { valid: false, scopes: [] };
    }
    return {
      valid: res.data?.data?.is_valid || false,
      scopes: res.data?.data?.scopes || [],
      granular_scopes: res.data?.data?.granular_scopes || [],
      error: res.data?.data?.error || null,
    };
  }

  static async graphGet(path, accessToken, timeoutMs) {
    return withTimeout(
      `${META_API}/${path.replace(/^\//, "")}`,
      { headers: authHeaders(accessToken) },
      timeoutMs,
    );
  }

  static async getWabaInfo(wabaId, accessToken) {
    const res = await this.graphGet(
      `${wabaId}?fields=id,name,business{id,name}`,
      accessToken,
    );
    if (!res.ok) {
      console.warn("[Meta WABA] Failed to fetch WABA info:", {
        waba_id: wabaId,
        status: res.status,
        error: res.data?.error,
      });
      return null;
    }
    return res.data;
  }

  static async getPhoneNumber(phoneNumberId, accessToken) {
    const res = await this.graphGet(
      `${phoneNumberId}?fields=id,display_phone_number,verified_name,name,quality_rating,code_verification_status,status`,
      accessToken,
    );
    if (!res.ok) {
      console.warn("[Meta Phone] Failed to fetch phone number:", {
        phone_number_id: phoneNumberId,
        status: res.status,
        error: res.data?.error,
      });
      if (isMetaRateLimitError(res)) {
        const retryAfterSeconds = getMetaRetryAfterSeconds(res);
        const err = new Error(
          `Meta API rate limit reached. Please wait ${retryAfterSeconds} seconds before trying again.`,
        );
        err.rateLimited = true;
        err.retryAfterSeconds = retryAfterSeconds;
        throw err;
      }
      return null;
    }
    console.log("[Meta Phone] Fetched phone number data:", {
      phone_number_id: phoneNumberId,
      display_phone_number: res.data?.display_phone_number,
      verified_name: res.data?.verified_name,
      id: res.data?.id,
    });
    return res.data;
  }

  static async getWabaPhoneNumbers(wabaId, accessToken) {
    const res = await this.graphGet(
      `${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,name,quality_rating,code_verification_status,status&limit=50`,
      accessToken,
    );
    if (!res.ok) {
      console.warn("[Meta Assets] Failed to fetch WABA phone numbers:", {
        waba_id: wabaId,
        status: res.status,
        error: res.data?.error,
      });
      return [];
    }
    return res.data?.data || [];
  }

  static async discoverSignupAssets(accessToken, hints = {}) {
    console.log("[Meta Assets] Discovering signup assets", {
      hinted_business_id: hints.business_id || null,
      hinted_waba_id: hints.waba_id || null,
      hinted_phone_number_id: hints.phone_number_id || null,
    });

    let business = null;
    let waba = null;
    let phoneNumber = null;

    if (hints.waba_id) {
      waba = await this.getWabaInfo(hints.waba_id, accessToken);
      business = waba?.business || null;
    }

    if (hints.phone_number_id) {
      phoneNumber = await this.getPhoneNumber(
        hints.phone_number_id,
        accessToken,
      );
    }

    if (waba && !phoneNumber) {
      const numbers = await this.getWabaPhoneNumbers(waba.id, accessToken);
      phoneNumber = first(numbers);
    }

    if (!waba || !phoneNumber || !business) {
      const fields =
        "businesses{id,name,owned_whatsapp_business_accounts{id,name,phone_numbers{id,display_phone_number,verified_name,name,quality_rating,code_verification_status}}}";
      const res = await this.graphGet(
        `me?fields=${encodeURIComponent(fields)}`,
        accessToken,
      );
      if (res.ok) {
        const businesses = res.data?.businesses?.data || [];
        business =
          business ||
          businesses.find((item) => item.id === hints.business_id) ||
          first(businesses) ||
          null;

        const allWabas = businesses.flatMap((item) =>
          (item.owned_whatsapp_business_accounts?.data || []).map(
            (account) => ({
              ...account,
              business: { id: item.id, name: item.name },
            }),
          ),
        );

        waba =
          waba ||
          allWabas.find((item) => item.id === hints.waba_id) ||
          allWabas.find((item) =>
            (item.phone_numbers?.data || []).some(
              (number) => number.id === hints.phone_number_id,
            ),
          ) ||
          first(allWabas) ||
          null;

        const numbers = waba?.phone_numbers?.data || [];
        phoneNumber =
          phoneNumber ||
          numbers.find((number) => number.id === hints.phone_number_id) ||
          first(numbers) ||
          null;

        business = business || waba?.business || null;
      } else {
        console.warn("[Meta Assets] /me asset discovery failed:", {
          status: res.status,
          error: res.data?.error,
        });
      }
    }

    console.log("[Meta Assets] Discovery result", {
      business_id: business?.id || null,
      waba_id: waba?.id || null,
      phone_number_id: phoneNumber?.id || null,
      display_phone_number: phoneNumber?.display_phone_number || null,
    });

    return { business, waba, phoneNumber };
  }

  static async getBusinessProfile(phoneNumberId, accessToken) {
    return this.graphGet(
      `${phoneNumberId}/whatsapp_business_profile`,
      accessToken,
    );
  }

  static async registerPhoneNumber(phoneNumberId, accessToken, pin) {
    const requestBody = { messaging_product: "whatsapp", pin };
    const url = `${META_API}/${phoneNumberId}/register`;

    console.log("[Register API] Starting registration", {
      graph_version: GRAPH_VERSION,
      phone_number_id: phoneNumberId,
      timeout_ms: DEFAULT_TIMEOUT_MS,
    });
    console.log("[Register API] Request Body:", JSON.stringify(requestBody));
    console.log(
      "[Register API] Auth Header:",
      `Bearer ${accessToken.slice(0, 20)}...`,
    );

    try {
      const res = await withTimeout(url, {
        method: "POST",
        headers: authHeaders(accessToken, {
          "Content-Type": "application/json",
        }),
        body: JSON.stringify(requestBody),
      });

      console.log("[Register API] Response", {
        phone_number_id: phoneNumberId,
        status: res.status,
        statusText: res.statusText,
        body: res.data,
      });

      return res;
    } catch (err) {
      const timeout = err.name === "AbortError";
      console.error("[Register API] Network/timeout error", {
        phone_number_id: phoneNumberId,
        timeout,
        name: err.name,
        message: err.message,
      });
      return {
        ok: false,
        status: 0,
        data: null,
        error: timeout
          ? "Meta registration request timed out"
          : `${err.name}: ${err.message}`,
        timeout,
      };
    }
  }

  static async subscribeAppToWaba(wabaId, accessToken) {
    const res = await withTimeout(`${META_API}/${wabaId}/subscribed_apps`, {
      method: "POST",
      headers: authHeaders(accessToken),
    });
    if (!res.ok) {
      console.warn("[Meta Webhook] App subscription failed:", {
        waba_id: wabaId,
        status: res.status,
        error: res.data?.error,
      });
    }
    return res.ok;
  }

  static async fetchTemplates(wabaId, accessToken) {
    const res = await this.graphGet(
      `${wabaId}/message_templates?limit=100`,
      accessToken,
    );
    if (!res.ok) {
      throw new Error(res.data?.error?.message || "Failed to fetch templates");
    }
    return res.data?.data || [];
  }
}
