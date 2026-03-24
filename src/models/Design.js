import mongoose from 'mongoose';

const DesignSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Optional for global templates
  name: { type: String, required: true },
  type: { type: String, enum: ['template', 'user'], default: 'user' },
  category: { type: String },
  data: { type: mongoose.Schema.Types.Mixed, required: true }, // Canvas data/JSON
  thumbnail_url: { type: String },
  is_public: { type: Boolean, default: false },
}, { timestamps: true });

export default mongoose.model('Design', DesignSchema);
