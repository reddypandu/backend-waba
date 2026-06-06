import WhatsAppAccount from "../models/WhatsAppAccount.js";
import Message from "../models/Message.js";
import {
  getMetaRetryAfterSeconds,
  isMetaRateLimitError,
  MetaApiService,
} from "../services/metaApiService.js";

const TEST_NUMBER_RE = /(^\+?1?555|^\+?1234567890|test|sandbox|display)/i;
const REGISTRATION_RETRY_COOLDOWN_MS = 90 * 1000;
const RATE_LIMIT_COOLDOWN_MS = 5 * 60 * 1000;
const MAX_REGISTRATION_ATTEMPTS = 5;

const metaErrorMessage = (result, fallback = "Meta API error") =>
  result?.data?.error?.message || result?.error || fallback;

const secondsUntil = (date) =>
  Math.max(0, Math.ceil((new Date(date).getTime() - Date.now()) / 1000));

const getRegistrationCooldown = (waAccount) => {
  if (!waAccount?.last_registration_attempt) return null;
  const nextAllowedAt = new Date(
    new Date(waAccount.last_registration_attempt).getTime() +
      REGISTRATION_RETRY_COOLDOWN_MS,
  );

  if (nextAllowedAt.getTime() <= Date.now()) return null;
  return {
    nextAllowedAt,
    retryAfterSeconds: secondsUntil(nextAllowedAt),
  };
};

const classifyPhoneStatus = (
  phoneData,
  profileResult,
  isMessaging,
  dbStatus,
) => {
  if (isMessaging) return "connected";

  // If Meta API explicitly says the number is connected, trust it.
  // This happens if the number was previously registered (e.g. manually or via another app)
  // and avoids redundant (and failing) registration attempts for new users.
  if (phoneData?.status === "CONNECTED") {
    return "connected";
  }

  // If the database already knows it's connected, and it's not disconnected from Meta, keep it connected.
  if (
    dbStatus === "connected" &&
    profileResult?.status !== 404 &&
    ![400, 401, 403].includes(profileResult?.status)
  ) {
    return "connected";
  }

  // code_verification_status === "VERIFIED" only means OTP is verified.
  // We must not return "connected" here unless it's already connected in DB,
  // so that the registration API will be called for new signups.

  if ([400, 401, 403].includes(profileResult?.status)) {
    return "action_required";
  }

  if (profileResult?.status === 404) return "disconnected";
  return "pending";
};

export async function isMetaTestNumber(
  phoneNumberId,
  accessToken,
  phoneData = null,
) {
  try {
    const data =
      phoneData ||
      (await MetaApiService.getPhoneNumber(phoneNumberId, accessToken));
    const displayNumber = data?.display_phone_number || "";
    const verifiedName = data?.verified_name || data?.name || "";
    const isTestPattern = TEST_NUMBER_RE.test(
      `${displayNumber} ${verifiedName}`,
    );

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
    console.error(
      "[Meta Status] Error checking messaging activity:",
      err.message,
    );
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
    const phoneData = await MetaApiService.getPhoneNumber(
      phone_number_id,
      access_token,
    );
    const isTest = await isMetaTestNumber(
      phone_number_id,
      access_token,
      phoneData,
    );
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

    const metaStatus = classifyPhoneStatus(
      phoneData,
      profileResult,
      isMessaging,
      waAccount.meta_wa_status,
    );
    const canAttemptRegistration =
      ["pending", "action_required"].includes(metaStatus) &&
      registration_attempt_count < MAX_REGISTRATION_ATTEMPTS;

    const shouldRegister =
      !isMessaging && metaStatus !== "connected" && canAttemptRegistration;

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
      display_phone_number: phoneData?.display_phone_number,
      meta_status: result.metaStatus,
      registration_state: result.registrationState,
      is_test_number: result.isTestNumber,
      is_messaging: result.isMessaging,
      should_register: result.shouldRegister,
    });

    return result;
  } catch (err) {
    console.error("[Meta Status Sync] Critical error:", err.message);
    if (err.rateLimited || isMetaRateLimitError(err)) {
      const retryAfterSeconds =
        err.retryAfterSeconds || getMetaRetryAfterSeconds(err, 300);
      const cooldownUntil = new Date(Date.now() + retryAfterSeconds * 1000);
      return {
        metaStatus: waAccount.meta_wa_status || "pending",
        registrationState: "cooldown",
        isTestNumber: waAccount.is_meta_test_number || false,
        isMessaging: waAccount.was_messaging || false,
        shouldRegister: false,
        canAttemptRegistration: false,
        rateLimited: true,
        retryAfterSeconds,
        cooldownUntil,
        error:
          "Meta API rate limit reached. Please wait before checking status again.",
        timestamp: new Date(),
      };
    }

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
      is_meta_test_number: syncResult.isTestNumber,
      was_messaging: syncResult.isMessaging,
      meta_status_last_synced: syncResult.timestamp,
      meta_error_message: syncResult.error || syncResult.profileError || null,
    };

    if (!syncResult.rateLimited && syncResult.metaStatus) {
      updateData.meta_wa_status = syncResult.metaStatus;
    }

    // Only update phone_number if we have actual display_phone_number from Meta API
    // If we have a stored phone number already, don't overwrite it with empty/undefined
    const hasValidNewNumber = syncResult.displayPhoneNumber && syncResult.displayPhoneNumber.length > 5;
    if (hasValidNewNumber) {
      updateData.phone_number = syncResult.displayPhoneNumber;
    }

    if (syncResult.qualityRating)
      updateData.quality_rating = syncResult.qualityRating;
    if (syncResult.verifiedName)
      updateData.verified_name = syncResult.verifiedName;

    if (syncResult.metaStatus === "connected" || syncResult.isMessaging) {
      updateData.verification_status = "verified";
      updateData.registration_error = null;
    } else if (
      !waAccount.was_messaging &&
      waAccount.verification_status !== "verified"
    ) {
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

  if (
    meta_wa_status === "connected" ||
    was_messaging ||
    verification_status === "verified"
  ) {
    return is_meta_test_number ? "test_number" : "connected";
  }

  if (is_meta_test_number) return "test_number";
  if (registration_error || meta_wa_status === "failed")
    return "registration_failed";
  if (meta_wa_status === "action_required" || meta_wa_status === "error")
    return "action_required";
  if (meta_wa_status === "pending" || verification_status === "pending") {
    return "registration_pending";
  }

  return "not_connected";
}

export async function attemptRegistrationIfNeeded(waAccount, options = {}) {
  if ((waAccount.registration_attempt_count || 0) >= MAX_REGISTRATION_ATTEMPTS) {
    return {
      attempted: false,
      success: false,
      status: "registration_failed",
      dashboard_status: getDashboardStatus(waAccount),
      account: waAccount,
      error:
        "Registration retry limit reached. Please reconnect the WhatsApp account or contact support.",
      message:
        "Registration retry limit reached. Please reconnect the WhatsApp account or contact support.",
      retry_stopped: true,
    };
  }

  const cooldown = getRegistrationCooldown(waAccount);
  if (cooldown) {
    return {
      attempted: false,
      success: false,
      status: "cooldown",
      dashboard_status: getDashboardStatus(waAccount),
      account: waAccount,
      cooldown: true,
      retry_after_seconds: cooldown.retryAfterSeconds,
      retry_after: cooldown.nextAllowedAt,
      error: `Please wait ${cooldown.retryAfterSeconds} seconds before retrying registration.`,
      message: `Please wait ${cooldown.retryAfterSeconds} seconds before retrying registration.`,
    };
  }

  const syncResult = await syncAccountStatusFromMeta(waAccount);
  let updated = await updateAccountWithMetaStatus(waAccount, syncResult);

  if (syncResult.rateLimited) {
    return {
      attempted: false,
      success: false,
      status: "cooldown",
      dashboard_status: getDashboardStatus(updated || waAccount),
      syncResult,
      account: updated,
      cooldown: true,
      rate_limited: true,
      retry_after_seconds: syncResult.retryAfterSeconds,
      retry_after: syncResult.cooldownUntil,
      error: syncResult.error,
      message: syncResult.error,
    };
  }

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
      message:
        syncResult.profileError ||
        "Phone number is not ready for registration.",
    };
  }

  const pin = process.env.WHATSAPP_PHONE_PIN || "123456";
  const regRes = await MetaApiService.registerPhoneNumber(
    waAccount.phone_number_id,
    waAccount.access_token,
    pin,
  );

  const errorMsg = metaErrorMessage(regRes, "Registration failed");
  const rateLimited = isMetaRateLimitError(regRes);
  const retryAfterSeconds = rateLimited
    ? getMetaRetryAfterSeconds(regRes, RATE_LIMIT_COOLDOWN_MS / 1000)
    : null;
  const testNumberRejected = syncResult.isTestNumber && !regRes.ok;

  if (regRes.ok || testNumberRejected) {
    updated = await WhatsAppAccount.findByIdAndUpdate(
      waAccount._id,
      {
        $set: {
          verification_status: "verified",
          meta_wa_status: "connected",
          registration_error: testNumberRejected ? errorMsg : null,
          meta_error_message: testNumberRejected ? errorMsg : null,
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
      message: testNumberRejected
        ? "Test number configured successfully."
        : "Phone number registered successfully.",
    };
  }

  updated = await WhatsAppAccount.findByIdAndUpdate(
    waAccount._id,
    {
      $set: {
        registration_error: errorMsg,
        meta_error_message: rateLimited
          ? "Meta API rate limit reached. Please wait before retrying registration."
          : errorMsg,
        meta_wa_status: "action_required",
        verification_status: "failed",
      },
      $inc: { registration_attempt_count: 1 },
      $currentDate: { last_registration_attempt: true },
    },
    { new: true },
  );

  return {
    attempted: true,
    success: false,
    status: "registration_failed",
    dashboard_status: getDashboardStatus(updated),
    syncResult,
    meta_response: regRes.data,
    account: updated,
    error: rateLimited
      ? "Meta API rate limit reached. Please wait before retrying registration."
      : errorMsg,
    message: rateLimited
      ? "Meta API rate limit reached. Please wait before retrying registration."
      : errorMsg,
    timeout: regRes.timeout || false,
    cooldown: rateLimited,
    rate_limited: rateLimited,
    retry_after_seconds: retryAfterSeconds,
    retry_after: retryAfterSeconds
      ? new Date(Date.now() + retryAfterSeconds * 1000)
      : null,
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
}
