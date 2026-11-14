// Shrinks a photo or drawing to at most 2400 px on its long side before upload, so uploads
// stay quick on venue Wi-Fi. Returns the JPEG and the image's height-to-width ratio.
export function shrinkImage(file, maxSide = 2400) {
  return new Promise((resolve, reject) => {
    if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf')
      return reject(
        new Error('Save the PDF page as a PNG or JPG image first (most PDF readers have Export or Save as image), then upload that.'),
      );
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * k);
      canvas.height = Math.round(img.naturalHeight * k);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob(
        (b) => (b ? resolve({ blob: b, ratio: img.naturalHeight / img.naturalWidth }) : reject(new Error('Could not read the image'))),
        'image/jpeg',
        0.86,
      );
    };
    img.onerror = () => reject(new Error('That file is not an image this browser can open. Use PNG or JPG.'));
    img.src = url;
  });
}
