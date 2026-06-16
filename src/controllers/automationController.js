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
      const workflows = await Workflow.find({ user_id: req.user.id }).sort({ createdAt: -1 });
      res.json({ workflows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  static async getWorkflowAnalytics(req, res) {
    try {
      const workflows = await Workflow.find({ user_id: req.user.id })
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
}
