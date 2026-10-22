// Minimal one-page PDF with a heading and lines of text (Helvetica, A4).
// Used for the sample employee documents in the demo company.
export function textPdf(heading, lines = [], { footer = '' } = {}) {
  // Escapes PDF string syntax; non-ASCII becomes '?' since the base fonts can't show it.
  const esc = (s) =>
    String(s)
      .replace(/[\\()]/g, (c) => `\\${c}`)
      .replace(/[^\x20-\x7e]/g, '?');
  // Page content: heading at the top, then one line every 18pt, optional footer at the bottom.
  const ops = ['BT', '/F2 18 Tf', '56 780 Td', `(${esc(heading)}) Tj`, '/F1 11 Tf', '0 -34 Td'];
  for (const l of lines) ops.push(`(${esc(l)}) Tj`, '0 -18 Td');
  ops.push('ET');
  if (footer) ops.push('BT', '/F1 9 Tf', '56 40 Td', `(${esc(footer)}) Tj`, 'ET');
  const stream = ops.join('\n');
  // PDF objects 1-6: catalog, page tree, page, content stream, regular and bold font.
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
  ];
  // Write the objects, noting each byte offset for the cross-reference table.
  let out = '%PDF-1.4\n';
  const offsets = objects.map((o, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
    return at;
  });
  // Cross-reference table and trailer so readers can locate each object.
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
