import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  full_name: { type: String, default: '' },
  role: { type: String, enum: ['user', 'admin', 'manager'], default: 'user' },
  avatar_url: { type: String },
  phone: { type: String },
  subscription: {
    plan: { type: String, enum: ['free', 'starter', 'pro'], default: 'free' },
    status: { type: String, default: 'active' },
    messages_used: { type: Number, default: 0 },
    start_date: { type: Date, default: Date.now },
    end_date: { type: Date },
  },
  wallet: {
    balance: { type: Number, default: 0 },
  },
}, { timestamps: true });

export default mongoose.model('User', UserSchema);
