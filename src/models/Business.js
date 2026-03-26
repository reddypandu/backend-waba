import mongoose from 'mongoose';

const BusinessSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, default: 'My Business' },
  meta_business_id: { type: String },
  meta_verification_status: { type: String, default: 'pending' },
  website: { type: String },
  description: { type: String },
  about: { type: String },
  address: { type: String },
  email: { type: String },
  websites: [{ type: String }],
  vertical: { type: String },
  profile_picture_url: { type: String },
}, { timestamps: true });

export default mongoose.model('Business', BusinessSchema);
