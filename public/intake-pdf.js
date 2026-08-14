var INTAKE_NATURE_LABELS = {
  complaint: "Complaint",
  suggestions: "Suggestions",
  praise: "Praise",
};

function intakeField(label, value) {
  return [
    { text: label, style: "fieldLabel", width: "38%" },
    { text: value === null || value === undefined || value === "" ? "" : String(value), style: "fieldValue", width: "62%" },
  ];
}

function intakeSection(title) {
  return { text: title, style: "sectionTitle" };
}

function intakeDivider() {
  return { canvas: [{ type: "line", x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.6, lineColor: "#999999" }], margin: [0, 4, 0, 10] };
}

function buildIntakeDoc(t) {
  var nature = INTAKE_NATURE_LABELS[t.nature_of_request] || t.nature_of_request;
  var date = String(t.created_at || "").slice(0, 16);
  var contact = t.cellphone_number || "";
  var name = t.full_name || "";
  var district = t.district || "";
  var school = t.school_name || "";
  var description = t.description || "";

  return {
    pageSize: "A4",
    pageMargins: [40, 40, 40, 50],
    footer: function (currentPage, pageCount) {
      return {
        columns: [
          { text: "DPAD Portal - Clients' Feedback Intake Sheet", alignment: "left", style: "footerText" },
          { text: "Page " + currentPage + " of " + pageCount, alignment: "right", style: "footerText" },
        ],
        margin: [40, 10, 40, 0],
      };
    },
    styles: {
      orgHeader: { fontSize: 10, alignment: "center", margin: [0, 0, 0, 1] },
      orgHeaderBold: { fontSize: 11, bold: true, alignment: "center", margin: [0, 0, 0, 1] },
      docTitle: { fontSize: 12, bold: true, alignment: "center", margin: [0, 6, 0, 2] },
      docSubtitle: { fontSize: 9.5, alignment: "center", margin: [0, 0, 0, 10] },
      sectionTitle: { fontSize: 10, bold: true, margin: [0, 10, 0, 6], color: "#1d4518" },
      fieldLabel: { fontSize: 10, bold: true, margin: [4, 4, 4, 4] },
      fieldValue: { fontSize: 10, margin: [4, 4, 4, 4] },
      footerText: { fontSize: 8, color: "#666666" },
      disposition: { fontSize: 10, margin: [4, 4, 4, 4] },
    },
    content: [
      { text: "Republic of the Philippines", style: "orgHeader" },
      { text: "Department of Education", style: "orgHeader" },
      { text: "SCHOOLS DIVISION OF NUEVA ECIJA", style: "orgHeaderBold" },
      { text: "DIVISION PUBLIC ASSISTANCE COMMITTEE (DPAD) PORTAL", style: "orgHeaderBold" },
      intakeDivider(),
      { text: "CLIENTS' FEEDBACK INTAKE SHEET", style: "docTitle" },
      { text: "DIVISION PUBLIC ASSISTANCE DESK (DPAD) Reference & Action Transmittal Report", style: "docSubtitle" },

      intakeSection("TICKET IDENTIFICATION & ENDORSEMENT DETAILS"),
      { table: { widths: ["38%", "62%"], body: [intakeField("Ticket Reference No.:", t.arta_reference_no)] }, layout: "lightHorizontalLines" },
      { table: { widths: ["38%", "62%"], body: [intakeField("Endorsement Date:", date)] }, layout: "lightHorizontalLines" },
      { table: { widths: ["38%", "62%"], body: [intakeField("Ticket Status:", t.status)] }, layout: "lightHorizontalLines" },
      { table: { widths: ["38%", "62%"], body: [intakeField("Referred To (SDO Unit):", district)] }, layout: "lightHorizontalLines" },

      intakeSection("COMPLAINANT / CLIENT INFORMATION"),
      { table: { widths: ["38%", "62%"], body: [intakeField("Name of Client/Caller:", name)] }, layout: "lightHorizontalLines" },
      { table: { widths: ["38%", "62%"], body: [intakeField("Contact Number(s):", contact)] }, layout: "lightHorizontalLines" },
      { table: { widths: ["38%", "62%"], body: [intakeField("Email Address:", t.email_address)] }, layout: "lightHorizontalLines" },

      intakeSection("NATURE AND DETAILS OF CONCERN / COMPLAINT"),
      { table: { widths: ["38%", "62%"], body: [intakeField("Nature of Call or Request:", nature)] }, layout: "lightHorizontalLines" },
      { table: { widths: ["38%", "62%"], body: [intakeField("District:", district)] }, layout: "lightHorizontalLines" },
      { table: { widths: ["38%", "62%"], body: [intakeField("School / Office:", school)] }, layout: "lightHorizontalLines" },
      { table: { widths: ["100%"], body: [{ text: description, style: "fieldValue" }] }, layout: "lightHorizontalLines" },
      ...(t.evidence_file_name
        ? [{
            table: {
              widths: ["38%", "62%"],
              body: [intakeField("Evidence / Proof:", `${t.evidence_file_name}${t.evidence_file_url ? ` (${t.evidence_file_url})` : ""}`)],
            },
            layout: "lightHorizontalLines",
          }]
        : []),

      intakeSection("ACTION REQUIRED & SDO DISPOSITION"),
      { text: "Remarks / Action Taken by SDO DPAD:", style: "disposition" },
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: "#bbbbbb" }], margin: [0, 8, 0, 0] },
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: "#bbbbbb" }], margin: [0, 22, 0, 0] },
      { text: "Received", style: "fieldValue" },

      intakeSection("DPAD RECEIVING OFFICER"),
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: 230, y2: 0, lineWidth: 0.6, lineColor: "#333333" }], margin: [0, 26, 0, 2] },
      { text: "Public Assistance & Complaints Desk", style: "fieldValue", margin: [0, 0, 0, 12] },
    ],
    defaultStyle: { font: "Roboto" },
  };
}

function downloadIntakePdf(ticket) {
  if (typeof pdfMake === "undefined") {
    alert("The PDF library did not load. Please refresh the page and try again.");
    return;
  }
  pdfMake.createPdf(buildIntakeDoc(ticket)).download("Intake-Form-" + ticket.arta_reference_no + ".pdf");
}

function getIntakePdfBase64(ticket, callback) {
  if (typeof pdfMake === "undefined") {
    throw new Error("The PDF library did not load. Please refresh the page and try again.");
  }
  pdfMake.createPdf(buildIntakeDoc(ticket)).getBase64(callback);
}
