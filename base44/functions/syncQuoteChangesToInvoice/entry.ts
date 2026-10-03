import { createClientFromRequest } from "npm:@base44/sdk@0.8.6";

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { quoteId, newTotal, newSubtotal, newTax, paymentScheduleJson, hasPaymentSchedule } = await req.json();

    // Verify user is authenticated
    const user = await base44.auth.me();
    if (!user || user.role !== "admin") {
      return Response.json(
        { error: "Unauthorized: Admin access required" },
        { status: 403 }
      );
    }

    // Find all MASTER invoices linked to this quote
    const masterInvoices = await base44.entities.Invoice.filter({
      quote_id: quoteId,
      type: "MASTER",
    });

    if (!masterInvoices || masterInvoices.length === 0) {
      return Response.json({
        success: true,
        message: "No master invoices found for this quote",
        updated: 0,
      });
    }

    let totalUpdated = 0;

    for (const master of masterInvoices) {
      // Update master invoice totals
      await base44.entities.Invoice.update(master.id, {
        total: newTotal || 0,
        subtotal: newSubtotal || 0,
        tax: newTax || 0,
        has_payment_schedule: hasPaymentSchedule || false,
      });

      // If payment schedule was disabled, delete child invoices
      if (!hasPaymentSchedule) {
        const children = await base44.entities.Invoice.filter({
          master_invoice_id: master.id,
          type: "CHILD",
        });
        for (const child of children) {
          await base44.entities.Invoice.delete(child.id);
        }
      } else if (paymentScheduleJson) {
        // If payment schedule was enabled/changed, recreate child invoices
        const children = await base44.entities.Invoice.filter({
          master_invoice_id: master.id,
          type: "CHILD",
        });

        // Delete existing children
        for (const child of children) {
          await base44.entities.Invoice.delete(child.id);
        }

        // Parse new schedule items
        let scheduleItems = [];
        try {
          scheduleItems = JSON.parse(paymentScheduleJson);
        } catch (e) {
          console.error("Failed to parse payment schedule:", e);
        }

        if (Array.isArray(scheduleItems) && scheduleItems.length > 0) {
          // Get project for start_date
          const project = await base44.entities.Project.filter({
            id: master.project_id,
          }).then(p => p[0]);

          const totalAmount = newTotal || 0;
          let childAmounts = [];
          let runningSum = 0;

          scheduleItems.forEach((item) => {
            let amount = 0;
            if (item.amountType === "percent") {
              amount = Math.round((totalAmount * item.amountValue) / 100 * 100) / 100;
            } else {
              amount = item.amountValue || 0;
            }
            childAmounts.push({ amount, item });
            runningSum += amount;
          });

          // Handle rounding
          if (childAmounts.length > 0) {
            const remainder = Math.round((totalAmount - runningSum) * 100) / 100;
            childAmounts[childAmounts.length - 1].amount += remainder;
          }

          // Create new child invoices
          for (let i = 0; i < childAmounts.length; i++) {
            const { amount, item } = childAmounts[i];
            const sequenceIndex = i + 1;

            // Determine due date
            let dueDate = null;
            if (item.dueType === "date") {
              dueDate = item.dueValue;
            } else if (item.dueType === "daysAfterStart") {
              const startDate = project?.start_date
                ? new Date(project.start_date)
                : new Date();
              const dueDay = new Date(startDate.getTime() + item.dueValue * 24 * 60 * 60 * 1000);
              dueDate = dueDay.toISOString().split("T")[0];
            }

            const childNumber = `${master.invoice_number}/${sequenceIndex}`;

            await base44.entities.Invoice.create({
              invoice_number: childNumber,
              project_id: master.project_id,
              client_id: master.client_id,
              quote_id: quoteId,
              type: "CHILD",
              master_invoice_id: master.id,
              sequence_index: sequenceIndex,
              total: amount,
              subtotal: amount,
              tax: 0,
              status: "Draft",
              issue_date: new Date().toISOString().split("T")[0],
              due_date: dueDate,
              schedule_source_json: JSON.stringify(item),
              notes: item.dueType === "milestone"
                ? `Due on milestone: ${item.dueValue}`
                : item.notes || "",
            });
          }
        }
      }

      totalUpdated++;
    }

    return Response.json({
      success: true,
      message: `Updated ${totalUpdated} master invoice(s)`,
      updated: totalUpdated,
    });
  } catch (error) {
    console.error("Error syncing quote changes to invoice:", error);
    return Response.json(
      { error: error.message },
      { status: 500 }
    );
  }
});