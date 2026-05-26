import mongoose from 'mongoose';

const ContactSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String },
  phone_number: { type: String, required: true },
  email: { type: String },
  tags: [{ type: String }],
  notes: { type: String },
  opted_out: { type: Boolean, default: false },
  opt_in_status: { type: String, enum: ['pending', 'opted_in', 'opted_out'], default: 'opted_in' },
  custom_attributes: { type: Map, of: String },
}, { timestamps: true });

ContactSchema.index({ user_id: 1, phone_number: 1 }, { unique: true });

export default mongoose.model('Contact', ContactSchema);
