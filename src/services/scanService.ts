const BASE_URL = import.meta.env.VITE_API_URL || '';

/**
 * Send pre-extracted text to backend for AI understanding.
 * Used when Tesseract OCR succeeded.
 * @param text - Raw text extracted by Tesseract
 * @param scanState - "product" or "expiry"
 */
export async function scanWithText(text: string, scanState: 'product' | 'expiry') {
  const response = await fetch(`${BASE_URL}/api/scan/text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, scanState }),
  });
  return response.json();
}

/**
 * Send image directly to backend for vision AI processing.
 * Used when Tesseract OCR failed or returned low confidence text.
 * @param imageBlob - Camera frame as Blob or File
 * @param scanState - "product" or "expiry"
 */
export async function scanWithImage(imageBlob: Blob | File, scanState: 'product' | 'expiry') {
  const formData = new FormData();
  formData.append('image', imageBlob, 'frame.jpg');
  formData.append('scanState', scanState);

  const response = await fetch(`${BASE_URL}/api/scan/image`, {
    method: 'POST',
    body: formData,
  });
  return response.json();
}
