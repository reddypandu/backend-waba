import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { WebhookService } from './src/services/webhookService.js';

// Mock models to test without DB connection
mongoose.models = {};
const WorkflowMock = {
    updateOne: async () => {}
};
const ConversationMock = {
    updateOne: async () => {}
};
const MessageMock = {
    create: async () => {}
};
mongoose.model('Workflow', { updateOne: () => {} });
mongoose.model('Conversation', { updateOne: () => {} });
mongoose.model('Message', { create: () => {} });

// Override WebhookService.executeWorkflowAction so it doesn't make real API calls
WebhookService.executeWorkflowAction = async (workflow, action) => {
    console.log("EXECUTE WORKFLOW ACTION CALLED WITH NODE TYPE:", action.type);
    return true;
};

async function test() {
    const workflow = {
        _id: "wf_1",
        actions: [
            { id: "send_btn_1", type: "send_buttons", buttons: [{ id: "btn_yes", title: "yes", next_step: "cond_1" }] },
            { id: "cond_1", type: "condition", conditionKeyword: "yes", next_step: "book_mtg_1" },
            { id: "book_mtg_1", type: "book_meeting", text: "Choose a time" }
        ]
    };
    
    const conv = {
        _id: "conv_1",
        workflow_step_id: "send_btn_1" // Currently at send_buttons
    };

    console.log("Simulating 'yes' button click...");
    // When user clicks 'yes', webhook receives interactive message with text 'yes' and id 'btn_yes'
    await WebhookService.checkWorkflow("user_1", conv, "yes", "btn_yes", "phone_id", "token", "conv_1", "contact_1", [workflow]);
}

test().catch(console.error);
