import { useEffect, useRef, useCallback } from 'react';
import Tesseract from 'tesseract.js';

export function useOCR() {
  const workerRef = useRef<any>(null);
  const isReadyRef = useRef<boolean>(false);

  useEffect(() => {
    const initWorker = async () => {
      try {
        // Tesseract.createWorker in newer versions may require eng to be passed during recognize or createWorker
        const worker = await Tesseract.createWorker('eng', 1, {
          logger: () => {}, // suppress Tesseract logs
        });
        workerRef.current = worker;
        isReadyRef.current = true;
      } catch (err) {
        console.error('Failed to initialize Tesseract worker:', err);
      }
    };

    initWorker();

    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, []);

  const extractText = useCallback(async (imageBlob: Blob | File) => {
    if (!workerRef.current || !isReadyRef.current) {
      return { text: '', confidence: 0, isGoodEnough: false };
    }

    try {
      const result = await workerRef.current.recognize(imageBlob);
      const text = result.data.text.trim();
      const confidence = result.data.confidence; // 0-100

      // Quality check
      const isGoodEnough = text.length > 15 && confidence > 70;

      return { text, confidence, isGoodEnough };
    } catch (err: any) {
      console.warn('Tesseract OCR failed:', err.message);
      return { text: '', confidence: 0, isGoodEnough: false };
    }
  }, []);

  return { extractText };
}
