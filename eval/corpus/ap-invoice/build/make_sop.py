"""Builds the synthetic SOP used as a source in the AP invoice eval case.
Run: python3 make_sop.py ../sources/04-SOP-FIN-AP-004-vendor-invoice-processing.docx
"""
import sys
from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor, Cm

out = sys.argv[1]
d = Document()
for s in d.sections:
    s.left_margin = s.right_margin = Cm(2.2)
    s.top_margin = s.bottom_margin = Cm(2)
st = d.styles['Normal']; st.font.name = 'Calibri'; st.font.size = Pt(10.5)

def shade(cell, hex_):
    tcPr = cell._tc.get_or_add_tcPr(); shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear'); shd.set(qn('w:color'), 'auto'); shd.set(qn('w:fill'), hex_); tcPr.append(shd)

def table(rows, widths=None, header=True):
    t = d.add_table(rows=len(rows), cols=len(rows[0])); t.style = 'Table Grid'; t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, r in enumerate(rows):
        for j, v in enumerate(r):
            c = t.cell(i, j); c.text = ''
            p = c.paragraphs[0]; run = p.add_run(str(v)); run.font.size = Pt(9.5)
            if header and i == 0:
                run.bold = True; shade(c, 'D9E2F3')
            if widths: c.width = Cm(widths[j])
    d.add_paragraph()
    return t

hdr = d.sections[0].header.paragraphs[0]
hdr.text = 'Kaveri Industrial Components Ltd. | Finance Shared Services, Pune | INTERNAL'
hdr.runs[0].font.size = Pt(8); hdr.runs[0].font.color.rgb = RGBColor(0x59, 0x59, 0x59)
ftr = d.sections[0].footer.paragraphs[0]
ftr.text = 'SOP-FIN-AP-004 v3.2 | Uncontrolled when printed'
ftr.runs[0].font.size = Pt(8); ftr.alignment = WD_ALIGN_PARAGRAPH.CENTER

t = d.add_paragraph(); r = t.add_run('Standard Operating Procedure'); r.font.size = Pt(12); r.font.color.rgb = RGBColor(0x2F, 0x54, 0x96)
t = d.add_paragraph(); r = t.add_run('Vendor Invoice Processing (India)'); r.bold = True; r.font.size = Pt(20)
table([
    ['Document ID', 'SOP-FIN-AP-004'],
    ['Version', '3.2'],
    ['Effective date', '1 April 2026'],
    ['Process owner', 'Meera Iyer, Manager - Accounts Payable'],
    ['Approved by', 'Arjun Malhotra, Finance Controller'],
    ['Next review', '31 March 2027'],
], widths=[4.5, 11], header=False)

d.add_heading('1. Purpose', level=1)
d.add_paragraph('This procedure defines how vendor invoices received by Kaveri Industrial Components Ltd. (company code 1000) are recorded, validated, approved and posted in SAP S/4HANA so that suppliers are paid accurately and on time and statutory requirements are met.')

d.add_heading('2. Scope', level=1)
d.add_paragraph('In scope:', style=None).runs[0].bold = True
for x in ['Purchase-order (PO) and non-PO vendor invoices for company code 1000 (India).',
          'Invoices received by email at ap.invoices@kaveri-ic.example and paper invoices received at the Pune office.']:
    d.add_paragraph(x, style='List Bullet')
d.add_paragraph('Out of scope:').runs[0].bold = True
for x in ['Payment runs (F110), performed by Treasury under SOP-FIN-TR-002.',
          'Vendor master creation and changes, performed by the Vendor Master Data team under SOP-FIN-MD-001.',
          'Employee expense claims, processed in SAP Concur.',
          'Kaveri UK Ltd., which uses Workday Financials.',
          'Month-end GR/IR clearing and accruals, and monthly GST input credit reconciliation (GSTR-2B).']:
    d.add_paragraph(x, style='List Bullet')

d.add_heading('3. Definitions', level=1)
table([
    ['Term', 'Meaning'],
    ['PO invoice', 'An invoice that references a purchase order in SAP.'],
    ['Non-PO invoice', 'An invoice without a purchase order, e.g. utilities, rent, professional fees.'],
    ['GR', 'Goods receipt posted in SAP (MIGO) for a purchase order.'],
    ['Three-way match', 'Comparison of invoice, purchase order and goods receipt for quantity and price.'],
    ['Park', 'Saving an invoice in SAP (MIR7) without posting it.'],
    ['DoA', 'Delegation of Authority matrix issued by Finance.'],
    ['MSE', 'Micro or small enterprise registered under the MSMED Act, 2006.'],
], widths=[4, 11.5])

d.add_heading('4. Roles and responsibilities', level=1)
table([
    ['Role', 'Responsibilities'],
    ['AP Clerk', 'Logs, validates, enters, parks and posts invoices; requests GRs and approvals; attaches invoice images; maintains the AP tracker.'],
    ['AP Team Lead', 'Reviews invoices of INR 5,00,000 and above before posting; handles escalations; maintains the approver mapping.'],
    ['AP Manager', 'Owns this SOP; monitors KPIs; resolves policy questions.'],
    ['Requester / Stores', 'Posts goods receipts in SAP; confirms whether goods or services were received.'],
    ['Buyer (Procurement)', 'Resolves price and quantity variances: amends the PO or obtains a credit note or revised invoice from the vendor.'],
    ['Cost Centre Owner and DoA approvers', 'Approve non-PO invoices within their authority.'],
    ['Vendor Master Data team', 'Verifies and applies any vendor master change, including bank details, after a call-back to the vendor.'],
], widths=[4.5, 11])

d.add_heading('5. Policy rules', level=1)
rules = [
    '5.1 Price tolerance: an invoice may be posted when the unit price differs from the PO price by no more than 2% or INR 5,000 per invoice, whichever is lower. Larger differences must be resolved by the Buyer before posting.',
    '5.2 Quantity: the invoiced quantity must not exceed the quantity received (GR). No tolerance applies.',
    '5.3 Duplicates: an invoice with the same vendor, the same invoice number and the same gross amount as an invoice already recorded in the same financial year is a duplicate and must not be posted.',
    '5.4 Four-eyes review: every invoice with a gross amount of INR 5,00,000 or more must be reviewed by the AP Team Lead before posting.',
    '5.5 Bank details: AP must not process an invoice whose bank details differ from the vendor master. The change is routed to the Vendor Master Data team, which verifies it by calling the vendor on the registered number.',
    '5.6 Non-PO approvals follow the DoA thresholds below. Approval evidence must be saved with the invoice.',
    '5.7 Invoices must be addressed to Kaveri Industrial Components Ltd. and show its GSTIN and the vendor GSTIN registered in the vendor master.',
]
for x in rules: d.add_paragraph(x)
d.add_paragraph('Table 1. DoA thresholds for non-PO invoices').runs[0].italic = True
table([
    ['Gross invoice amount (INR)', 'Required approval'],
    ['Up to 2,00,000', 'Cost Centre Owner'],
    ['Above 2,00,000 up to 10,00,000', 'Cost Centre Owner and Department Head'],
    ['Above 10,00,000', 'Cost Centre Owner, Department Head and Finance Controller'],
], widths=[6, 9.5])

d.add_heading('6. Procedure', level=1)
proc = [
 ('6.1 Receive invoice', 'Vendors send invoices as PDF to ap.invoices@kaveri-ic.example. Paper invoices received at the Pune office are scanned by the AP Clerk on the office scanner and sent to the same mailbox.'),
 ('6.2 Log the invoice', 'Save the PDF in the vendor folder of the SharePoint library "AP Invoices" and record it in the AP tracker (vendor, invoice number, invoice date, gross amount, PO number, date received, status "Received").'),
 ('6.3 Check mandatory fields', 'Confirm the invoice shows: Kaveri legal name and GSTIN; vendor name and GSTIN; invoice number and date; PO number (PO invoices); HSN/SAC codes; taxable value and tax breakup. If any item is missing or wrong, or the invoice is addressed to another legal entity, return it to the vendor using template AP-T01 and set status "Returned".'),
 ('6.4 Validate the vendor', 'In SAP (transaction BP), confirm the vendor exists, is not blocked for posting and that the GSTIN matches. If bank details on the invoice differ from the vendor master, follow rule 5.5: raise a ServiceNow request to Vendor Master Data and set status "On hold - vendor master".'),
 ('6.5 Check for duplicates', 'Search SAP (FBL1N) and the AP tracker by vendor and invoice number. Apply rule 5.3. If the invoice is a duplicate, do not post; set status "Duplicate" and inform the vendor.'),
 ('6.6 Enter PO invoices', 'Enter the invoice in MIRO with reference to the PO. If no GR exists for the invoiced quantity, park the invoice (MIR7), email the requester or stores to post the GR and set status "Waiting GR". Send a reminder after 3 working days and escalate to the AP Team Lead after 7 working days.'),
 ('6.7 Resolve variances', 'If SAP shows a price or quantity variance beyond rules 5.1 or 5.2, park the invoice, email the Buyer with the PO and invoice, and set status "Variance". The Buyer either amends the PO or obtains a credit note or revised invoice from the vendor.'),
 ('6.8 Approve non-PO invoices', 'Email the invoice to the approver(s) required by Table 1. Send a reminder after 2 working days and escalate to the Finance Controller\'s office after 5 working days. Save the approval email as PDF in the vendor folder.'),
 ('6.9 Enter non-PO invoices', 'Enter the approved invoice in FB60 with the GL account and cost centre.'),
 ('6.10 Four-eyes review', 'For invoices of INR 5,00,000 or more, the AP Team Lead reviews the invoice, PO or approval, GL coding and tax before posting (rule 5.4).'),
 ('6.11 Post and attach', 'Post the invoice. Attach the invoice PDF to the SAP document using Services for Object > Create Attachment.'),
 ('6.12 Close the record', 'Update the AP tracker with the SAP document number and status "Posted". Posted invoices are released for the Treasury payment run.'),
]
for h, txt in proc:
    p = d.add_paragraph(); r = p.add_run(h); r.bold = True
    d.add_paragraph(txt)
d.add_paragraph('The process flow is shown in Appendix A (AP-Invoice-AsIs.drawio).')

d.add_heading('7. Exception handling', level=1)
table([
    ['Exception', 'Action', 'Owner'],
    ['Missing or incorrect mandatory field', 'Return to vendor (template AP-T01)', 'AP Clerk'],
    ['Invoice addressed to another legal entity', 'Return to vendor', 'AP Clerk'],
    ['Bank details differ from vendor master', 'Hold; ServiceNow request to Vendor Master Data', 'AP Clerk / Vendor Master Data'],
    ['Suspected duplicate', 'Do not post; confirm with vendor', 'AP Clerk'],
    ['No goods receipt', 'Park; request GR; remind at 3 and escalate at 7 working days', 'AP Clerk / Requester'],
    ['Price or quantity variance', 'Park; refer to Buyer', 'Buyer'],
    ['Non-PO approval not received', 'Remind at 2 and escalate at 5 working days', 'AP Clerk / AP Team Lead'],
    ['Password-protected or unreadable PDF', 'Request a readable copy from the vendor', 'AP Clerk'],
], widths=[5, 7, 3.5])

d.add_heading('8. Records', level=1)
d.add_paragraph('Invoices, approvals and supporting documents are retained for eight years from the end of the financial year to which they relate.')

d.add_heading('9. Performance measures', level=1)
table([
    ['Measure', 'Target'],
    ['Cycle time, receipt to posting', '5 working days or less'],
    ['Invoices posted without exception (first pass)', '80% or more'],
    ['MSE invoices paid within 45 days', '100%'],
], widths=[9, 6.5])
d.add_paragraph('Volume reference: approximately 8,500 invoices per month (FY 2025-26 average).')

d.add_heading('10. Revision history', level=1)
table([
    ['Version', 'Date', 'Change', 'Author'],
    ['3.0', '1 April 2024', 'Added rule 5.5 (bank details call-back).', 'Meera Iyer'],
    ['3.1', '1 October 2025', 'DoA thresholds updated.', 'Meera Iyer'],
    ['3.2', '1 April 2026', 'Four-eyes threshold set to INR 5,00,000; escalation timings added.', 'Meera Iyer'],
], widths=[2, 3, 7.5, 3])
d.save(out)
print('wrote', out)
