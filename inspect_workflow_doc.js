import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Workflow } from './src/models/Automation.js';

dotenv.config();

async function inspectWorkflow() {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Connected to MongoDB.");

    const wf = await Workflow.findOne({ is_active: true }).sort({ updatedAt: -1 });
    if (!wf) {
        console.log("No active workflow found!");
        process.exit(1);
    }

    console.log(`\n==================================================`);
    console.log(`Workflow Name: "${wf.name}" (${wf._id})`);
    console.log(`Trigger Type: "${wf.trigger_type}", Value: "${wf.trigger_value}"`);
    console.log(`==================================================\n`);

    wf.actions.forEach((a, idx) => {
        console.log(`[Action ${idx + 1}] ID: ${a.id}`);
        console.log(`   Type: ${a.type}`);
        console.log(`   Text / Question: "${a.text || a.question || ''}"`);
        console.log(`   next_step: "${a.next_step || ''}"`);
        console.log(`   success_next_step: "${a.success_next_step || ''}"`);
        console.log(`   failed_next_step: "${a.failed_next_step || ''}"`);
        if (a.buttons && a.buttons.length > 0) {
            console.log(`   Buttons:`, a.buttons.map(b => `${b.title} -> ${b.next_step}`));
        }
        console.log(`--------------------------------------------------`);
    });

    process.exit(0);
}

inspectWorkflow().catch(err => {
    console.error("Error:", err);
    process.exit(1);
});
