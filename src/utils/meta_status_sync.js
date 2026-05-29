import WhatsAppAccount from "../models/WhatsAppAccount.js";
import Message from "../models/Message.js";
import { MetaApiService } from "../services/metaApiService.js";

const TEST_NUMBER_RE = /(^\+?1?555|^\+?1234567890|test|sandbox|display)/i;

const metaErrorMessage = (result, fallback = "Meta API error") =>
  result?.data?.error?.message || result?.error || fallback;

const classifyPhoneStatus = (phoneData, profileResult, isMessaging) => {
  if (isMessaging) return "connected";
  if (profileResult?.ok) return "connected";

  const codeStatus = String(phoneData?.code_verification_status || "").toUpperCase();
  if (["VERIFIED", "APPROVED", "CONNECTED"].includes(codeStatus)) {
    return "connected";
  }

  if ([400, 401, 403].includes(profileResult?.status)) {
    return "action_required";
  }

  if (profileResult?.status === 404) return "disconnected";
  return "pending";
};

export async function isMetaTestNumber(phoneNumberId, accessToken, phoneData = null) {
  try {
    const data = phoneData || (await MetaApiService.getPhoneNumber(phoneNumberId, accessToken));
    const displayNumber = data?.display_phone_number || "";
    const verifiedName = data?.verified_name || data?.name || "";
    const isTestPattern = TEST_NUMBER_RE.test(`${displayNumber} ${verifiedName}`);

    console.log("[Meta Status] Test number check", {
      phone_number_id: phoneNumberId,
      display_phone_number: displayNumber,
      verified_name: verifiedName,
      is_test_number: isTestPattern,
    });
    return isTestPattern;
  } catch (err) {
    console.error("[Meta Status] Error detecting test number:", err.message);
    return false;
  }
}

export async function hasMessagingActivity(userId) {
  try {
    const msgCount = await Message.countDocuments({
      $or: [
        { user_id: userId },
        { $expr: { $eq: [{ $toString: "$user_id" }, String(userId)] } },
      ],
      direction: "outbound",
      whatsapp_message_id: { $exists: true, $ne: null },
    });

    console.log("[Meta Status] Messaging activity check", {
      user_id: String(userId),
      outbound_meta_messages: msgCount,
    });
    return msgCount > 0;
  } catch (err) {
    console.error("[Meta Status] Error checking messaging activity:", err.message);
    return false;
  }
}

export async function syncAccountStatusFromMeta(waAccount) {
  const {
    user_id,
    phone_number_id,
    waba_id,
    access_token,
    registration_attempt_count = 0,
  } = waAccount;

  console.log("[Meta Status Sync] Starting", {
    business_id: waAccount.business_id || null,
    waba_id,
    phone_number_id,
    registration_attempt_count,
  });

  try {
    const isMessaging = await hasMessagingActivity(user_id);
    const phoneData = await MetaApiService.getPhoneNumber(phone_number_id, access_token);
    const isTest = await isMetaTestNumber(phone_number_id, access_token, phoneData);
    const profileResult = await MetaApiService.getBusinessProfile(
      phone_number_id,
      access_token,
    );

    if (!profileResult.ok) {
      console.warn("[Meta Status Sync] Business profile status probe failed", {
        phone_number_id,
        status: profileResult.status,
        error: profileResult.data?.error,
      });
    }

    const metaStatus = classifyPhoneStatus(phoneData, profileResult, isMessaging);
    const canAttemptRegistration =
      ["pending", "action_required"].includes(metaStatus) &&
      registration_attempt_count < 5;

    const shouldRegister =
      !isMessaging &&
      metaStatus !== "connected" &&
      canAttemptRegistration;

    const registrationState = isMessaging
      ? "already_registered"
      : metaStatus === "connected"
        ? "already_registered"
        : isTest && shouldRegister
          ? "test_number_pending"
          : shouldRegister
            ? "registration_pending"
            : metaStatus === "disconnected"
              ? "action_required"
              : "registration_failed";

    const result = {
      metaStatus,
      registrationState,
      isTestNumber: isTest,
      isMessaging,
      shouldRegister,
      canAttemptRegistration,
      displayPhoneNumber: phoneData?.display_phone_number,
      qualityRating: phoneData?.quality_rating,
      verifiedName: phoneData?.verified_name || phoneData?.name,
      profileStatus: profileResult.status,
      profileError: profileResult.ok ? null : metaErrorMessage(profileResult),
      timestamp: new Date(),
    };

    console.log("[Meta Status Sync] Result", {
      business_id: waAccount.business_id || null,
      waba_id,
      phone_number_id,
      meta_status: result.metaStatus,
      registration_state: result.registrationState,
      is_test_number: result.isTestNumber,
      is_messaging: result.isMessaging,
      should_register: result.shouldRegister,
    });

    return result;
  } catch (err) {
    console.error("[Meta Status Sync] Critical error:", err.message);
    return {
      metaStatus: "error",
      registrationState: "action_required",
      isTestNumber: false,
      isMessaging: false,
      shouldRegister: false,
      canAttemptRegistration: false,
      error: err.message,
      timestamp: new Date(),
    };
  }
}

export async function updateAccountWithMetaStatus(waAccount, syncResult) {
  try {
    const updateData = {
      meta_wa_status: syncResult.metaStatus,
      is_meta_test_number: syncResult.isTestNumber,
      was_messaging: syncResult.isMessaging,
      meta_status_last_synced: syncResult.timestamp,
      meta_error_message: syncResult.error || syncResult.profileError || null,
    };

    if (syncResult.displayPhoneNumber) updateData.phone_number = syncResult.displayPhoneNumber;
    if (syncResult.qualityRating) updateData.quality_rating = syncResult.qualityRating;
    if (syncResult.verifiedName) updateData.verified_name = syncResult.verifiedName;

    if (syncResult.metaStatus === "connected" || syncResult.isMessaging) {
      updateData.verification_status = "verified";
      updateData.registration_error = null;
    } else if (!waAccount.was_messaging && waAccount.verification_status !== "verified") {
      updateData.verification_status =
        syncResult.registrationState === "registration_failed"
          ? "failed"
          : syncResult.metaStatus;
    }

    const updated = await WhatsAppAccount.findByIdAndUpdate(
      waAccount._id,
      { $set: updateData },
      { new: true },
    );

    console.log("[Meta Status] Account updated", {
      phone_number_id: waAccount.phone_number_id,
      meta_wa_status: updateData.meta_wa_status,
      was_messaging: updateData.was_messaging,
    });
    return updated;
  } catch (err) {
    console.error("[Meta Status] Error updating account:", err.message);
    return null;
  }
}

export function getDashboardStatus(waAccount) {
  const {
    meta_wa_status,
    is_meta_test_number,
    was_messaging,
    verification_status,
    registration_error,
  } = waAccount || {};

  if (meta_wa_status === "connected" || was_messaging || verification_status === "verified") {
    return is_meta_test_number ? "test_number" : "connected";
  }

  if (is_meta_test_number && registration_error) return "test_number_pending";
  if (is_meta_test_number) return "test_number";
  if (registration_error || meta_wa_status === "failed") return "registration_failed";
  if (meta_wa_status === "action_required" || meta_wa_status === "error") return "action_required";
  if (meta_wa_status === "pending" || verification_status === "pending") {
    return "registration_pending";
  }

  return "not_connected";
}

export async function attemptRegistrationIfNeeded(waAccount, options = {}) {
  const syncResult = await syncAccountStatusFromMeta(waAccount);
  let updated = await updateAccountWithMetaStatus(waAccount, syncResult);

  if (syncResult.isMessaging || syncResult.metaStatus === "connected") {
    return {
      attempted: false,
      success: true,
      status: "already_registered",
      dashboard_status: getDashboardStatus(updated || waAccount),
      syncResult,
      account: updated,
      message: "Phone number is already registered or messaging successfully.",
    };
  }

  if (!syncResult.shouldRegister && !options.force) {
    return {
      attempted: false,
      success: false,
      status: syncResult.registrationState,
      dashboard_status: getDashboardStatus(updated || waAccount),
      syncResult,
      account: updated,
      message: syncResult.profileError || "Phone number is not ready for registration.",
    };
  }

  const pin = process.env.WHATSAPP_PHONE_PIN || "123456";
  const regRes = await MetaApiService.registerPhoneNumber(
    waAccount.phone_number_id,
    waAccount.access_token,
    pin,
  );

  const errorMsg = metaErrorMessage(regRes, "Registration failed");
  const testNumberRejected = syncResult.isTestNumber && !regRes.ok;

  if (regRes.ok) {
    updated = await WhatsAppAccount.findByIdAndUpdate(
      waAccount._id,
      {
        $set: {
          verification_status: "verified",
          meta_wa_status: "connected",
          registration_error: null,
          meta_error_message: null,
        },
        $inc: { registration_attempt_count: 1 },
        $currentDate: { last_registration_attempt: true },
      },
      { new: true },
    );

    return {
      attempted: true,
      success: true,
      status: "connected",
      dashboard_status: getDashboardStatus(updated),
      syncResult,
      meta_response: regRes.data,
      account: updated,
      message: "Phone number registered successfully.",
    };
  }

  updated = await WhatsAppAccount.findByIdAndUpdate(
    waAccount._id,
    {
      $set: {
        registration_error: errorMsg,
        meta_error_message: errorMsg,
        meta_wa_status: testNumberRejected ? "pending" : "action_required",
        verification_status: testNumberRejected ? "pending" : "failed",
      },
      $inc: { registration_attempt_count: 1 },
      $currentDate: { last_registration_attempt: true },
    },
    { new: true },
  );

  return {
    attempted: true,
    success: false,
    status: testNumberRejected ? "test_number_pending" : "registration_failed",
    dashboard_status: getDashboardStatus(updated),
    syncResult,
    meta_response: regRes.data,
    account: updated,
    error: errorMsg,
    message: testNumberRejected ? "Test Number Pending" : errorMsg,
    timeout: regRes.timeout || false,
  };
}

export async function syncAllAccounts() {
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
        dashboard_status: getDashboardStatus(updated || account),
      });
    } catch (err) {
      console.error(`Error syncing account ${account.phone_number_id}:`, err.message);
      results.push({
        phone_number_id: account.phone_number_id,
        success: false,
        error: err.message,
      });
    }
  }

  console.log("[Meta Status] Batch sync complete:", results);
  return results;
}
