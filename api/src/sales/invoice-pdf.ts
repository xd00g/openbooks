import PDFDocument from 'pdfkit';

export interface InvoicePdfData {
  logo?: Buffer | null;
  company: { legalName: string; email?: string | null; phone?: string | null; address?: any };
  customer: { displayName: string; companyName?: string | null; email?: string | null; billingAddress?: any };
  invoice: {
    number: string;
    issueDate: string | Date;
    dueDate?: string | Date | null;
    currency: string;
    subtotal: string;
    taxTotal: string;
    total: string;
    memo?: string | null;
  };
  lines: { description?: string | null; quantity: string; unitPrice: string; amount: string }[];
}

const d = (v?: string | Date | null) => (v ? new Date(v).toISOString().slice(0, 10) : '');
const fmtAddr = (a: any): string[] =>
  a ? [a.line1, a.line2, [a.city, a.region, a.postalCode].filter(Boolean).join(', '), a.country].filter(Boolean) : [];

/** Render an invoice to a PDF buffer with pdfkit (bundled Helvetica; no system deps). */
export function buildInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const money = (v: string) => `${data.invoice.currency} ${Number(v).toFixed(2)}`;
    const right = 560;

    // ---- Header: logo + company (left) + INVOICE (right) ----
    let cx = 50;
    if (data.logo) {
      try { doc.image(data.logo, 50, 45, { fit: [70, 70] }); cx = 130; } catch { /* ignore bad image */ }
    }
    doc.fontSize(20).fillColor('#0b3d2e').text(data.company.legalName, cx, 50, { width: 200 });
    doc.fillColor('#555').fontSize(9);
    [data.company.email, data.company.phone, ...fmtAddr(data.company.address)]
      .filter(Boolean)
      .forEach((l) => doc.text(String(l), cx));

    doc.fillColor('#0b3d2e').fontSize(22).text('INVOICE', 350, 50, { width: 210, align: 'right' });
    doc.fillColor('#000').fontSize(10);
    doc.text(`Invoice #: ${data.invoice.number}`, 350, 82, { width: 210, align: 'right' });
    doc.text(`Date: ${d(data.invoice.issueDate)}`, 350, undefined, { width: 210, align: 'right' });
    if (data.invoice.dueDate) doc.text(`Due: ${d(data.invoice.dueDate)}`, 350, undefined, { width: 210, align: 'right' });

    // ---- Bill to ----
    doc.moveTo(50, 150).lineTo(right, 150).strokeColor('#ddd').stroke();
    doc.fillColor('#555').fontSize(9).text('BILL TO', 50, 160);
    doc.fillColor('#000').fontSize(11).text(data.customer.companyName || data.customer.displayName, 50, 172);
    doc.fontSize(9).fillColor('#333');
    [data.customer.companyName ? data.customer.displayName : null, data.customer.email, ...fmtAddr(data.customer.billingAddress)]
      .filter(Boolean)
      .forEach((l) => doc.text(String(l), 50));

    // ---- Line items table ----
    let y = 240;
    doc.fillColor('#0b3d2e').fontSize(9);
    doc.text('DESCRIPTION', 50, y);
    doc.text('QTY', 330, y, { width: 50, align: 'right' });
    doc.text('UNIT', 390, y, { width: 70, align: 'right' });
    doc.text('AMOUNT', 470, y, { width: 90, align: 'right' });
    y += 14;
    doc.moveTo(50, y).lineTo(right, y).strokeColor('#ddd').stroke();
    y += 8;
    doc.fillColor('#000').fontSize(9);
    for (const l of data.lines) {
      doc.text(l.description || '—', 50, y, { width: 270 });
      doc.text(String(Number(l.quantity)), 330, y, { width: 50, align: 'right' });
      doc.text(Number(l.unitPrice).toFixed(2), 390, y, { width: 70, align: 'right' });
      doc.text(Number(l.amount).toFixed(2), 470, y, { width: 90, align: 'right' });
      y = doc.y + 6;
    }

    // ---- Totals ----
    doc.moveTo(360, y).lineTo(right, y).strokeColor('#ddd').stroke();
    y += 8;
    const totalRow = (label: string, val: string, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9).fillColor('#000');
      doc.text(label, 360, y, { width: 110, align: 'right' });
      doc.text(money(val), 470, y, { width: 90, align: 'right' });
      y = doc.y + 4;
    };
    totalRow('Subtotal', data.invoice.subtotal);
    totalRow('Tax', data.invoice.taxTotal);
    totalRow('Total', data.invoice.total, true);

    if (data.invoice.memo) {
      doc.font('Helvetica').fontSize(9).fillColor('#555').text(`Notes: ${data.invoice.memo}`, 50, y + 20, { width: 400 });
    }

    doc.end();
  });
}
