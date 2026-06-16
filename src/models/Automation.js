import mongoose from 'mongoose';

const AutoReplySchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  keyword: { type: String, required: true },
  match_type: { type: String, enum: ['exact', 'contains', 'starts_with'], default: 'contains' },
  response: { type: String, required: true },
  is_active: { type: Boolean, default: true },
}, { timestamps: true });

AutoReplySchema.index({ user_id: 1, keyword: 1 }, { unique: true });

const WorkflowSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  trigger_type: { type: String, enum: ['message_received', 'contact_created', 'keyword_match', 'schedule'], default: 'keyword_match' },
  trigger_value: { type: String },
  actions: { type: mongoose.Schema.Types.Mixed, default: [] },
  is_active: { type: Boolean, default: true },
  analytics: {
    trigger_count: { type: Number, default: 0 },
    execution_count: { type: Number, default: 0 },
    conversion_count: { type: Number, default: 0 },
    failed_count: { type: Number, default: 0 },
    last_triggered_at: { type: Date },
    last_executed_at: { type: Date },
    last_failed_at: { type: Date },
  },
}, { timestamps: true });

export const AutoReply = mongoose.model('AutoReply', AutoReplySchema);
export const Workflow = mongoose.model('Workflow', WorkflowSchema);
