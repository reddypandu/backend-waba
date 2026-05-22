/**
 * Meta Status Sync Utility
 *
 * Safely syncs WhatsApp account status from Meta Graph API
 * WITHOUT re-registering existing working accounts
 *
 * Key Features:
 * - Detects Meta temporary test numbers
 * - Checks if account is already messaging
 * - Syncs actual status from Meta API
 * - Preserves backward compatibility
 */

import WhatsAppAccount from "../models/WhatsAppAccount.js";
import Message from "../models/Message.js";

const META_API = "https://graph.facebook.com/v24.0";

/**
 * Detect if phone number is a Meta temporary test number
 * Test numbers typically:
 * - Start with +1234567890X pattern
 * - Have "test" in display_phone_number field
 * - Are marked as test_account in Meta
 */
export async function isMetaTestNumber(phoneNumberId, accessToken) {
  try {
    const res = await fetch(
      `${META_API}/${phoneNumberId}?fields=display_phone_number,verification_status`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

    if (!res.ok) throw new Error(`Meta API error: ${res.status}`);

    const data = await res.json();
    const displayNumber = data.display_phone_number || "";

    // Meta test numbers typically follow this pattern
    const isTestPattern = /^(\+)?1234567890|test|sandbox/.test(
      displayNumber.toLowerCase(),
    );

    console.log(
      `[Meta Status] Phone ${displayNumber} - Is Test: ${isTestPattern}`,
    );
    return isTestPattern;
  } catch (err) {
    console.error("[Meta Status] Error detecting test number:", err.message);
    return false;
  }
}

/**
 * Check if account already has messaging activity
 * Safer indicator than just checking verification_status
 */
export async function hasMessagingActivity(userId) {
  try {
    const msgCount = await Message.countDocuments({
      user_id: userId,
      direction: "outbound",
    });

    console.log(
      `[Meta Status] User ${userId} has ${msgCount} outbound messages`,
    );
    return msgCount > 0;
  } catch (err) {
    console.error(
      "[Meta Status] Error checking messaging activity:",
      err.message,
    );
    return false;
  }
}

/**
 * Sync actual WhatsApp account status from Meta
 * Returns: { status, isTestNumber, isMessaging, shouldRegister }
 */
export async function syncAccountStatusFromMeta(waAccount) {
  const { user_id, phone_number_id, waba_id, access_token } = waAccount;

  try {
    // 1. Check if it's a test number
    const isTest = await isMetaTestNumber(phone_number_id, access_token);

    // 2. Check if already messaging
    const isMessaging = await hasMessagingActivity(user_id);

    // 3. Fetch current status from Meta
    let metaStatus = "pending";
    try {
      const profileRes = await fetch(
        `${META_API}/${phone_number_id}/whatsapp_business_profile`,
        { headers: { Authorization: `Bearer ${access_token}` } },
      );

      if (profileRes.ok) {
        metaStatus = "connected"; // If profile endpoint works, it's connected
      } else if (profileRes.status === 400) {
        // 400 usually means pending registration or action required
        metaStatus = "action_required";
      } else if (profileRes.status === 404) {
        metaStatus = "disconnected";
      }
    } catch (err) {
      console.warn(
        "[Meta Status] Could not fetch profile status:",
        err.message,
      );
    }

    // 4. Determine if registration is needed
    // SAFE RULE: Only register if:
    // - It's a real (non-test) number
    // - It's not already messaging
    // - Status is 'pending' or 'action_required'
    const shouldRegister =
      !isTest &&
      !isMessaging &&
      ["pending", "action_required"].includes(metaStatus);

    console.log(
      `[Meta Status Sync] Phone: ${phone_number_id}, Status: ${metaStatus}, IsTest: ${isTest}, IsMessaging: ${isMessaging}, ShouldRegister: ${shouldRegister}`,
    );

    return {
      metaStatus,
      isTestNumber: isTest,
      isMessaging,
      shouldRegister,
      timestamp: new Date(),
    };
  } catch (err) {
    console.error("[Meta Status Sync] Critical error:", err.message);
    return {
      metaStatus: "error",
      isTestNumber: false,
      isMessaging: false,
      shouldRegister: false,
      error: err.message,
      timestamp: new Date(),
    };
  }
}

/**
 * Update WhatsAppAccount with synced Meta status
 * SAFE: Only updates, never deletes or forces re-registration
 */
export async function updateAccountWithMetaStatus(waAccount, syncResult) {
  try {
    const updateData = {
      meta_wa_status: syncResult.metaStatus,
      is_meta_test_number: syncResult.isTestNumber,
      was_messaging: syncResult.isMessaging,
      meta_status_last_synced: syncResult.timestamp,
    };

    if (syncResult.error) {
      updateData.meta_error_message = syncResult.error;
    }

    const updated = await WhatsAppAccount.findByIdAndUpdate(
      waAccount._id,
      { $set: updateData },
      { new: true },
    );

    console.log(
      `[Meta Status] Account ${waAccount.phone_number_id} updated with Meta status`,
    );
    return updated;
  } catch (err) {
    console.error("[Meta Status] Error updating account:", err.message);
    return null;
  }
}

/**
 * Get dashboard-friendly status for frontend
 * Maps Meta status to user-friendly status
 */
export function getDashboardStatus(waAccount) {
  const {
    meta_wa_status,
    is_meta_test_number,
    was_messaging,
    verification_status,
  } = waAccount;

  // Priority order:
  // 1. Meta test number with messaging = "sandbox" (Meta demo account, but works)
  // 2. Real number + messaging = "connected"
  // 3. Real number + pending Meta registration = "connecting"
  // 4. Real number + action required = "action_required"
  // 5. Meta test number (no messaging) = "test_number"
  // 6. Not connected = "not_connected"

  if (is_meta_test_number) {
    if (was_messaging) return "sandbox"; // Test number that's actively used
    return "test_number"; // Unused test number
  }

  if (!meta_wa_status || meta_wa_status === "pending") {
    if (was_messaging) return "connected"; // Messaging works even if pending
    return "connecting";
  }

  if (meta_wa_status === "connected" || was_messaging) {
    return "connected";
  }

  if (meta_wa_status === "action_required") {
    return "action_required";
  }

  return verification_status === "verified" ? "connected" : "not_connected";
}

/**
 * Force sync all accounts (for admin/maintenance)
 * Use with caution - respects all safety rules
 */
export async function syncAllAccounts() {
  try {
    const accounts = await WhatsAppAccount.find({});
    const results = [];

    for (const account of accounts) {
      try {
        const syncResult = await syncAccountStatusFromMeta(account);
        const updated = await updateAccountWithMetaStatus(account, syncResult);
        results.push({
          phone_number_id: account.phone_number_id,
          success: true,
          status: syncResult.metaStatus,
        });
      } catch (err) {
        console.error(
          `Error syncing account ${account.phone_number_id}:`,
          err.message,
        );
        results.push({
          phone_number_id: account.phone_number_id,
          success: false,
          error: err.message,
        });
      }
    }

    console.log("[Meta Status] Batch sync complete:", results);
    return results;
  } catch (err) {
    console.error("[Meta Status] Batch sync failed:", err.message);
    throw err;
  }
}
