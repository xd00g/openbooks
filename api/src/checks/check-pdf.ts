import PDFDocument from 'pdfkit';
import { amountToWords } from './check.logic';

/** One check's worth of print data. Amounts are Decimal strings. */
export interface CheckPdfData {
  checkNumber: number;
  checkDate: string; // ISO yyyy-mm-dd
  payeeName: string;
  amount: string;
  memo?: string | null;
  companyName: string;
  /** Bills this check pays, listed on the stub. */
  bills: { number: string; date: string; amount: string }[];
  /** Alignment nudge in hundredths of an inch. */
  offsetX: number;
  offsetY: number;
}

const PT_PER_INCH = 72;
/** Check occupies the top 3.5" of US Letter; the stub fills the rest. */
const CHECK_HEIGHT = 3.5 * PT_PER_INCH; // 252pt
const LEFT = 50;
const GREEN = '#0b3d2e';

const fmtMoney = (v: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
    Number(v),
  );

const fmtDate = (v: string) => new Date(`${v}T00:00:00`).toLocaleDateString('en-US');

/**
 * Shared field positions for check drawing. Coordinates are in PDF points.
 * Each field is drawn at these (x, y) positions with the specified width.
 * The alignment test calibration page derives its guide boxes from these
 * positions but applies calibration-specific y-offsets.
 */
const FIELD_POSITIONS = {
  date: { x: 430, y: 70, width: 120 },
  payee: { x: LEFT + 40, y: 112, width: 380 },
  amount: { x: 470, y: 112, width: 90 },
  legalAmount: { x: LEFT, y: 146, width: 430 },
  signature: { x: 330, y: 212, width: 230 },
} as const;

export function buildCheckPdf(checks: CheckPdfData[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 0 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    checks.forEach((c, i) => {
      if (i > 0) doc.addPage();
      drawCheck(doc, c);
    });

    doc.end();
  });
}

function drawCheck(doc: PDFKit.PDFDocument, c: CheckPdfData) {
  // Offsets are hundredths of an inch -> points.
  const dx = (c.offsetX / 100) * PT_PER_INCH;
  const dy = (c.offsetY / 100) * PT_PER_INCH;
  const x = (v: number) => v + dx;
  const y = (v: number) => v + dy;

  // ---- CHECK PORTION (top 3.5") -------------------------------------------
  // Nothing is drawn in the pre-printed zones: MICR band, bank name, company
  // address, routing/account numbers are already on the stock.

  doc.font('Helvetica').fontSize(10).fillColor('#000');
  doc.text(fmtDate(c.checkDate), x(FIELD_POSITIONS.date.x), y(FIELD_POSITIONS.date.y), {
    width: FIELD_POSITIONS.date.width,
  });

  doc.font('Helvetica').fontSize(11);
  doc.text(c.payeeName, x(FIELD_POSITIONS.payee.x), y(FIELD_POSITIONS.payee.y), {
    width: FIELD_POSITIONS.payee.width,
  });

  doc.font('Helvetica-Bold').fontSize(11);
  doc.text(fmtMoney(c.amount), x(FIELD_POSITIONS.amount.x), y(FIELD_POSITIONS.amount.y), {
    width: FIELD_POSITIONS.amount.width,
    align: 'right',
  });

  // Legal amount. Trailing rule fills the line so nothing can be appended.
  doc.font('Helvetica').fontSize(10);
  const words = amountToWords(c.amount);
  doc.text(words, x(FIELD_POSITIONS.legalAmount.x), y(FIELD_POSITIONS.legalAmount.y), {
    width: FIELD_POSITIONS.legalAmount.width,
  });
  const wordsWidth = doc.widthOfString(words);
  doc
    .moveTo(x(FIELD_POSITIONS.legalAmount.x + wordsWidth + 6), y(157))
    .lineTo(x(500), y(157))
    .strokeColor('#666')
    .lineWidth(0.5)
    .stroke();

  if (c.memo) {
    doc.fontSize(9).fillColor('#333');
    doc.text(`Memo: ${c.memo}`, x(LEFT), y(196), { width: 250 });
  }

  // Blank signature line — no stored signature image, by design (spec 2).
  doc
    .moveTo(x(FIELD_POSITIONS.signature.x), y(FIELD_POSITIONS.signature.y))
    .lineTo(x(560), y(FIELD_POSITIONS.signature.y))
    .strokeColor('#000')
    .lineWidth(0.7)
    .stroke();
  doc.fontSize(7).fillColor('#666');
  doc.text('Authorized signature', x(FIELD_POSITIONS.signature.x), y(FIELD_POSITIONS.signature.y + 4), {
    width: FIELD_POSITIONS.signature.width,
  });

  // ---- STUB ---------------------------------------------------------------
  let sy = y(CHECK_HEIGHT + 30);

  doc.font('Helvetica-Bold').fontSize(11).fillColor(GREEN);
  doc.text(c.companyName, x(LEFT), sy, { width: 300 });

  doc.font('Helvetica').fontSize(9).fillColor('#333');
  doc.text(`Check ${c.checkNumber}`, x(430), sy, { width: 120, align: 'right' });
  doc.text(fmtDate(c.checkDate), x(430), sy + 13, { width: 120, align: 'right' });

  sy += 34;
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#000');
  doc.text(c.payeeName, x(LEFT), sy, { width: 300 });

  sy += 22;
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#555');
  doc.text('BILL', x(LEFT), sy);
  doc.text('DATE', x(200), sy);
  doc.text('AMOUNT', x(430), sy, { width: 120, align: 'right' });

  sy += 4;
  doc.moveTo(x(LEFT), sy + 8).lineTo(x(550), sy + 8).strokeColor('#999').lineWidth(0.5).stroke();
  sy += 16;

  // One page per check — overflow is summarized, never pushed to page 2.
  const MAX_ROWS = 12;
  const shown = c.bills.slice(0, MAX_ROWS);
  doc.font('Helvetica').fontSize(9).fillColor('#000');
  for (const b of shown) {
    doc.text(b.number, x(LEFT), sy, { width: 140 });
    doc.text(fmtDate(b.date), x(200), sy, { width: 120 });
    doc.text(fmtMoney(b.amount), x(430), sy, { width: 120, align: 'right' });
    sy += 14;
  }
  if (c.bills.length > MAX_ROWS) {
    doc.fillColor('#666').fontSize(8);
    doc.text(
      `… and ${c.bills.length - MAX_ROWS} more — see payment detail`,
      x(LEFT),
      sy,
      { width: 300 },
    );
    sy += 14;
  }

  doc.moveTo(x(380), sy + 4).lineTo(x(550), sy + 4).strokeColor('#000').lineWidth(0.7).stroke();
  sy += 10;
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#000');
  doc.text('Total', x(380), sy, { width: 90 });
  doc.text(fmtMoney(c.amount), x(430), sy, { width: 120, align: 'right' });
}

/**
 * A calibration page: a labelled 1/2" grid plus the nominal check outline, so
 * the user can measure how far their stock is off and set the offsets.
 */
export function buildAlignmentTestPdf(
  offsetX: number,
  offsetY: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 0 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const dx = (offsetX / 100) * PT_PER_INCH;
    const dy = (offsetY / 100) * PT_PER_INCH;

    doc.font('Helvetica-Bold').fontSize(12).fillColor(GREEN);
    doc.text('OpenBooks check alignment test', 50 + dx, 24 + dy);
    doc.font('Helvetica').fontSize(9).fillColor('#333');
    doc.text(
      `Current offset: X ${offsetX}/100 in, Y ${offsetY}/100 in. ` +
        'Hold this against your check stock. If the boxes are off, adjust the ' +
        'offsets by the difference and print again.',
      50 + dx,
      40 + dy,
      { width: 480 },
    );

    // Half-inch grid with inch labels.
    doc.lineWidth(0.25).strokeColor('#ccc');
    for (let ix = 0; ix <= 8.5 * PT_PER_INCH; ix += PT_PER_INCH / 2) {
      doc.moveTo(ix + dx, dy).lineTo(ix + dx, 11 * PT_PER_INCH + dy).stroke();
    }
    for (let iy = 0; iy <= 11 * PT_PER_INCH; iy += PT_PER_INCH / 2) {
      doc.moveTo(dx, iy + dy).lineTo(8.5 * PT_PER_INCH + dx, iy + dy).stroke();
    }
    doc.fontSize(6).fillColor('#999');
    for (let inch = 1; inch < 11; inch++) {
      doc.text(`${inch}"`, 4 + dx, inch * PT_PER_INCH + 2 + dy);
    }

    // Nominal positions of the fields drawn by drawCheck.
    doc.lineWidth(0.8).strokeColor(GREEN);
    doc.rect(dx, dy, 8.5 * PT_PER_INCH, CHECK_HEIGHT).stroke();
    doc.fontSize(8).fillColor(GREEN);
    doc.text('CHECK REGION — top 3.5"', 50 + dx, CHECK_HEIGHT - 16 + dy);

    // Alignment guide boxes derived from FIELD_POSITIONS. Each box's alignY is
    // computed from the corresponding draw position (FIELD_POSITIONS.*.y) minus
    // a calibration-specific offset. Heights are guide presentation only.
    // If a field's draw position changes, its guide box follows automatically.
    interface AlignmentBox {
      label: string;
      x: number;
      alignY: number;
      width: number;
      height: number;
    }
    const alignmentBoxes: AlignmentBox[] = [
      { label: 'date', x: FIELD_POSITIONS.date.x, alignY: FIELD_POSITIONS.date.y - 8, width: FIELD_POSITIONS.date.width, height: 20 },
      { label: 'payee', x: FIELD_POSITIONS.payee.x, alignY: FIELD_POSITIONS.payee.y - 6, width: FIELD_POSITIONS.payee.width, height: 20 },
      { label: 'amount', x: FIELD_POSITIONS.amount.x, alignY: FIELD_POSITIONS.amount.y - 6, width: FIELD_POSITIONS.amount.width, height: 20 },
      { label: 'legal amount', x: FIELD_POSITIONS.legalAmount.x, alignY: FIELD_POSITIONS.legalAmount.y - 6, width: FIELD_POSITIONS.legalAmount.width, height: 20 },
      { label: 'signature line', x: FIELD_POSITIONS.signature.x, alignY: FIELD_POSITIONS.signature.y - 12, width: FIELD_POSITIONS.signature.width, height: 16 },
    ];
    doc.lineWidth(0.5).strokeColor('#c0392b');
    for (const box of alignmentBoxes) {
      doc.rect(box.x + dx, box.alignY + dy, box.width, box.height).stroke();
      doc.fontSize(6).fillColor('#c0392b');
      doc.text(box.label, box.x + dx + 2, box.alignY + dy - 8);
    }

    doc.end();
  });
}
