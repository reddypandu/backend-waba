import mongoose from 'mongoose';

const UploadSchema = new mongoose.Schema({
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true },
    url: { type: String, required: true },
    format: { type: String },
    size: { type: Number },
}, { timestamps: true });

export default mongoose.model('Upload', UploadSchema);
