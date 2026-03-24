import mongoose from 'mongoose';

const EmailOTPSchema = new mongoose.Schema({
  email: { type: String, required: true, lowercase: true, trim: true },
  otp: { type: String, required: true },
  expires_at: { type: Date, required: true, index: { expires: 0 } }, // TTL Index
  is_verified: { type: Boolean, default: false },
}, { timestamps: true });

export default mongoose.model('EmailOTP', EmailOTPSchema);
