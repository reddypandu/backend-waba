import { normalizePhone } from "./phoneUtils.js";

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v22.0";
const META_API = `https://graph.facebook.com/${GRAPH_VERSION}`;

/**
 * Send a plain text WhatsApp message using Meta WhatsApp Cloud API.
 * Primarily used for admin alerts.
 * 
 * @param {string} to - Recipient phone number
 * @param {string} message - Plain text message body
 * @returns {Promise<object>} Meta API response data
 */
export async function sendWhatsAppMessage(to, message) {
  const phoneId = process.env.PHONE_NUMBER_ID;
  const token = process.env.WA_TOKEN;

  if (!phoneId || !token) {
    throw new Error("Missing WhatsApp configuration: PHONE_NUMBER_ID or WA_TOKEN is not defined");
  }

  const normalizedTo = normalizePhone(to);
  const endpoint = `${META_API}/${phoneId}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to: normalizedTo,
    type: "text",
    text: {
      body: message
    }
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error?.message || `Failed to send text message: ${response.statusText}`);
  }

  return data;
}

/**
 * Send a template message using Meta WhatsApp Cloud API.
 * Primarily used for user notifications.
 * 
 * @param {string} to - Recipient phone number
 * @param {string} templateName - Approved Meta template name
 * @param {Array} variablesArray - Ordered array of template variables
 * @returns {Promise<object>} Meta API response data
 */
export async function sendTemplateMessage(to, templateName, variablesArray) {
  const phoneId = process.env.PHONE_NUMBER_ID;
  const token = process.env.WA_TOKEN;

  if (!phoneId || !token) {
    throw new Error("Missing WhatsApp configuration: PHONE_NUMBER_ID or WA_TOKEN is not defined");
  }

  const normalizedTo = normalizePhone(to);
  const endpoint = `${META_API}/${phoneId}/messages`;

  const components = [];
  if (variablesArray && variablesArray.length > 0) {
    components.push({
      type: "body",
      parameters: variablesArray.map(val => ({
        type: "text",
        text: String(val)
      }))
    });
  }

  const payload = {
    messaging_product: "whatsapp",
    to: normalizedTo,
    type: "template",
    template: {
      name: templateName,
      language: {
        code: "en_US"
      },
      ...(components.length > 0 ? { components } : {})
    }
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error?.message || `Failed to send template message: ${response.statusText}`);
  }

  return data;
}
// Add to bottom of utils/whatsappNotify.js

export const getISTDate = () =>
  new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });