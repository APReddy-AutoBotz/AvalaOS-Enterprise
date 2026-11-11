"""Builds expected.model.json, the hand-checked gold Process Model for the AP invoice case.

Every excerpt is looked up in its source file. The script fails if an excerpt is not found
verbatim, and fills in the locator (timestamp and speaker, SOP section, or shape id)
from where it was found. Run from this folder:

    python3 make_gold.py
"""
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

from docx import Document

HERE = Path(__file__).resolve().parent
SRC = HERE.parent / 'sources'
OUT = HERE.parent / 'expected.model.json'

SOURCES = {
    'call-1': '01-discovery-call-2026-10-06.vtt',
    'call-2': '02-exceptions-deep-dive-2026-10-09.srt',
    'call-3': '03-sap-integration-call-2026-10-14.txt',
    'sop': '04-SOP-FIN-AP-004-vendor-invoice-processing.docx',
    'flow': '05-AP-Invoice-AsIs.drawio',
    'flow-image': '06-AP-Invoice-AsIs.png',
}


# ---- source indexes: list of (text, locator) units ---------------------------------------
def vtt_units(path):
    units, ts = [], None
    for line in path.read_text().splitlines():
        m = re.match(r'(\d\d:\d\d:\d\d)\.\d+ -->', line)
        if m:
            ts = m.group(1)
            continue
        m = re.match(r'<v ([^>]+)>(.*)', line)
        if m and ts:
            units.append((m.group(2), {'timestamp': ts, 'speaker': m.group(1)}))
    return units


def srt_units(path):
    units = []
    for block in path.read_text().strip().split('\n\n'):
        lines = block.splitlines()
        ts = lines[1][:8]
        speaker, text = lines[2].split(': ', 1)
        units.append((text, {'timestamp': ts, 'speaker': speaker}))
    return units


def txt_units(path):
    units = []
    for n, line in enumerate(path.read_text().splitlines(), 1):
        m = re.match(r'\[(\d\d:\d\d:\d\d)\] ([^:]+): (.*)', line)
        if m:
            units.append((m.group(3), {'timestamp': m.group(1), 'speaker': m.group(2), 'lineStart': n}))
        elif line.strip():
            units.append((line, {'lineStart': n}))
    return units


def docx_units(path):
    units, section = [], None
    doc = Document(str(path))
    for p in doc.paragraphs:
        t = p.text.strip()
        m = re.match(r'^(\d+(\.\d+)?)[ .]', t)
        if p.style.name.startswith('Heading') or m:
            section = m.group(1) if m else t
        if t:
            units.append((t, {'section': section} if section else {}))
    for ti, table in enumerate(doc.tables, 1):
        for ri, row in enumerate(table.rows):
            units.append((' | '.join(c.text for c in row.cells), {'heading': f'Table {ti}', 'cell': f'row {ri + 1}'}))
    return units


def drawio_units(path):
    root = ET.parse(path).getroot()
    return [(c.get('value'), {'shapeId': c.get('id')}) for c in root.iter('mxCell') if c.get('value')]


INDEX = {}
for sid, name in SOURCES.items():
    p = SRC / name
    if name.endswith('.vtt'):
        INDEX[sid] = vtt_units(p)
    elif name.endswith('.srt'):
        INDEX[sid] = srt_units(p)
    elif name.endswith('.txt'):
        INDEX[sid] = txt_units(p)
    elif name.endswith('.docx'):
        INDEX[sid] = docx_units(p)
    elif name.endswith('.drawio'):
        INDEX[sid] = drawio_units(p)

missing = []


def ref(sid, excerpt):
    for text, loc in INDEX[sid]:
        if excerpt in text:
            return {'sourceId': sid, 'locator': loc, 'excerpt': excerpt}
    missing.append((sid, excerpt))
    return {'sourceId': sid, 'locator': {}, 'excerpt': excerpt}


def S(*refs):
    return [ref(s, e) for s, e in refs]


def el(status='stated', sources=(), **kw):
    return {**kw, 'status': status, 'sources': S(*sources)}


# ---- meta --------------------------------------------------------------------------------
meta = {
    'name': 'Vendor invoice processing (India, company code 1000)',
    'objective': el(value='Pay suppliers accurately and on time; reduce receipt-to-posting cycle time, meet the MSE 45-day payment rule and capture early payment discounts.',
                    status='inferred',
                    sources=[('sop', 'so that suppliers are paid accurately and on time and statutory requirements are met'),
                             ('call-1', 'Under four days would be very good.')]),
    'owner': el(value='Meera Iyer, Manager - Accounts Payable', sources=[('sop', 'Meera Iyer, Manager - Accounts Payable')]),
    'scopeIn': [
        el(id='in-1', text='PO and non-PO vendor invoices for company code 1000 (India)', sources=[('sop', 'Purchase-order (PO) and non-PO vendor invoices for company code 1000 (India).')]),
        el(id='in-2', text='Invoices received by email and paper invoices received at the Pune office', sources=[('sop', 'Invoices received by email at ap.invoices@kaveri-ic.example and paper invoices received at the Pune office.')]),
    ],
    'scopeOut': [
        el(id='out-1', text='Payment run (F110), performed by Treasury', sources=[('sop', 'Payment runs (F110), performed by Treasury'), ('call-1', 'No, treasury runs F110, twice a week, Tuesdays and Fridays.')]),
        el(id='out-2', text='Vendor master creation and changes', sources=[('sop', 'Vendor master creation and changes, performed by the Vendor Master Data team')]),
        el(id='out-3', text='Employee expense claims (SAP Concur)', sources=[('sop', 'Employee expense claims, processed in SAP Concur.')]),
        el(id='out-4', text='Kaveri UK Ltd. on Workday Financials', sources=[('sop', 'Kaveri UK Ltd., which uses Workday Financials.'), ('call-1', 'The UK entity is on Workday Financials')]),
        el(id='out-5', text='Month-end GR/IR clearing, accruals and GST input credit reconciliation (GSTR-2B)', sources=[('sop', 'Month-end GR/IR clearing and accruals, and monthly GST input credit reconciliation (GSTR-2B).'), ('call-1', "I'd keep that out of this exercise for now.")]),
        el(id='out-6', text='Vendor credit notes (deferred to a separate session)', sources=[('call-2', 'Can we do that in a separate session?')]),
        el(id='out-7', text='Vendor payment status queries', sources=[('call-2', 'I\'ll note vendor status queries as related but out of scope for this assessment.')]),
    ],
    'metrics': [
        el(id='m-volume', kind='volume', label='Invoices per month', value=None, range=[9000, 10000], unit='invoices/month', appliesTo='process', period='recent months', status='stated',
           sources=[('call-1', 'Last few months it has been around nine to ten thousand invoices a month.')]),
        el(id='m-po-share', kind='share', label='Share of invoices against a PO', value=80, unit='%', appliesTo='process', sources=[('call-1', 'Around eighty percent are against purchase orders')]),
        el(id='m-paper-share', kind='share', label='Share of paper invoices', value=None, range=[10, 15], unit='%', appliesTo='step:s-scan', status='stated',
           sources=[('call-1', 'I would say ten to fifteen percent is paper, honestly nobody has counted it properly.')]),
        el(id='m-aht-clean', kind='handling_time', label='Handling time, clean PO invoice', value=None, range=[10, 12], unit='minutes', appliesTo='case:clean-po',
           sources=[('call-1', 'A clean PO invoice, ten to twelve minutes if SAP is fast.')]),
        el(id='m-aht-exception', kind='handling_time', label='Handling time, exception invoice', value=None, range=[35, 40], unit='minutes', appliesTo='case:exception',
           sources=[('call-2', 'An exception invoice is more like thirty-five to forty minutes of actual work')]),
        el(id='m-exception-rate', kind='exception_rate', label='Invoices with at least one exception', value=28, unit='%', period='last quarter',
           sources=[('call-2', 'last quarter about twenty-eight percent of invoices had at least one exception')]),
        el(id='m-cycle', kind='cycle_time', label='Receipt to posting, average', value=9, unit='days',
           sources=[('call-1', 'From receipt to posting we average around nine days.')]),
        el(id='m-cycle-target', kind='cycle_time', label='Receipt to posting, SOP target', value=5, unit='working days',
           sources=[('sop', '5 working days or less')]),
        el(id='m-fte', kind='fte', label='AP team', value=8, unit='people', status='inferred',
           sources=[('call-1', 'Six AP clerks, one team lead')]),
        el(id='m-discount-vendors', kind='other', label='Vendors offering a 2% early payment discount within 10 days', value=30, unit='vendors',
           sources=[('call-1', 'About thirty vendors offer two percent if we pay within ten days')]),
        el(id='m-exc-gr', kind='share', label='Exceptions caused by missing GR', value=40, unit='% of exceptions', appliesTo='exception:x-no-gr',
           sources=[('call-2', "That's maybe forty percent of all exceptions.")]),
        el(id='m-exc-price', kind='share', label='Exceptions caused by price variance', value=25, unit='% of exceptions', appliesTo='exception:x-price',
           sources=[('call-2', 'Then price variance, around a quarter.')]),
        el(id='m-exc-qty', kind='share', label='Exceptions caused by quantity differences', value=10, unit='% of exceptions', appliesTo='exception:x-qty',
           sources=[('call-2', 'Then quantity differences, maybe ten percent.')]),
    ],
}

# ---- roles and systems -------------------------------------------------------------------
roles = [
    el(id='r-clerk', name='AP Clerk', kind='person_role', inScope=True, aliases=['accounts payable clerk', 'AP processor'], sources=[('sop', 'AP Clerk')]),
    el(id='r-lead', name='AP Team Lead', kind='person_role', inScope=True, aliases=['team lead'], sources=[('sop', 'AP Team Lead')]),
    el(id='r-manager', name='AP Manager', kind='person_role', inScope=True, aliases=['accounts payable manager'], sources=[('sop', 'Owns this SOP; monitors KPIs; resolves policy questions.')]),
    el(id='r-stores', name='Requester / Stores', kind='person_role', inScope=True, aliases=['stores', 'requester', 'warehouse', 'goods receiver'], sources=[('sop', 'Posts goods receipts in SAP; confirms whether goods or services were received.')]),
    el(id='r-buyer', name='Buyer (Procurement)', kind='person_role', inScope=True, aliases=['buyer', 'procurement', 'category buyer'], sources=[('sop', 'Resolves price and quantity variances')]),
    el(id='r-approver', name='Cost Centre Owner / DoA approver', kind='person_role', inScope=True, aliases=['cost center owner', 'approver', 'department head'], sources=[('sop', 'Approve non-PO invoices within their authority.')]),
    el(id='r-controller', name='Finance Controller', kind='person_role', inScope=True, aliases=['controller'], sources=[('call-1', 'Above ten lakh it comes to me as finance controller.')]),
    el(id='r-vmd', name='Vendor Master Data team', kind='team', inScope=False, aliases=['vendor master team', 'MDM team'], sources=[('sop', 'Verifies and applies any vendor master change')]),
    el(id='r-treasury', name='Treasury', kind='team', inScope=False, sources=[('call-1', 'No, treasury runs F110')]),
    el(id='r-vendor', name='Vendor', kind='external', inScope=True, aliases=['supplier'], sources=[('flow', 'Vendor')]),
]


def acc(method, operations, access, sources, name=None, note=None):
    a = {'method': method, 'operations': operations, 'access': access, 'status': 'stated', 'sources': S(*sources)}
    if name:
        a['name'] = name
    if note:
        a['note'] = note
    return a


systems = [
    el(id='sys-sap', name='SAP S/4HANA', kind='erp', version='2022, on-premise', inScope=True, aliases=['SAP', 'S/4', 'S4HANA'],
       sources=[('call-3', 'India runs on SAP S/4HANA 2022, on-premise, company code 1000.')],
       access=[
           acc('ui', ['MIRO', 'MIR7', 'FB60', 'FBL1N', 'BP', 'MIGO', 'ME22N'], 'confirmed', [('call-3', 'AP uses SAP GUI mostly, MIRO, MIR7, FB60, FBL1N.')], name='SAP GUI'),
           acc('ui', ['scripted UI automation'], 'confirmed_absent', [('call-3', 'SAP GUI scripting is disabled on production by policy.')], name='SAP GUI scripting',
               note='Enabling needs a CISO-approved security exception; IT security prefers an API path.'),
           acc('api', ['create supplier invoice', 'post supplier invoice'], 'reported', [('call-3', 'But we have not activated it in our Gateway.'), ('call-3', 'Available in the product, not available in our landscape.')],
               name='API_SUPPLIERINVOICE_PROCESS_SRV', note='Needs Gateway activation, API management exposure, security review and a technical user; IT estimate 4 to 6 weeks if prioritised, not promised.'),
           acc('api', ['read purchase order'], 'confirmed', [('call-3', 'API_PURCHASEORDER_PROCESS_SRV is exposed through API management for the supplier portal project, read only.')], name='API_PURCHASEORDER_PROCESS_SRV'),
           acc('api', ['read goods receipt'], 'unknown', [('call-3', "I'm not sure if it's exposed outside. I need to check.")], name='API_MATERIAL_DOCUMENT_SRV'),
           acc('api', ['read business partner / supplier'], 'confirmed', [('call-3', 'Business partner read, API_BUSINESS_PARTNER, is live through API management.')], name='API_BUSINESS_PARTNER'),
           acc('api', ['attach document to SAP record'], 'unknown', [('call-3', "I don't know if it's active. Put it as unknown.")]),
       ]),
    el(id='sys-mailbox', name='AP shared mailbox (Microsoft 365)', kind='email', inScope=True, aliases=['shared mailbox', 'Outlook', 'ap.invoices', 'mailbox'],
       sources=[('call-3', 'The ap.invoices shared mailbox is in Microsoft 365.')],
       access=[acc('api', ['read mail', 'read attachments'], 'confirmed', [('call-3', 'there\'s an app registration with mail read permission scoped to that mailbox')], name='Microsoft Graph')]),
    el(id='sys-sharepoint', name='SharePoint library "AP Invoices"', kind='document_store', inScope=True, aliases=['SharePoint', 'AP Invoices library'],
       sources=[('sop', 'Save the PDF in the vendor folder of the SharePoint library "AP Invoices"')],
       access=[acc('api', ['read files', 'write files'], 'confirmed', [('call-3', 'we have Graph access to the AP Invoices library')], name='Microsoft Graph',
                   note='Access to the library is confirmed; read versus write permission was not specified.')]),
    el(id='sys-tracker', name='AP tracker (Excel on SharePoint)', kind='spreadsheet', inScope=True, aliases=['tracker', 'Excel tracker', 'AP tracker FY27'],
       sources=[("call-1", "it's an Excel file on SharePoint, AP tracker FY27")],
       access=[acc('file', ['read', 'update rows'], 'reported', [("call-1", "it's an Excel file on SharePoint, AP tracker FY27")])]),
    el(id='sys-servicenow', name='ServiceNow', kind='workflow', inScope=False, aliases=['ServiceNow ticket'],
       sources=[('call-1', 'We raise a ticket to the vendor master team in ServiceNow')],
       access=[acc('api', [], 'unknown', [('call-3', "That's a question for the ServiceNow team.")])]),
    el(id='sys-scanner', name='Office scanner (Pune)', kind='scanner', inScope=True, aliases=['scanner', 'MFP'],
       sources=[('call-1', 'one of us scans it on the office scanner')], access=[]),
    el(id='sys-workday', name='Workday Financials', kind='erp', inScope=False, aliases=['Workday'],
       sources=[('call-1', 'The UK entity is on Workday Financials')], access=[]),
]

# ---- events, steps, gateways, flows ------------------------------------------------------
events = [
    el(id='e-start', kind='start', name='Invoice sent by vendor', sources=[('flow', 'Invoice sent')]),
    el(id='e-posted', kind='end', name='Invoice posted', sources=[('flow', 'Invoice posted')]),
    el(id='e-returned', kind='end', name='Invoice returned to vendor', sources=[('flow', 'Invoice returned')]),
    el(id='e-hold-vmd', kind='end', name='On hold: vendor master', sources=[('flow', 'On hold: vendor master')]),
    el(id='e-duplicate', kind='end', name='Not posted: duplicate', sources=[('flow', 'Not posted: duplicate')]),
    el(id='e-rejected', kind='end', name='Rejected by approver', sources=[('flow', 'Rejected')]),
    el(id='e-credit', kind='end', name='On hold: awaiting credit note', sources=[('flow', 'On hold: awaiting credit note')]),
]


def step(id, name, desc, roles_, systems_, task, sources, aliases=(), rules=(), exc=(), inputs=(), outputs=()):
    return el(id=id, name=name, description=desc, roleIds=list(roles_), systemIds=list(systems_), taskType=task,
              inputs=list(inputs), outputs=list(outputs), ruleIds=list(rules), exceptionIds=list(exc),
              aliases=list(aliases), sources=sources)


steps = [
    step('s-scan', 'Scan paper invoice', 'Scan paper invoices received at the Pune office so they arrive in the shared mailbox as PDF.', ['r-clerk'], ['sys-scanner', 'sys-mailbox'], 'manual',
         [('sop', 'Paper invoices received at the Pune office are scanned by the AP Clerk'), ('flow', 'Scan paper invoice to mailbox')], aliases=['scan paper invoices']),
    step('s-log', 'Log invoice', 'Save the invoice PDF to the vendor folder in SharePoint and add a row to the AP tracker.', ['r-clerk'], ['sys-mailbox', 'sys-sharepoint', 'sys-tracker'], 'user',
         [('sop', 'record it in the AP tracker'), ('flow', 'Save PDF to SharePoint and log in AP tracker')], aliases=['save PDF and log in tracker', 'record invoice in tracker', 'register invoice'],
         outputs=['AP tracker row']),
    step('s-check', 'Check mandatory fields', 'Confirm legal name and GSTIN, vendor GSTIN, invoice number and date, PO number, HSN/SAC and tax breakup.', ['r-clerk'], [], 'user',
         [('sop', 'Confirm the invoice shows: Kaveri legal name and GSTIN'), ('flow', 'Check mandatory fields')], aliases=['validate invoice completeness', 'check invoice fields'],
         rules=['br-entity'], exc=['x-missing-field', 'x-wrong-entity', 'x-unreadable']),
    step('s-return', 'Return invoice to vendor', 'Email the vendor with template AP-T01 stating the reason, and set tracker status Returned.', ['r-clerk'], ['sys-mailbox', 'sys-tracker'], 'send',
         [('sop', 'return it to the vendor using template AP-T01'), ('flow', 'Return invoice to vendor (AP-T01)')], aliases=['send back to vendor', 'reject to vendor']),
    step('s-vendor', 'Validate vendor', 'Confirm in SAP that the vendor exists, is not blocked and the GSTIN matches; compare bank details with the vendor master.', ['r-clerk'], ['sys-sap'], 'user',
         [('sop', 'confirm the vendor exists, is not blocked for posting and that the GSTIN matches'), ('flow', 'Validate vendor and GSTIN in SAP')],
         aliases=['check vendor master', 'validate vendor and GSTIN'], rules=['br-bank'], exc=['x-bank', 'x-gstin']),
    step('s-ticket', 'Raise vendor master request', 'Raise a ServiceNow request to Vendor Master Data and hold the invoice when bank details differ.', ['r-clerk'], ['sys-servicenow', 'sys-tracker'], 'user',
         [('sop', 'raise a ServiceNow request to Vendor Master Data'), ('flow', 'Raise ServiceNow request and hold invoice')], aliases=['raise ServiceNow ticket', 'put invoice on hold for vendor master']),
    step('s-dup', 'Check for duplicates', 'Search SAP (FBL1N) and the AP tracker by vendor and invoice number.', ['r-clerk'], ['sys-sap', 'sys-tracker'], 'user',
         [('sop', 'Search SAP (FBL1N) and the AP tracker by vendor and invoice number.'), ('flow', 'Search SAP and tracker for duplicates')], aliases=['duplicate check', 'search for duplicates'],
         rules=['br-duplicate'], exc=['x-duplicate']),
    step('s-miro', 'Enter PO invoice', 'Enter the invoice in MIRO with reference to the PO; SAP proposes PO lines and goods receipts.', ['r-clerk'], ['sys-sap'], 'user',
         [('sop', 'Enter the invoice in MIRO with reference to the PO.'), ('flow', 'Enter invoice against PO (MIRO)')], aliases=['enter invoice in MIRO', 'key PO invoice']),
    step('s-park-gr', 'Park invoice and request goods receipt', 'Park the invoice in MIR7, email the requester or stores to post the GR, remind at 3 and escalate at 7 working days.', ['r-clerk'], ['sys-sap', 'sys-mailbox', 'sys-tracker'], 'user',
         [('sop', 'park the invoice (MIR7), email the requester or stores to post the GR'), ('flow', 'Park invoice (MIR7) and request GR')], aliases=['park and request GR', 'chase goods receipt'],
         rules=['br-gr-followup'], exc=['x-no-gr']),
    step('s-gr', 'Post goods receipt', 'Requester or stores posts the goods receipt in MIGO, or confirms the goods were not received.', ['r-stores'], ['sys-sap'], 'user',
         [('flow', 'Post goods receipt (MIGO)'), ('call-2', 'No, stores confirms that.')], aliases=['post GR', 'MIGO']),
    step('s-match', 'Three-way match', 'SAP compares invoice, PO and GR for price and quantity against tolerances.', [], ['sys-sap'], 'service',
         [('flow', 'Three-way match: PO, GR, invoice'), ('call-1', 'SAP pulls the PO lines and the goods receipt.')], aliases=['match invoice to PO and GR', '3-way match'],
         rules=['br-price-tolerance', 'br-qty']),
    step('s-park-var', 'Park invoice and refer variance', 'Park the invoice and email the buyer with the PO and invoice; set tracker status Variance.', ['r-clerk'], ['sys-sap', 'sys-mailbox', 'sys-tracker'], 'user',
         [('sop', 'park the invoice, email the Buyer with the PO and invoice, and set status "Variance"'), ('flow', 'Park invoice and refer variance to buyer')], aliases=['resolve variances', 'refer variance to buyer', 'query buyer'],
         exc=['x-price', 'x-qty']),
    step('s-investigate', 'Investigate variance', 'Buyer decides whether the PO or the invoice is wrong, based on contract and what was agreed.', ['r-buyer'], [], 'user',
         [('call-2', "That's a judgment call by the buyer, it depends on the contract and what was agreed."), ('flow', 'Investigate price or quantity variance')], aliases=['resolve variance', 'review price variance']),
    step('s-amend-po', 'Amend purchase order', 'Buyer amends the PO in ME22N when the PO price is wrong.', ['r-buyer'], ['sys-sap'], 'user',
         [('call-2', 'we amend the PO in ME22N and AP can post'), ('flow', 'Amend PO (ME22N)')], aliases=['update PO', 'change PO price']),
    step('s-credit', 'Request credit note or revised invoice', 'Buyer asks the vendor for a credit note or revised invoice when the vendor charged wrongly.', ['r-buyer'], ['sys-mailbox'], 'send',
         [('call-2', 'we ask the vendor for a credit note or a revised invoice'), ('flow', 'Request credit note or revised invoice')], aliases=['ask vendor for credit note']),
    step('s-approval-request', 'Request non-PO approval', 'Email the invoice to the approver(s) required by the DoA; remind at 2 and escalate at 5 working days.', ['r-clerk'], ['sys-mailbox'], 'send',
         [('sop', 'Email the invoice to the approver(s) required by Table 1.'), ('flow', 'Email invoice to approver(s) per DoA')], aliases=['send for approval', 'route for approval'],
         rules=['br-doa', 'br-approval-followup'], exc=['x-approval-delay']),
    step('s-approve', 'Approve non-PO invoice', 'Approver reviews the invoice and replies approved or rejected by email.', ['r-approver'], ['sys-mailbox'], 'user',
         [('flow', 'Review and approve invoice'), ('call-1', 'Once they reply approved')], aliases=['review and approve', 'approve invoice'], rules=['br-doa']),
    step('s-fb60', 'Enter non-PO invoice', 'Save the approval email as PDF, then enter the invoice in FB60 with GL account and cost centre.', ['r-clerk'], ['sys-sap', 'sys-sharepoint'], 'user',
         [('sop', 'Enter the approved invoice in FB60 with the GL account and cost centre.'), ('flow', 'Enter non-PO invoice in FB60')], aliases=['enter invoice in FB60', 'code GL and cost centre']),
    # No source names the system used for the review, so none is assigned.
    step('s-review', 'Review high-value invoice', 'AP Team Lead reviews invoices of INR 5,00,000 or more (invoice, PO or approval, GL coding, tax) before posting.', ['r-lead'], [], 'user',
         [('sop', 'For invoices of INR 5,00,000 or more, the AP Team Lead reviews'), ('flow', 'Review invoice before posting (four-eyes)')], aliases=['four-eyes review', 'second review'],
         rules=['br-four-eyes']),
    step('s-post', 'Post invoice and attach PDF', 'Post the invoice in SAP and attach the PDF through Services for Object.', ['r-clerk'], ['sys-sap'], 'user',
         [('sop', 'Post the invoice. Attach the invoice PDF to the SAP document'), ('flow', 'Post invoice and attach PDF in SAP')], aliases=['post invoice', 'attach invoice image', 'post and attach']),
    step('s-close', 'Update tracker to Posted', 'Record the SAP document number and set tracker status Posted.', ['r-clerk'], ['sys-tracker'], 'user',
         [('sop', 'Update the AP tracker with the SAP document number and status "Posted".'), ('flow', 'Update AP tracker to Posted')], aliases=['close tracker entry', 'update tracker', 'close the record']),
]

G = lambda id, q, src: el(id=id, type='exclusive', question=q, sources=[('flow', src)])
gateways = [
    G('g-paper', 'Paper invoice?', 'Paper invoice?'),
    G('g-complete', 'Complete and correct?', 'Complete and correct?'),
    G('g-bank', 'Bank details match vendor master?', 'Bank details match master?'),
    G('g-dup', 'Duplicate?', 'Duplicate?'),
    G('g-po', 'PO invoice?', 'PO invoice?'),
    G('g-approved', 'Approved?', 'Approved?'),
    G('g-gr', 'Goods receipt posted?', 'GR posted?'),
    G('g-tolerance', 'Within tolerance?', 'Within tolerance?'),
    G('g-po-wrong', 'PO price wrong?', 'PO price wrong?'),
    G('g-amount', 'Amount INR 5,00,000 or more?', 'Amount >= INR 5,00,000?'),
]

F = lambda i, a, b, label=None, x=False: {k: v for k, v in {'id': f'f-{i:02d}', 'from': a, 'to': b, 'label': label, 'isException': x or None}.items() if v is not None}
flows = [
    F(1, 'e-start', 'g-paper'), F(2, 'g-paper', 's-log', 'No'), F(3, 'g-paper', 's-scan', 'Yes'), F(4, 's-scan', 's-log'),
    F(5, 's-log', 's-check'), F(6, 's-check', 'g-complete'), F(7, 'g-complete', 's-vendor', 'Yes'), F(8, 'g-complete', 's-return', 'No', True),
    F(9, 's-return', 'e-returned'), F(10, 's-vendor', 'g-bank'), F(11, 'g-bank', 's-dup', 'Yes'), F(12, 'g-bank', 's-ticket', 'No', True),
    F(13, 's-ticket', 'e-hold-vmd'), F(14, 's-dup', 'g-dup'), F(15, 'g-dup', 'e-duplicate', 'Yes', True), F(16, 'g-dup', 'g-po', 'No'),
    F(17, 'g-po', 's-miro', 'Yes'), F(18, 'g-po', 's-approval-request', 'No'), F(19, 's-approval-request', 's-approve'), F(20, 's-approve', 'g-approved'),
    F(21, 'g-approved', 'e-rejected', 'No', True), F(22, 'g-approved', 's-fb60', 'Yes'), F(23, 's-fb60', 'g-amount'), F(24, 's-miro', 'g-gr'),
    F(25, 'g-gr', 's-match', 'Yes'), F(26, 'g-gr', 's-park-gr', 'No', True), F(27, 's-park-gr', 's-gr'), F(28, 's-gr', 's-match'),
    F(29, 's-match', 'g-tolerance'), F(30, 'g-tolerance', 'g-amount', 'Yes'), F(31, 'g-tolerance', 's-park-var', 'No', True), F(32, 's-park-var', 's-investigate'),
    F(33, 's-investigate', 'g-po-wrong'), F(34, 'g-po-wrong', 's-amend-po', 'Yes'), F(35, 's-amend-po', 's-match'), F(36, 'g-po-wrong', 's-credit', 'No'),
    F(37, 's-credit', 'e-credit'), F(38, 'g-amount', 's-post', 'No'), F(39, 'g-amount', 's-review', 'Yes'), F(40, 's-review', 's-post'),
    F(41, 's-post', 's-close'), F(42, 's-close', 'e-posted'),
]

# ---- rules, exceptions, data, notes --------------------------------------------------------
R = lambda id, name, cond, action, src, aliases=(): el(id=id, name=name, condition=cond, action=action, aliases=list(aliases), sources=src)
rules = [
    R('br-price-tolerance', 'Price tolerance', 'Invoice unit price differs from PO price by no more than 2% or INR 5,000 per invoice, whichever is lower',
      'Invoice may be posted; larger differences are resolved by the buyer before posting',
      [('sop', 'by no more than 2% or INR 5,000 per invoice, whichever is lower'), ('call-1', 'Policy says two percent or five thousand rupees, whichever is lower.')], ['price variance tolerance']),
    R('br-qty', 'No over-invoicing of quantity', 'Invoiced quantity exceeds quantity received', 'Do not post; park and ask stores (no tolerance)',
      [('sop', 'the invoiced quantity must not exceed the quantity received (GR). No tolerance applies.')], ['quantity tolerance']),
    R('br-duplicate', 'Duplicate definition', 'Same vendor, same invoice number and same gross amount in the same financial year', 'Do not post; mark duplicate and inform vendor',
      [('sop', 'an invoice with the same vendor, the same invoice number and the same gross amount')], ['duplicate check rule']),
    R('br-four-eyes', 'Four-eyes review', 'Gross amount is INR 5,00,000 or more', 'AP Team Lead reviews before posting',
      [('sop', 'every invoice with a gross amount of INR 5,00,000 or more must be reviewed by the AP Team Lead before posting'), ('call-1', "That's the four-eyes control.")], ['high value review']),
    R('br-bank', 'Bank detail changes', 'Bank details on the invoice differ from the vendor master', 'AP does not process; Vendor Master Data verifies by call-back to the registered number',
      [('sop', 'AP must not process an invoice whose bank details differ from the vendor master.')], ['bank details call-back']),
    R('br-doa', 'Delegation of authority for non-PO invoices', 'Gross amount up to INR 2,00,000 / above 2,00,000 up to 10,00,000 / above 10,00,000',
      'Cost Centre Owner / plus Department Head / plus Finance Controller',
      [('sop', 'Up to 2,00,000 | Cost Centre Owner'), ('sop', 'Above 2,00,000 up to 10,00,000 | Cost Centre Owner and Department Head'),
       ('sop', 'Above 10,00,000 | Cost Centre Owner, Department Head and Finance Controller')], ['DoA thresholds', 'approval limits']),
    R('br-entity', 'Correct legal entity and GSTIN', 'Invoice not addressed to Kaveri Industrial Components Ltd. or GSTINs do not match', 'Return to vendor for a corrected invoice',
      [('sop', 'Invoices must be addressed to Kaveri Industrial Components Ltd. and show its GSTIN')], ['legal entity check']),
    R('br-gr-followup', 'Goods receipt follow-up', 'No GR for the invoiced quantity', 'Remind requester after 3 working days; escalate to AP Team Lead after 7 working days',
      [('sop', 'Send a reminder after 3 working days and escalate to the AP Team Lead after 7 working days.'), ('call-2', 'If nothing happens in three working days I send a reminder.')]),
    R('br-approval-followup', 'Approval follow-up', 'No approval reply for a non-PO invoice', "Remind after 2 working days; escalate to the Finance Controller's office after 5 working days",
      [('sop', "Send a reminder after 2 working days and escalate to the Finance Controller's office after 5 working days.")]),
]

X = lambda id, kind, name, trig, steps_, handling, role, src, aliases=(): el(id=id, kind=kind, name=name, trigger=trig, stepIds=list(steps_), handling=handling, routedToRoleId=role, aliases=list(aliases), sources=src)
exceptions = [
    X('x-missing-field', 'business', 'Missing or incorrect mandatory field', 'A mandatory field is missing or wrong', ['s-check'], 'Return to vendor using template AP-T01', 'r-vendor',
      [('sop', 'Missing or incorrect mandatory field | Return to vendor (template AP-T01) | AP Clerk')], ['incomplete invoice']),
    X('x-wrong-entity', 'business', 'Invoice addressed to another legal entity', 'Invoice addressed to another entity, e.g. the UK company', ['s-check'], 'Return to vendor', 'r-vendor',
      [('sop', 'Invoice addressed to another legal entity | Return to vendor | AP Clerk'), ('call-2', 'addressed to the UK company instead of the India company')]),
    X('x-gstin', 'business', 'GSTIN mismatch', 'Vendor or Kaveri GSTIN on the invoice does not match', ['s-check', 's-vendor'], 'Return to vendor for a corrected invoice', 'r-vendor',
      [('call-2', "If the vendor GSTIN on the invoice doesn't match vendor master, or our GSTIN is wrong")]),
    X('x-bank', 'business', 'Bank details differ from vendor master', 'Bank details on invoice differ from SAP vendor master', ['s-vendor'], 'Hold; ServiceNow request to Vendor Master Data; call-back verification', 'r-vmd',
      [('sop', 'Bank details differ from vendor master | Hold; ServiceNow request to Vendor Master Data')], ['bank change', 'bank detail change']),
    X('x-duplicate', 'business', 'Suspected duplicate', 'Same vendor, invoice number and gross amount already recorded', ['s-dup'], 'Do not post; confirm with vendor; mark duplicate', 'r-clerk',
      [('sop', 'Suspected duplicate | Do not post; confirm with vendor | AP Clerk')]),
    X('x-no-gr', 'business', 'No goods receipt', 'No GR exists for the invoiced quantity', ['s-miro'], 'Park; request GR; remind at 3, escalate at 7 working days', 'r-stores',
      [('sop', 'No goods receipt | Park; request GR; remind at 3 and escalate at 7 working days')], ['missing GR', 'missing goods receipt']),
    X('x-price', 'business', 'Price variance beyond tolerance', 'Invoice price exceeds PO price beyond tolerance', ['s-match'], 'Park; refer to buyer', 'r-buyer',
      [('sop', 'Price or quantity variance | Park; refer to Buyer | Buyer')], ['price variance']),
    X('x-qty', 'business', 'Quantity exceeds goods received', 'Invoiced quantity is more than the GR quantity', ['s-match'], 'Park and ask stores for the difference', 'r-stores',
      [('call-2', "If the invoice is for more than was received, it's the same as missing GR for the difference")], ['quantity variance']),
    X('x-approval-delay', 'business', 'Non-PO approval not received', 'No reply from approver', ['s-approval-request'], 'Remind at 2 and escalate at 5 working days', 'r-controller',
      [('sop', 'Non-PO approval not received | Remind at 2 and escalate at 5 working days')], ['stuck approval']),
    X('x-unreadable', 'business', 'Password-protected or unreadable PDF', 'PDF cannot be opened', ['s-check'], 'Request a readable copy from the vendor', 'r-vendor',
      [('sop', 'Password-protected or unreadable PDF | Request a readable copy from the vendor')], ['password protected PDF']),
    X('x-po-locked', 'application', 'PO locked in SAP', 'MIRO reports the PO is being edited by the buyer in ME22N', ['s-miro'], 'Wait and retry later', 'r-clerk',
      [('call-2', 'sometimes MIRO says the PO is locked because the buyer has it open in ME22N')], ['PO locked']),
]

data_objects = [
    el(id='d-invoice', name='Vendor invoice', format='PDF (email attachment or scanned paper)', structured=False, classification='Confidential',
       sources=[('call-1', 'Most vendors email the PDF to the shared mailbox'), ('call-3', 'Our classification for that is Confidential.')]),
    el(id='d-tracker', name='AP tracker row', format='Excel row', structured=True, sources=[('sop', 'vendor, invoice number, invoice date, gross amount, PO number, date received, status "Received"')]),
    el(id='d-approval', name='Approval email', format='Email saved as PDF', structured=False, sources=[('sop', 'Save the approval email as PDF in the vendor folder.')]),
    el(id='d-doa', name='Delegation of authority matrix', format='PDF from Finance', structured=False, sources=[('call-2', 'The delegation of authority matrix is a PDF from finance.')]),
    el(id='d-dept-head-map', name='Department head mapping', format='Excel kept by the AP Team Lead', structured=True, sources=[('call-2', 'We use an Excel that I keep.')]),
]

N = lambda id, text, steps_, src: el(id=id, text=text, stepIds=list(steps_), sources=src)
pain_points = [
    N('p-keying', 'All invoices are keyed manually into SAP.', ['s-miro', 's-fb60'], [('call-1', 'Everything is keyed manually into SAP.')]),
    N('p-tracker', 'The Excel tracker is double work, kept only for status visibility.', ['s-log', 's-close'], [('call-1', 'the tracker is double work')]),
    N('p-cycle', 'Average nine days from receipt to posting, above the SOP target of five working days.', [], [('call-1', 'From receipt to posting we average around nine days.')]),
    N('p-discounts', 'Early payment discounts are almost never captured.', [], [('call-1', 'we almost never make it')]),
    N('p-msme', 'Slow posting puts the 45-day MSE payment rule at risk.', [], [('call-1', 'we have to pay micro and small enterprises within forty-five days')]),
    N('p-approval-evidence', 'Approval evidence in email is inconsistent and was raised by internal audit.', ['s-approve', 's-approval-request'], [('call-1', 'Internal audit raised an observation last year that approval evidence was not consistently attached')]),
    N('p-buyer-wait', 'No agreed turnaround for buyers to resolve variances.', ['s-investigate'], [('call-2', "There's no agreed turnaround.")]),
    N('p-gr-wait', 'Invoices often arrive before the goods receipt is posted.', ['s-park-gr'], [('call-2', "The invoice comes before stores has posted the GR in SAP.")]),
    N('p-password', 'Password-protected PDFs need a call to the vendor.', ['s-check'], [('call-1', 'Password protected PDFs.')]),
    N('p-gl-coding', 'GL coding for non-PO invoices depends on past postings and has no fixed rule.', ['s-fb60'], [('call-1', "There's no fixed rule, honestly. It depends.")]),
    N('p-ocr-history', 'A 2024 OCR pilot failed on line-item accuracy; the team re-checked everything.', [], [('call-1', 'Accuracy on line items was poor for our vendors')]),
]

controls = [
    {**N('c-four-eyes', 'Second review of invoices of INR 5,00,000 or more by the AP Team Lead.', ['s-review'], [('sop', 'every invoice with a gross amount of INR 5,00,000 or more must be reviewed by the AP Team Lead before posting')]), 'ruleIds': ['br-four-eyes']},
    {**N('c-bank', 'Call-back verification of bank detail changes by Vendor Master Data.', ['s-vendor', 's-ticket'], [('call-1', "That's a fraud control")]), 'ruleIds': ['br-bank']},
    {**N('c-duplicate', 'SAP duplicate invoice check (warning only) on vendor, reference and amount.', ['s-dup', 's-miro'], [('call-3', 'It gives a warning, not an error, so a clerk can still post.')]), 'ruleIds': ['br-duplicate']},
    {**N('c-doa', 'Non-PO approvals per delegation of authority.', ['s-approval-request', 's-approve'], [('sop', 'Non-PO approvals follow the DoA thresholds below.')]), 'ruleIds': ['br-doa']},
]

risks = [
    N('k-tolerance-gap', 'SAP accepts price variances up to 5% while policy allows 2% or INR 5,000, whichever is lower.', ['s-match'], [('call-3', 'Then the configuration doesn\'t match the policy.')]),
    N('k-data', 'Invoices contain bank account and personal data classified Confidential; any extraction or AI service must stay in an approved region and pass vendor risk assessment.', [],
      [('call-3', 'the data has to stay in an approved region')]),
    N('k-ocr-trust', 'Users will reject automation that needs everything re-checked.', [], [('call-1', "I don't want to repeat that.")]),
]

# ---- questions and conflicts ---------------------------------------------------------------
Q = lambda id, kind, tid, field, q, why, kw: {'id': id, 'target': {k: v for k, v in {'kind': kind, 'id': tid, 'field': field}.items() if v}, 'question': q, 'whyItMatters': why, 'owner': None, 'status': 'open', 'matchKeywords': kw}
open_questions = [
    Q('q-aht-nonpo', 'metric', None, 'handling_time', 'How long does a non-PO invoice take to handle?', 'Needed to size the benefit for the 20% of invoices without a PO.', ['non-po', 'handle']),
    Q('q-paper-count', 'metric', 'm-paper-share', 'value', 'What share of invoices arrives on paper? The estimate is 10 to 15% and has not been counted.', 'Decides whether paper capture is worth designing for.', ['paper']),
    Q('q-gr-api', 'system', 'sys-sap', 'access', 'Is API_MATERIAL_DOCUMENT_SRV exposed outside SAP, and can AP read goods receipts through it?', 'Determines whether GR checks can run without SAP GUI.', ['goods receipt']),
    Q('q-invoice-api', 'system', 'sys-sap', 'access', 'Will the supplier invoice API be activated and exposed, and when?', 'API-first posting depends on it; GUI scripting is disabled.', ['supplier invoice', 'api']),
    Q('q-attach-api', 'system', 'sys-sap', 'access', 'Is an SAP attachment API active for linking the invoice PDF?', 'Attaching the image is a manual step today.', ['attachment']),
    Q('q-servicenow', 'system', 'sys-servicenow', 'access', 'Can a ServiceNow request to Vendor Master Data be raised through an API?', 'The bank detail hold raises a ticket by hand today.', ['servicenow']),
    Q('q-gl-coding', 'step', 's-fb60', 'rule', 'How should the GL account be chosen for a non-PO invoice from a vendor with no posting history?', 'There is no rule today; it is a judgment point.', ['gl account']),
    Q('q-buyer-sla', 'step', 's-investigate', 'sla', 'What turnaround should buyers meet when AP refers a variance?', 'Waiting on buyers is one of the largest delays and has no agreed time.', ['buyer', 'turnaround']),
    Q('q-dept-head', 'rule', 'br-doa', 'approver', 'Where is the authoritative mapping of department heads for DoA approvals?', 'It is kept in a personal Excel file; approvals cannot be routed reliably without it.', ['department head']),
    Q('q-credit-notes', 'meta', None, 'scope', 'How are vendor credit notes processed?', 'Deferred to a separate session; the To-Be design must not ignore them.', ['credit note']),
]

conflicts = [
    {'id': 'k-01', 'target': {'kind': 'rule', 'id': 'br-price-tolerance', 'field': 'condition'},
     'summary': 'Price tolerance: policy is 2% or INR 5,000 (whichever is lower); SAP is configured at 5% with no amount limit.',
     'values': [
         {'value': '2% or INR 5,000, whichever is lower (policy)', 'sources': S(('sop', 'by no more than 2% or INR 5,000 per invoice, whichever is lower'), ('call-1', 'Two percent on price.'))},
         {'value': '5% upper and lower, no absolute limit (SAP configuration)', 'sources': S(('call-3', "it's set to five percent upper and five percent lower. No absolute amount limit configured."))},
     ], 'resolution': None, 'matchKeywords': ['tolerance']},
    {'id': 'k-02', 'target': {'kind': 'metric', 'id': 'm-volume', 'field': 'value'},
     'summary': 'Monthly volume: about 9,000 to 10,000 in recent months versus about 8,500 as the FY 2025-26 average in the SOP.',
     'values': [
         {'value': '9,000 to 10,000 per month (recent months)', 'sources': S(('call-1', 'around nine to ten thousand invoices a month'))},
         {'value': 'about 8,500 per month (FY 2025-26 average)', 'sources': S(('sop', 'approximately 8,500 invoices per month (FY 2025-26 average)'))},
     ], 'resolution': None, 'matchKeywords': ['volume', 'per month']},
]

model = {
    'schemaVersion': 1,
    'meta': meta,
    'roles': roles,
    'systems': systems,
    'events': events,
    'steps': steps,
    'gateways': gateways,
    'flows': flows,
    'rules': rules,
    'exceptions': exceptions,
    'dataObjects': data_objects,
    'painPoints': pain_points,
    'controls': controls,
    'risks': risks,
    'openQuestions': open_questions,
    'conflicts': conflicts,
}

# ---- integrity checks ----------------------------------------------------------------------
for q in open_questions + conflicts:
    text = (q.get('question', '') + ' ' + q.get('whyItMatters', '') + ' ' + q.get('summary', '') + ' ' + ' '.join(v['value'] for v in q.get('values', []))).lower()
    if not all(k in text for k in q['matchKeywords']):
        missing.append(('matchKeywords', q['id']))
ids = {x['id'] for k in ('roles', 'systems', 'events', 'steps', 'gateways', 'rules', 'exceptions') for x in model[k]}
errors = [f'excerpt not found in {s}: {e!r}' for s, e in missing]
for f in flows:
    for end in ('from', 'to'):
        if f[end] not in ids:
            errors.append(f'flow {f["id"]} {end} unknown id {f[end]}')
for s in steps:
    for k, pool in (('roleIds', 'roles'), ('systemIds', 'systems'), ('ruleIds', 'rules'), ('exceptionIds', 'exceptions')):
        known = {x['id'] for x in model[pool]}
        errors += [f'step {s["id"]} {k} unknown {v}' for v in s[k] if v not in known]
nodes = {x['id'] for k in ('events', 'steps', 'gateways') for x in model[k]}
reach, todo = set(), ['e-start']
while todo:
    n = todo.pop()
    if n in reach:
        continue
    reach.add(n)
    todo += [f['to'] for f in flows if f['from'] == n]
errors += [f'node not reachable from start: {n}' for n in sorted(nodes - reach)]
if errors:
    print('\n'.join(errors))
    sys.exit(1)

OUT.write_text(json.dumps(model, indent=2, ensure_ascii=False) + '\n')
(HERE.parent / 'sources.json').write_text(json.dumps(SOURCES, indent=2) + '\n')
print(f'wrote {OUT.name}: {len(steps)} steps, {len(gateways)} gateways, {len(flows)} flows, {len(rules)} rules, '
      f'{len(exceptions)} exceptions, {len(open_questions)} open questions, {len(conflicts)} conflicts')
