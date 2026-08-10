import mongoose from 'mongoose';

const BookingSlotSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  workflow_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Workflow', required: true },
  
  date: { type: String, required: true }, // Format: YYYY-MM-DD
  time: { type: String, required: true }, // Format: HH:mm
  duration_minutes: { type: Number, default: 30 },
  
  status: { type: String, enum: ['available', 'booked', 'blocked'], default: 'available' },
  
  booked_by_contact_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact' },
  booked_by_name: { type: String },
  booked_by_phone: { type: String },
}, { timestamps: true });

// Prevent double booking for the same user, workflow, date and time
BookingSlotSchema.index({ user_id: 1, workflow_id: 1, date: 1, time: 1 }, { unique: true });

export const BookingSlot = mongoose.model('BookingSlot', BookingSlotSchema);
