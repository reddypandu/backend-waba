import mongoose from 'mongoose';

const BusinessSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, default: 'My Business' },
  meta_business_id: { type: String },
  meta_verification_status: { type: String, default: 'pending' },
  website: { type: String },
  description: { type: String },
}, { timestamps: true });

export default mongoose.model('Business', BusinessSchema);
