import express from 'express';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

async function test() {
  try {
    console.log('Testing import of whatsapp.js...');
    const whatsapp = await import('./src/routes/whatsapp.js');
    console.log('Import successful!');
    process.exit(0);
  } catch (err) {
    console.error('FAILED TO IMPORT:', err);
    process.exit(1);
  }
}
test();
