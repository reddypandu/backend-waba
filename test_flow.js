import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { WebhookService } from './src/services/webhookService.js';

dotenv.config();

async function runTest() {
    await mongoose.connect(process.env.MONGODB_URI);
    const Workflow = (await import('./src/models/Automation.js')).Workflow;
    const Conversation = (await import('./src/models/Conversation.js')).Conversation;
    const Contact = (await import('./src/models/Contact.js')).default;

    const wf = await Workflow.findById("6a7995138b75876446537a0e");
    if (!wf) {
        console.log("Workflow not found");
        process.exit(1);
    }
    
    console.log("Found workflow:", wf.name, "with", wf.actions.length, "actions");
    wf.actions.forEach(a => console.log(" - Action:", a.id, a.type, a.next_step || (a.buttons ? a.buttons.map(b => b.title + '->' + b.next_step).join(', ') : '')));

    let contact = await Contact.findOne({ user_id: wf.user_id });
    let conv = await Conversation.findOne({ user_id: wf.user_id });

    // Step 1: Send "Schedule meeting"
    console.log("\n--- STEP 1: Sending 'Schedule meeting' ---");
    // Clear previous step ID for fresh test
    conv.workflow_id = null;
    conv.workflow_step_id = null;
    await conv.save();

    await WebhookService.checkWorkflow(
        wf.user_id,
        conv,
        "Schedule meeting",
        null,
        "1098909889979963",
        process.env.WA_TOKEN,
        conv._id,
        contact._id
    );

    // Refresh conv state
    conv = await Conversation.findById(conv._id);
    console.log("After Step 1, Conversation step ID is:", conv.workflow_step_id);

    // Step 2: Click "yes" button
    console.log("\n--- STEP 2: Clicking 'yes' button ---");
    const sendButtonsAction = wf.actions.find(a => a.type === 'send_buttons');
    const yesBtn = sendButtonsAction?.buttons?.find(b => b.title.toLowerCase() === 'yes');
    console.log("Yes button ID:", yesBtn?.id, "points to next_step:", yesBtn?.next_step);

    await WebhookService.checkWorkflow(
        wf.user_id,
        conv,
        "yes",
        yesBtn?.id || "yes",
        "1098909889979963",
        process.env.WA_TOKEN,
        conv._id,
        contact._id
    );

    conv = await Conversation.findById(conv._id);
    console.log("After Step 2, Conversation step ID is:", conv.workflow_step_id);

    process.exit(0);
}

runTest().catch(console.error);
