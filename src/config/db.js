import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/connectly';

const connectDB = async () => {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ MongoDB connected successfully');
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err.message);
    process.exit(1);
  }
};

mongoose.connection.on('disconnected', () => {
  console.warn('⚠️ MongoDB disconnected. Retrying...');
});

export default connectDB;
