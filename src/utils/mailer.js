import { Resend } from 'resend';
import dotenv from 'dotenv';

dotenv.config();

const resend = new Resend(process.env.RESEND_API_KEY);

export const sendOtpEmail = async (to, otp) => {
  try {
    const { data, error } = await resend.emails.send({
      from: 'Yestick Ai Auth <verify@yestickai.com>', // Change after adding your domain in Resend dashboard
      to: [to],
      subject: 'Your Yestick Ai Verification Code',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eeeeee; border-radius: 10px;">
          <h2 style="color: #333333; text-align: center;">Welcome to Yestick Ai!</h2>
          <p style="color: #666666; font-size: 16px;">Please use the verification code below to complete your registration:</p>
          <div style="background-color: #f4f4f4; padding: 15px; border-radius: 5px; text-align: center; margin: 20px 0;">
            <h1 style="color: #10b981; margin: 0; font-size: 32px; letter-spacing: 5px;">${otp}</h1>
          </div>
          <p style="color: #999999; font-size: 14px; text-align: center;">This code will expire in 5 minutes.</p>
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
