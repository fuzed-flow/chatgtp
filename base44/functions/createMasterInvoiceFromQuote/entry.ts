import { createClientFromRequest } from "npm:@base44/sdk@0.8.6";

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { projectId, quoteId } = await req.json();

    // Verify user is authenticated
    const user = await base44.auth.me();
    if (!user || user.role !== "admin") {
      return Response.json(
        { error: "Unauthorized: Admin access required" },
        { status: 403 }
      );
    }

    // Fetch project and quote
    const project = await base44.entities.Project.filter({ id: projectId }).then(p => p[0]);
    if (!project) {
      return Response.json({ error: "Project not found" }, { status: 404 });
    }

    const quote = await base44.entities.Quote.filter({ id: quoteId }).then(q => q[0]);
    if (!quote) {
      return Response.json({ error: "Quote not found" }, { status: 404 });
    }

    // Check if master invoice already exists for this project
    const existingMaster = await base44.entities.Invoice.filter({
      project_id: projectId,
      type: "MASTER",
    }).then(invoices => invoices[0]);

    if (existingMaster) {
      return Response.json(
        { message: "Master invoice already exists", masterId: existingMaster.id },
        { status: 200 }
      );
    }

    // Get organization for invoice numbering
    const org = await base44.entities.Organization.filter({})
      .then(orgs => orgs[0]);

    if (!org) {
      return Response.json({ error: "Organization not found" }, { status: 404 });
    }

    // Generate master invoice number
    const masterInvoiceNumber = `${org.invoice_number_prefix || "INV-"}${org.next_invoice_number}`;
    await base44.entities.Organization.update(org.id, {
      next_invoice_number: org.next_invoice_number + 1,
    });

    // Create Master Invoice
    const masterInvoice = await base44.entities.Invoice.create({
      invoice_number: masterInvoiceNumber,
      project_id: projectId,
      client_id: quote.client_id,
      quote_id: quoteId,
      type: "MASTER",
      total: quote.total || 0,
      subtotal: quote.subtotal || 0,
      tax: quote.tax || 0,
      status: "Draft",
      issue_date: new Date().toISOString().split("T")[0],
      has_payment_schedule: quote.has_payment_schedule || false,
    });

    // If no payment schedule, we're done
    if (!quote.has_payment_schedule) {
      return Response.json({
        success: true,
        masterId: masterInvoice.id,
        masterNumber: masterInvoiceNumber,
        childCount: 0,
      });
    }

    // Parse payment schedule items
    let scheduleItems = [];
    if (quote.payment_schedule_json) {
      try {
        scheduleItems = JSON.parse(quote.payment_schedule_json);
      } catch (e) {
        console.error("Failed to parse payment schedule:", e);
        scheduleItems = [];
      }
    }

    if (!Array.isArray(scheduleItems) || scheduleItems.length === 0) {
      return Response.json({
        success: true,
        masterId: masterInvoice.id,
        masterNumber: masterInvoiceNumber,
        childCount: 0,
      });
    }

    // Calculate child invoice amounts
    const totalAmount = quote.total || 0;
    let childAmounts = [];
    let runningSum = 0;

    scheduleItems.forEach((item, index) => {
      let amount = 0;
      if (item.amountType === "percent") {
        amount = Math.round((totalAmount * item.amountValue) / 100 * 100) / 100;
      } else {
        amount = item.amountValue || 0;
      }
      childAmounts.push({ index, amount, item });
      runningSum += amount;
    });

    // Handle rounding: adjust last invoice
    if (childAmounts.length > 0) {
      const remainder = Math.round((totalAmount - runningSum) * 100) / 100;
      childAmounts[childAmounts.length - 1].amount += remainder;
    }

    // Create child invoices
    const childInvoices = [];
    for (let i = 0; i < childAmounts.length; i++) {
      const { amount, item } = childAmounts[i];
      const sequenceIndex = i + 1;

      // Determine due date
      let dueDate = null;
      if (item.dueType === "date") {
        dueDate = item.dueValue;
      } else if (item.dueType === "daysAfterStart") {
        const startDate = project.start_date
          ? new Date(project.start_date)
          : new Date();
        const dueDay = new Date(startDate.getTime() + item.dueValue * 24 * 60 * 60 * 1000);
        dueDate = dueDay.toISOString().split("T")[0];
      } else if (item.dueType === "milestone") {
        dueDate = null; // Can be null for milestone-based
      }

      const childNumber = `${masterInvoiceNumber}/${sequenceIndex}`;

      const childInvoice = await base44.entities.Invoice.create({
        invoice_number: childNumber,
        project_id: projectId,
        client_id: quote.client_id,
        quote_id: quoteId,
        type: "CHILD",
        master_invoice_id: masterInvoice.id,
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

      childInvoices.push(childInvoice);
    }

    return Response.json({
      success: true,
      masterId: masterInvoice.id,
      masterNumber: masterInvoiceNumber,
      childCount: childInvoices.length,
    });
  } catch (error) {
    console.error("Error creating master invoice:", error);
    return Response.json(
      { error: error.message },
      { status: 500 }
    );
  }
});