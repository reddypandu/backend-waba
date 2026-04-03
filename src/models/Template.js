import mongoose from 'mongoose';

const TemplateSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  language: { type: String, default: 'en' },
  category: { type: String, default: 'MARKETING' },
  status: { type: String, default: 'PENDING' },
  components: { type: mongoose.Schema.Types.Mixed },
  header_type: { type: String },
  header_content: { type: String },
  body_text: { type: String },
  footer_text: { type: String },
  buttons: { type: mongoose.Schema.Types.Mixed },
  meta_template_id: { type: String },
  local_url: { type: String }, // Persistently store local media URL
  needs_media_update: { type: Boolean, default: false }, // Flag for expired CDN links
}, { timestamps: true });

export default mongoose.model('Template', TemplateSchema);
