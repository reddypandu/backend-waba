import { Resend } from 'resend';
import dotenv from 'dotenv';

dotenv.config();

const resend = new Resend(process.env.RESEND_API_KEY);

export const sendOtpEmail = async (to, otp, type = 'signup') => {
  try {
    if (!process.env.RESEND_API_KEY) {
      console.error('[Mailer] Missing RESEND_API_KEY in environment variables');
      return false;
    }

    const isSignup = type === 'signup';
    const subject = isSignup ? 'Your Yestick Ai Verification Code' : 'Reset your Yestick Ai password';
    const title = isSignup ? 'Welcome to Yestick Ai!' : 'Password Reset Request';
    const message = isSignup 
      ? 'Please use the verification code below to complete your registration:' 
      : 'We received a request to reset your password. Please use the verification code below to proceed:';

    const { data, error } = await resend.emails.send({
      from: 'Yestick Ai Auth <verify@yestickai.com>', // Change after adding your domain in Resend dashboard
      to: [to],
      subject: subject,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eeeeee; border-radius: 10px;">
          <h2 style="color: #333333; text-align: center;">${title}</h2>
          <p style="color: #666666; font-size: 16px;">${message}</p>
          <div style="background-color: #f4f4f4; padding: 15px; border-radius: 5px; text-align: center; margin: 20px 0;">
            <h1 style="color: #10b981; margin: 0; font-size: 32px; letter-spacing: 5px;">${otp}</h1>
          </div>
          <p style="color: #999999; font-size: 14px; text-align: center;">This code will expire in 5 minutes. If you did not request this, please ignore this email.</p>
        </div>
      `,
    });

    if (error) {
      console.error('Error sending OTP Email:', error);
      return false;
    }

    console.log('OTP Email sent successfully. ID:', data.id);
    return true;
  } catch (error) {
    console.error('Error sending OTP Email:', error);
    return false;
  }
};
