import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { uploadToCloudinary } from './src/services/cloudinary.js';
import Template from './src/models/Template.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOAD_DIR = path.join(__dirname, 'src', 'public', 'uploads', 'templates');

async function migrateTemplates() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    if (!fs.existsSync(UPLOAD_DIR)) {
      console.log('Upload directory not found.');
      process.exit(0);
    }

    const files = fs.readdirSync(UPLOAD_DIR);
    console.log(`Found ${files.length} local files in ${UPLOAD_DIR}`);

    for (const file of files) {
      if (file.startsWith('.')) continue;
      
      const localFilePath = path.join(UPLOAD_DIR, file);
      
      // Check if any template points to this file (or is missing a local_url but matches timestamp)
      const timestamp = file.split('-')[0];
      
      // Look for a template that might match
      // Note: This is an heuristic. We search for templates created around that time or with the filename in any field.
      const templates = await Template.find({ 
        $or: [
          { local_url: { $regex: file } },
          { local_url: null }
        ]
      });

      console.log(`Processing file: ${file}`);
      
      let cloudinaryUrl = null;
      try {
        cloudinaryUrl = await uploadToCloudinary(localFilePath);
        console.log(`Uploaded to Cloudinary: ${cloudinaryUrl}`);
      } catch (err) {
        console.error(`Upload failed for ${file}:`, err.message);
        continue;
      }

      // Update templates that were pointing to this local file or similar
      // For now, we only update templates that explicitly reference this filename or are missing a URL
      // If a template has 'None' but was created at the same time, we could try to match, but that's risky.
      // Let's at least update templates that HAVE this filename in their local_url.
      
      const res = await Template.updateMany(
        { local_url: { $regex: file } },
        { $set: { local_url: cloudinaryUrl } }
      );
      
      console.log(`Updated ${res.modifiedCount} templates for file ${file}`);
    }

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

migrateTemplates();
