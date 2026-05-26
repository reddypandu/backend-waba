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
