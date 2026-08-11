import { AutoReply, Workflow } from '../models/Automation.js';

export class AutomationController {

  static async getAutoReplies(req, res) {
    try {
      const replies = await AutoReply.find({ user_id: req.user.id }).sort({ createdAt: -1 });
      res.json({ replies });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  static async createAutoReply(req, res) {
    try {
      const { keyword, match_type, response, is_active } = req.body;
      const reply = await AutoReply.findOneAndUpdate(
        { user_id: req.user.id, keyword },
        { $set: { match_type, response, is_active } },
        { upsert: true, new: true }
      );
      res.status(201).json({ success: true, reply });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  static async updateAutoReply(req, res) {
    try {
      const { id } = req.params;
      const reply = await AutoReply.findOneAndUpdate(
        { _id: id, user_id: req.user.id },
        { $set: req.body },
        { new: true }
      );
      if (!reply) return res.status(404).json({ error: 'AutoReply not found' });
      res.json({ success: true, reply });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  static async deleteAutoReply(req, res) {
    try {
      const { id } = req.params;
      await AutoReply.findOneAndDelete({ _id: id, user_id: req.user.id });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  // Workflows (More advanced automations)
  static async getWorkflows(req, res) {
    try {
      const { type } = req.query;
      const query = { user_id: req.user.id };
      if (type) query.workflow_type = type;
      else query.workflow_type = { $ne: 'business' }; // Default standard workflows
      
      const workflows = await Workflow.find(query).sort({ createdAt: -1 });
      res.json({ workflows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  static async getWorkflowAnalytics(req, res) {
    try {
      const { type } = req.query;
      const query = { user_id: req.user.id };
      if (type) query.workflow_type = type;
      else query.workflow_type = { $ne: 'business' };
      
      const workflows = await Workflow.find(query)
        .select('name trigger_type trigger_value is_active actions analytics createdAt updatedAt')
        .sort({ updatedAt: -1 });

      const totals = workflows.reduce(
        (acc, workflow) => {
          const analytics = workflow.analytics || {};
          acc.trigger_count += analytics.trigger_count || 0;
          acc.execution_count += analytics.execution_count || 0;
          acc.conversion_count += analytics.conversion_count || 0;
          acc.failed_count += analytics.failed_count || 0;
          if (analytics.last_triggered_at && (!acc.last_activity_at || analytics.last_triggered_at > acc.last_activity_at)) {
            acc.last_activity_at = analytics.last_triggered_at;
          }
          if (analytics.last_executed_at && (!acc.last_activity_at || analytics.last_executed_at > acc.last_activity_at)) {
            acc.last_activity_at = analytics.last_executed_at;
          }
          return acc;
        },
        {
          workflow_count: workflows.length,
          active_count: workflows.filter((workflow) => workflow.is_active).length,
          trigger_count: 0,
          execution_count: 0,
          conversion_count: 0,
          failed_count: 0,
          last_activity_at: null,
        },
      );

      const rows = workflows.map((workflow) => {
        const analytics = workflow.analytics || {};
        const triggerCount = analytics.trigger_count || 0;
        const executionCount = analytics.execution_count || 0;
        const conversionCount = analytics.conversion_count || 0;
        return {
          _id: workflow._id,
          name: workflow.name,
          trigger_type: workflow.trigger_type,
          trigger_value: workflow.trigger_value,
          is_active: workflow.is_active,
          steps_count: Array.isArray(workflow.actions) ? workflow.actions.length : 0,
          trigger_count: triggerCount,
          execution_count: executionCount,
          conversion_count: conversionCount,
          failed_count: analytics.failed_count || 0,
          conversion_rate: triggerCount ? Math.round((conversionCount / triggerCount) * 100) : 0,
          execution_rate: triggerCount ? Math.round((executionCount / triggerCount) * 100) : 0,
          last_triggered_at: analytics.last_triggered_at,
          last_executed_at: analytics.last_executed_at,
          last_failed_at: analytics.last_failed_at,
        };
      });

      res.json({ totals, workflows: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  static async createWorkflow(req, res) {
    try {
      const workflow = await Workflow.create({
        user_id: req.user.id,
        ...req.body
      });
      res.status(201).json({ success: true, workflow });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  static async updateWorkflow(req, res) {
    try {
      const { id } = req.params;
      const workflow = await Workflow.findOneAndUpdate(
        { _id: id, user_id: req.user.id },
        { $set: req.body },
        { new: true }
      );
      if (!workflow) return res.status(404).json({ error: 'Workflow not found' });
      res.json({ success: true, workflow });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  static async deleteWorkflow(req, res) {
    try {
      const { id } = req.params;
      await Workflow.findOneAndDelete({ _id: id, user_id: req.user.id });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  static async exportWorkflowData(req, res) {
    try {
      const { id } = req.params;
      const workflow = await Workflow.findOne({ _id: id, user_id: req.user.id });
      if (!workflow) return res.status(404).json({ error: 'Workflow not found' });

      const BookingSlot = (await import('../models/BookingSlot.js')).BookingSlot;
      const WorkflowTransaction = (await import('../models/WorkflowTransaction.js')).WorkflowTransaction;
      const Conversation = (await import('../models/Conversation.js')).default;

      const slots = await BookingSlot.find({ workflow_id: id }).sort({ createdAt: -1 });
      const transactions = await WorkflowTransaction.find({ workflow_id: id }).sort({ createdAt: -1 });

      const rows = [];
      const processedKeys = new Set();
      const processedConvIds = new Set();

      for (const slot of slots) {
        if (slot.conversation_id) processedConvIds.add(slot.conversation_id.toString());
        const slotPhone = slot.booked_by_phone || slot.phone_number || '';
        const slotLast10 = slotPhone ? slotPhone.slice(-10) : '';

        const tx = transactions.find(t => {
          if (t.conversation_id && slot.conversation_id && t.conversation_id.toString() === slot.conversation_id.toString()) return true;
          if (t.meeting_id && t.meeting_id === slot._id.toString()) return true;
          if (slotLast10 && t.phone_number && t.phone_number.slice(-10) === slotLast10) return true;
          return false;
        });

        const conv = (slot.conversation_id ? await Conversation.findById(slot.conversation_id) : null) ||
                     (slotLast10 ? await Conversation.findOne({ phone_number: { $regex: slotLast10 + "$" } }) : null) ||
                     (tx?.conversation_id ? await Conversation.findById(tx.conversation_id) : null);

        const answersStr = conv?.variables ? Object.entries(conv.variables).map(([k, v]) => `${k}: ${v}`).join('; ') : '';
        const name = slot.booked_by_name || slot.customer_name || tx?.customer_name || conv?.name || 'Customer';
        const phone = slot.booked_by_phone || slot.phone_number || tx?.phone_number || conv?.phone_number || '';

        if (tx) processedKeys.add(tx._id.toString());
        rows.push({
          date: slot.date || '',
          time: slot.time || '',
          name,
          phone,
          answers: answersStr,
          workflow: workflow.name,
          amount: tx?.payment_amount != null ? tx.payment_amount : 'N/A',
          payment_status: tx?.payment_status || 'N/A',
          booking_status: slot.status || 'booked',
          created_at: slot.createdAt ? new Date(slot.createdAt).toISOString() : ''
        });
      }

      for (const tx of transactions) {
        if (tx.conversation_id) processedConvIds.add(tx.conversation_id.toString());
        if (!processedKeys.has(tx._id.toString())) {
          const txLast10 = tx.phone_number ? tx.phone_number.slice(-10) : '';
          const conv = (tx.conversation_id ? await Conversation.findById(tx.conversation_id) : null) ||
                       (txLast10 ? await Conversation.findOne({ phone_number: { $regex: txLast10 + "$" } }) : null);
          const answersStr = conv?.variables ? Object.entries(conv.variables).map(([k, v]) => `${k}: ${v}`).join('; ') : '';
          const formattedDate = tx.meeting_date ? new Date(tx.meeting_date).toISOString().split('T')[0] : '';

          rows.push({
            date: formattedDate,
            time: tx.meeting_time || '',
            name: tx.customer_name || conv?.name || 'Customer',
            phone: tx.phone_number || '',
            answers: answersStr,
            workflow: workflow.name,
            amount: tx.payment_amount != null ? tx.payment_amount : 0,
            payment_status: tx.payment_status || 'pending',
            booking_status: 'N/A',
            created_at: tx.createdAt ? new Date(tx.createdAt).toISOString() : ''
          });
        }
      }

      const conversations = await Conversation.find({ user_id: req.user.id, workflow_id: id }).sort({ updatedAt: -1 });
      for (const conv of conversations) {
        if (!processedConvIds.has(conv._id.toString())) {
          const answersStr = conv?.variables ? Object.entries(conv.variables).map(([k, v]) => `${k}: ${v}`).join('; ') : '';
          rows.push({
            date: '',
            time: '',
            name: conv.name || 'Customer',
            phone: conv.phone_number || '',
            answers: answersStr,
            workflow: workflow.name,
            amount: 0,
            payment_status: 'N/A',
            booking_status: 'completed',
            created_at: conv.updatedAt ? new Date(conv.updatedAt).toISOString() : ''
          });
        }
      }

      let csv = 'Date,Time,Customer Name,Phone Number,Collected Q&A Responses,Workflow Name,Amount (INR),Payment Status,Booking Status,Created At\n';
      for (const r of rows) {
        const sanitize = (val) => `"${String(val || '').replace(/"/g, '""')}"`;
        csv += `${sanitize(r.date)},${sanitize(r.time)},${sanitize(r.name)},${sanitize(r.phone)},${sanitize(r.answers)},${sanitize(r.workflow)},${sanitize(r.amount)},${sanitize(r.payment_status)},${sanitize(r.booking_status)},${sanitize(r.created_at)}\n`;
      }

      const filename = `${workflow.name.replace(/[^a-z0-9]/gi, '_')}_data.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.status(200).send('\uFEFF' + csv);
    } catch (err) {
      console.error('Error exporting workflow data:', err);
      res.status(500).json({ error: err.message });
    }
  }
}
