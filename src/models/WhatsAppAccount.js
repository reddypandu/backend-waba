import mongoose from 'mongoose';

const WhatsAppAccountSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  business_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Business' },
  phone_number_id: { type: String, required: true },
  waba_id: { type: String },
  access_token: { type: String },
  phone_number: { type: String },
  verification_status: { type: String, default: 'pending' },
  webhook_verified: { type: Boolean, default: false },
}, { timestamps: true });

// Ensure one WA account per user
WhatsAppAccountSchema.index({ user_id: 1 }, { unique: true });

export default mongoose.model('WhatsAppAccount', WhatsAppAccountSchema);
