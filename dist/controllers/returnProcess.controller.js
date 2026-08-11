"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RETURN_STEPS = void 0;
exports.listReturnEvents = listReturnEvents;
exports.createReturnEvent = createReturnEvent;
const prisma_1 = require("../config/prisma");
const fileUrl_1 = require("../utils/fileUrl");
exports.RETURN_STEPS = [
    "DEINITIALIZATION_INITIATED",
    "DEFECT_REPORTED",
    "MACHINE_COLLECTED",
    "MACHINE_RECEIVED_WAREHOUSE",
    "REFUND_INITIATED",
    "PAYMENT_REFUNDED"
];
const STEP_STATUSES = {
    DEINITIALIZATION_INITIATED: ["PENDING", "COMPLETED"],
    DEFECT_REPORTED: ["YES", "NO"],
    MACHINE_COLLECTED: ["PENDING", "COMPLETED"],
    MACHINE_RECEIVED_WAREHOUSE: ["PENDING", "COMPLETED"],
    REFUND_INITIATED: ["PENDING", "COMPLETED"],
    PAYMENT_REFUNDED: ["PENDING", "COMPLETED"]
};
async function listReturnEvents(req, res) {
    try {
        const events = await prisma_1.prisma.returnProcessEvent.findMany({
            where: { customerId: req.params.id },
            orderBy: { createdAt: "desc" }
        });
        res.json({ success: true, events });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}
async function createReturnEvent(req, res) {
    try {
        const { step, status, eventDate, remarks } = req.body;
        if (!exports.RETURN_STEPS.includes(step)) {
            return res.status(400).json({ success: false, message: "Invalid step" });
        }
        if (!STEP_STATUSES[step].includes(status)) {
            return res.status(400).json({ success: false, message: "Invalid status for this step" });
        }
        if (step === "DEFECT_REPORTED" && status === "YES" && !remarks?.trim()) {
            return res.status(400).json({ success: false, message: "Remarks are required when a defect is reported" });
        }
        if (!eventDate) {
            return res.status(400).json({ success: false, message: "eventDate is required" });
        }
        const customer = await prisma_1.prisma.customer.findUnique({ where: { id: req.params.id } });
        if (!customer) {
            return res.status(404).json({ success: false, message: "Customer not found" });
        }
        const files = req.files;
        const defectImageUrls = step === "DEFECT_REPORTED" && status === "YES" && files
            ? (0, fileUrl_1.buildFileUrls)(files, "defectImages")
            : [];
        const event = await prisma_1.prisma.returnProcessEvent.create({
            data: {
                customerId: req.params.id,
                step,
                status,
                eventDate: new Date(eventDate),
                remarks: remarks?.trim() || null,
                defectImageUrls
            }
        });
        res.json({ success: true, event });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}
//# sourceMappingURL=returnProcess.controller.js.map