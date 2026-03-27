import mongoose from 'mongoose';

const otpSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
  },
  otp: {
    type: String,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 300 // 5 minutes (in seconds)
  }
});

// Avoid compiling model multiple times in development
export default mongoose.models.Otp || mongoose.model('Otp', otpSchema);
