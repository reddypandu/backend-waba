import { BookingSlot } from '../models/BookingSlot.js';
import { WorkflowTransaction } from '../models/WorkflowTransaction.js';
import { Workflow } from '../models/Automation.js';
import Conversation from '../models/Conversation.js';
import Contact from '../models/Contact.js';
import WhatsAppAccount from '../models/WhatsAppAccount.js';
import { WebhookService } from '../services/webhookService.js';

export class BusinessWorkflowController {

  // Fetch available slots for a given date
  static async getAvailableSlots(req, res) {
    try {
      const { workflowId } = req.params;
      const { date } = req.query; // YYYY-MM-DD
      
      const workflow = await Workflow.findById(workflowId);
      if (!workflow) return res.status(404).json({ error: 'Workflow not found' });

      // Find book meeting action to get calendar settings
      const bookAction = workflow.actions.find(a => a.type === 'book_meeting');
      const startTime = bookAction?.startTime || "09:00";
      const endTime = bookAction?.endTime || "17:00";
      const slotDuration = bookAction?.slotDuration || 30;

      // Generate slots dynamically
      const allSlots = [];
      const [startHour, startMin] = startTime.split(':').map(Number);
      const [endHour, endMin] = endTime.split(':').map(Number);
      
      let current = new Date();
      current.setHours(startHour, startMin, 0, 0);
      
      const end = new Date();
      end.setHours(endHour, endMin, 0, 0);
      
      while (current < end) {
        const hh = String(current.getHours()).padStart(2, '0');
        const mm = String(current.getMinutes()).padStart(2, '0');
        allSlots.push(`${hh}:${mm}`);
        current.setMinutes(current.getMinutes() + slotDuration);
      }

      const bookedSlots = await BookingSlot.find({
        workflow_id: workflowId,
        date,
        status: { $in: ['booked', 'blocked'] }
      }).select('time');

      const bookedTimes = bookedSlots.map(s => s.time);
      
      const slotsWithStatus = allSlots.map(time => ({
        time,
        status: bookedTimes.includes(time) ? 'booked' : 'available'
      }));

      res.json({ success: true, date, slots: slotsWithStatus });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  // Book a slot
  static async bookSlot(req, res) {
    try {
      const { workflowId, conversationId } = req.params;
      const { date, time, name, email } = req.body;

      const conversation = await Conversation.findById(conversationId);
      if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
      
      const workflow = await Workflow.findById(workflowId);
      if (!workflow) return res.status(404).json({ error: 'Workflow not found' });

      // Check if slot is already booked
      const existing = await BookingSlot.findOne({ workflow_id: workflowId, date, time, status: { $in: ['booked', 'blocked'] } });
      if (existing) {
        return res.status(400).json({ error: 'Slot is already booked' });
      }

      // Create booking
      const booking = await BookingSlot.create({
        user_id: workflow.user_id,
        workflow_id: workflow._id,
        date,
        time,
        status: 'booked',
        booked_by_contact_id: conversation.contact_id,
        booked_by_name: name,
        booked_by_phone: conversation.phone_number
      });

      // Find the book_meeting action to get its next step
      const bookAction = workflow.actions.find(a => a.type === 'book_meeting');
      let amount = 0;
      let nextStepId = bookAction?.next_step;
      
      const nextAction = workflow.actions.find(a => a.id === nextStepId);
      if (nextAction && nextAction.type === 'payment_invoice') {
        amount = nextAction.amount || 0;
      }

      // Create transaction
      const transaction = await WorkflowTransaction.create({
        user_id: workflow.user_id,
        workflow_id: workflow._id,
        contact_id: conversation.contact_id,
        conversation_id: conversation._id,
        customer_name: name,
        phone_number: conversation.phone_number,
        email,
        service_name: workflow.name,
        meeting_date: new Date(date),
        meeting_time: time,
        meeting_id: booking._id.toString(),
        payment_amount: amount,
        payment_status: amount > 0 ? 'pending' : 'completed',
        status: 'in_progress'
      });

      // Proceed to next step in workflow
      if (nextAction) {
        const waAccount = await WhatsAppAccount.findOne({ user_id: workflow.user_id });
        
        await WebhookService.executeWorkflowAction(
          workflow,
          nextAction,
          waAccount.phone_number_id,
          waAccount.access_token,
          conversation,
          conversation._id,
          conversation.contact_id
        );
      }

      res.json({ success: true, booking, transactionId: transaction._id });
    } catch (err) {
      if (err.code === 11000) return res.status(400).json({ error: 'Slot is already booked' });
      res.status(500).json({ error: err.message });
    }
  }

  // Get transaction details for payment
  static async getTransaction(req, res) {
    try {
      const { transactionId } = req.params;
      const transaction = await WorkflowTransaction.findById(transactionId);
      if (!transaction) return res.status(404).json({ error: 'Transaction not found' });
      
      res.json({ success: true, transaction });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  // Confirm payment
  static async confirmPayment(req, res) {
    try {
      const { transactionId } = req.params;
      const { paymentId } = req.body;

      const transaction = await WorkflowTransaction.findByIdAndUpdate(
        transactionId,
        { payment_status: 'completed', transaction_id: paymentId },
        { new: true }
      );

      if (!transaction) return res.status(404).json({ error: 'Transaction not found' });

      const workflow = await Workflow.findById(transaction.workflow_id);
      const conversation = await Conversation.findById(transaction.conversation_id);
      
      // Find the payment_invoice action to get its next step
      const paymentAction = workflow.actions.find(a => a.type === 'payment_invoice');
      if (paymentAction && paymentAction.next_step) {
        let nextAction = workflow.actions.find(a => a.id === paymentAction.next_step);
        
        // Skip save_data node and go to the next one if present
        if (nextAction && nextAction.type === 'save_data') {
           await WorkflowTransaction.findByIdAndUpdate(transactionId, { status: 'completed' });
           if (nextAction.next_step) {
             nextAction = workflow.actions.find(a => a.id === nextAction.next_step);
           } else {
             nextAction = null;
           }
        }
        
        if (nextAction) {
          const waAccount = await WhatsAppAccount.findOne({ user_id: workflow.user_id });
          await WebhookService.executeWorkflowAction(
            workflow,
            nextAction,
            waAccount.phone_number_id,
            waAccount.access_token,
            conversation,
            conversation._id,
            conversation.contact_id
          );
        }
      }

      res.json({ success: true, transaction });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  // Admin: Get transactions
  static async getAdminTransactions(req, res) {
    try {
      const transactions = await WorkflowTransaction.find({ user_id: req.user.id })
        .populate('workflow_id', 'name')
        .sort({ createdAt: -1 });
      res.json({ success: true, transactions });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
}
