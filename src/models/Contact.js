import mongoose from 'mongoose';

const ContactSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String },
  phone_number: { type: String, required: true },
  email: { type: String },
  tags: [{ type: String }],
  notes: { type: String },
  opted_out: { type: Boolean, default: false },
}, { timestamps: true });

ContactSchema.index({ user_id: 1, phone_number: 1 }, { unique: true });

export default mongoose.model('Contact', ContactSchema);
