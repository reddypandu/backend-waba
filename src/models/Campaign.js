import mongoose from 'mongoose';

const CampaignLogSchema = new mongoose.Schema({
  contact_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact' },
  phone_number: { type: String },
  status: { type: String, enum: ['queued', 'sent', 'delivered', 'read', 'failed'], default: 'queued' },
  whatsapp_message_id: { type: String },
  error_details: { type: String },
  sent_at: { type: Date },
}, { timestamps: true });

const CampaignSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  template_id: { type: String },
  template_name: { type: String },
  status: { type: String, enum: ['draft', 'scheduled', 'running', 'completed', 'paused', 'failed'], default: 'draft' },
  audience_type: { type: String, enum: ['existing', 'excel'], default: 'existing' },
  schedule_type: { type: String, enum: ['now', 'later'], default: 'now' },
  scheduled_at: { type: Date },
  total_recipients: { type: Number, default: 0 },
  sent_count: { type: Number, default: 0 },
  delivered_count: { type: Number, default: 0 },
  read_count: { type: Number, default: 0 },
  failed_count: { type: Number, default: 0 },
  logs: [CampaignLogSchema],
}, { timestamps: true });

export default mongoose.model('Campaign', CampaignSchema);
