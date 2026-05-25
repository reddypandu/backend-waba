import mongoose from "mongoose";

const WhatsAppAccountSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    business_id: { type: mongoose.Schema.Types.ObjectId, ref: "Business" },
    phone_number_id: { type: String, required: true },
    waba_id: { type: String },
    access_token: { type: String },
    phone_number: { type: String },

    // Local verification status (deprecated: use meta_wa_status instead)
    verification_status: { type: String, default: "pending" },
    webhook_verified: { type: Boolean, default: false },

    // NEW: Sync status from Meta Graph API (actual WhatsApp Business status)
    // Values: 'pending', 'connected', 'failed', 'disconnected', 'action_required'
    meta_wa_status: { type: String, default: "pending" },

    // NEW: Is this a Meta temporary test/display number?
    is_meta_test_number: { type: Boolean, default: false },

    // NEW: Track when status was last synced from Meta
    meta_status_last_synced: { type: Date },

    // NEW: Error message from Meta (if any)
    meta_error_message: { type: String },

    // NEW: Was this number already messaging (messages sent > 0)?
    was_messaging: { type: Boolean, default: false },

    // Registration retry tracking
    last_registration_attempt: { type: Date },
    registration_error: { type: String },
    registration_attempt_count: { type: Number, default: 0 },
  },
  { timestamps: true },
);

// Ensure one WA account per user
WhatsAppAccountSchema.index({ user_id: 1 }, { unique: true });

export default mongoose.model("WhatsAppAccount", WhatsAppAccountSchema);
