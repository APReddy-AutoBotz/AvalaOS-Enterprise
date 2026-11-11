"""Builds the parser test fixtures. Run from the repository root:

    python3 domain/ingest/fixtures/make_fixtures.py

numbered-sop.docx is written by hand so its numbering definitions are known exactly: the expected
labels in the tests follow from them by Word's rules, not from the parser under test.
"""
import os
import zipfile

from openpyxl import Workbook
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

HERE = os.path.dirname(os.path.abspath(__file__))
FLOW_PNG = os.path.join(HERE, '..', '..', '..', 'eval', 'corpus', 'ap-invoice', 'sources', '06-AP-Invoice-AsIs.png')

W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'


def p(text, style=None, num=None, extra=''):
    ppr = ''
    if style or num:
        ppr = '<w:pPr>'
        if style:
            ppr += f'<w:pStyle w:val="{style}"/>'
        if num:
            ppr += f'<w:numPr><w:ilvl w:val="{num[1]}"/><w:numId w:val="{num[0]}"/></w:numPr>'
        ppr += '</w:pPr>'
    return f'<w:p>{ppr}<w:r><w:t xml:space="preserve">{text}</w:t></w:r>{extra}</w:p>'


def make_docx(path):
    body = ''.join([
        p('Vendor Invoice Procedure', style='Title'),
        p('Procedure', style='Heading1'),
        p('Receive the invoice in the shared mailbox.', num=(1, 0)),
        p('Check mandatory fields.', num=(1, 0)),
        p('Legal name and GSTIN.', num=(1, 1)),
        p('Invoice number &amp; date.', num=(1, 1)),
        p('Validate the vendor in SAP.', num=(1, 0)),
        p('Bank details match.', num=(1, 1)),
        p('If not, raise a ServiceNow request.', num=(1, 2)),
        p('Post the invoice.', num=(1, 0)),
        # Numbering carried by the style, not the paragraph.
        p('Escalate to the AP Team Lead.', style='StepList'),
        p('Escalate to the Finance Controller.', style='StepList'),
        # A restarted list: numId 2 points at the same abstract list with a start override.
        p('Restarted first item.', num=(2, 0)),
        # Tracked changes, a field code and a tab.
        '<w:p><w:r><w:t xml:space="preserve">Kept </w:t></w:r><w:del w:id="1" w:author="x"><w:r><w:delText>removed </w:delText></w:r></w:del>'
        '<w:ins w:id="2" w:author="x"><w:r><w:t xml:space="preserve">inserted</w:t></w:r></w:ins>'
        '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>'
        '<w:r><w:tab/><w:t>after tab</w:t></w:r></w:p>',
        p('Approval limits', style='Heading2'),
        '<w:tbl><w:tblPr/><w:tr><w:tc><w:p><w:r><w:t>Amount (INR)</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Approver</w:t></w:r></w:p></w:tc></w:tr>'
        '<w:tr><w:tc><w:p><w:r><w:t>Up to 50,000</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Cost Centre Owner</w:t></w:r></w:p><w:p><w:r><w:t>(email)</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
        '<w:p/>',
        p('Closing note.'),
    ])
    document = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document {W}><w:body>{body}<w:sectPr/></w:body></w:document>'
    styles = (
        f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles {W}>'
        '<w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
        '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/></w:style>'
        '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>'
        '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style>'
        '<w:style w:type="paragraph" w:styleId="StepListBase"><w:name w:val="Step List Base"/><w:pPr><w:numPr><w:numId w:val="3"/></w:numPr></w:pPr></w:style>'
        '<w:style w:type="paragraph" w:styleId="StepList"><w:name w:val="Step List"/><w:basedOn w:val="StepListBase"/></w:style>'
        '</w:styles>'
    )
    numbering = (
        f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering {W}>'
        '<w:abstractNum w:abstractNumId="10">'
        '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>'
        '<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1.%2"/></w:lvl>'
        '<w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="(%3)"/></w:lvl>'
        '</w:abstractNum>'
        '<w:abstractNum w:abstractNumId="20">'
        '<w:lvl w:ilvl="0"><w:start w:val="4"/><w:numFmt w:val="upperRoman"/><w:lvlText w:val="Step %1:"/></w:lvl>'
        '</w:abstractNum>'
        '<w:num w:numId="1"><w:abstractNumId w:val="10"/></w:num>'
        '<w:num w:numId="2"><w:abstractNumId w:val="10"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="7"/></w:lvlOverride></w:num>'
        '<w:num w:numId="3"><w:abstractNumId w:val="20"/></w:num>'
        '</w:numbering>'
    )
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
        '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>'
        '</Types>'
    )
    rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
        '</Relationships>'
    )
    doc_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>'
        '</Relationships>'
    )
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        for name, data in [('[Content_Types].xml', content_types), ('_rels/.rels', rels), ('word/_rels/document.xml.rels', doc_rels),
                           ('word/styles.xml', styles), ('word/numbering.xml', numbering), ('word/document.xml', document)]:
            info = zipfile.ZipInfo(name, date_time=(2026, 11, 11, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, data)


def make_text_pdf(path):
    c = canvas.Canvas(path, pagesize=A4, invariant=1)
    c.setFont('Helvetica-Bold', 14)
    c.drawString(72, 780, '1. Purpose')
    c.setFont('Helvetica', 11)
    c.drawString(72, 760, 'This procedure defines how vendor invoices are recorded,')
    c.drawString(72, 746, 'validated and posted in SAP S/4HANA.')
    c.showPage()
    c.setFont('Helvetica-Bold', 14)
    c.drawString(72, 780, '6. Procedure')
    c.setFont('Helvetica', 11)
    c.drawString(72, 760, '6.1 Receive invoice. Vendors send invoices as PDF to the shared mailbox.')
    c.drawString(72, 740, '6.2 Log the invoice in the AP tracker.')
    c.drawString(72, 720, '6.3 Check mandatory fields: legal name and GSTIN, invoice number and date, PO')
    c.drawString(72, 706, 'number, HSN/SAC codes and the tax breakup.')
    c.showPage()
    c.save()


def make_scanned_pdf(path):
    c = canvas.Canvas(path, pagesize=A4, invariant=1)
    c.drawImage(FLOW_PNG, 36, 200, width=520, preserveAspectRatio=True, mask='auto')
    c.showPage()
    c.save()


def make_xlsx(path):
    wb = Workbook()
    ws = wb.active
    ws.title = 'Tracker'
    ws.append(['Vendor', 'Invoice no', 'Amount', 'Status', 'Posted'])
    ws.append(['Shree Castings', 'SC/2026/0412', 184500, 'Waiting GR', False])
    ws.append([None, None, None, None, None])
    ws.append(['Deccan Logistics', 'DL-7781', 52000.5, 'Posted', True])
    ws['G4'] = 'note & check'
    ws['C6'] = '=SUM(C2:C4)'  # no cached value is stored, so nothing is read for it
    hidden = wb.create_sheet('Rates')
    hidden.sheet_state = 'hidden'
    hidden.append(['secret', 1])
    wb.save(path)


if __name__ == '__main__':
    make_docx(os.path.join(HERE, 'numbered-sop.docx'))
    make_text_pdf(os.path.join(HERE, 'text-sop.pdf'))
    make_scanned_pdf(os.path.join(HERE, 'scanned.pdf'))
    make_xlsx(os.path.join(HERE, 'tracker.xlsx'))
    print('fixtures written')
