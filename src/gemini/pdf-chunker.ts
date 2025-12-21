/**
 * PDF Chunker Utility
 *
 * Splits large PDFs into smaller chunks that fit within Gemini's limits:
 * - Max 50MB per file
 * - Max 1000 pages per file
 *
 * Uses pdf-lib for pure JavaScript PDF manipulation (no system dependencies).
 */

import { PDFDocument } from "pdf-lib";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { log } from "../utils/logger.js";

/**
 * Gemini file limits
 */
export const GEMINI_LIMITS = {
  maxFileSizeBytes: 50 * 1024 * 1024, // 50MB
  maxPages: 1000,
  // Use conservative chunk sizes to stay well under limits
  chunkPages: 500, // Pages per chunk
  chunkSizeBytes: 25 * 1024 * 1024, // 25MB target per chunk
};

/**
 * Result of PDF analysis
 */
export interface PdfAnalysis {
  filePath: string;
  fileName: string;
  fileSize: number;
  pageCount: number;
  needsChunking: boolean;
  estimatedChunks: number;
  reason?: string;
}

/**
 * Result of PDF chunking
 */
export interface PdfChunk {
  chunkIndex: number;
  totalChunks: number;
  filePath: string;
  fileName: string;
  pageStart: number;
  pageEnd: number;
  pageCount: number;
  fileSize: number;
}

/**
 * Result of chunking operation
 */
export interface ChunkingResult {
  success: boolean;
  originalFile: string;
  chunks: PdfChunk[];
  totalPages: number;
  error?: string;
}

/**
 * Analyze a PDF to determine if it needs chunking
 */
export async function analyzePdf(filePath: string): Promise<PdfAnalysis> {
  const stats = await fs.promises.stat(filePath);
  const fileName = path.basename(filePath);
  const fileSize = stats.size;

  // Check file size first (quick check)
  if (fileSize > GEMINI_LIMITS.maxFileSizeBytes) {
    const estimatedChunks = Math.ceil(
      fileSize / GEMINI_LIMITS.chunkSizeBytes
    );
    return {
      filePath,
      fileName,
      fileSize,
      pageCount: -1, // Unknown until we read it
      needsChunking: true,
      estimatedChunks,
      reason: `File size ${formatBytes(fileSize)} exceeds 50MB limit`,
    };
  }

  // Read PDF to get page count
  try {
    const pdfBytes = await fs.promises.readFile(filePath);
    const pdfDoc = await PDFDocument.load(pdfBytes, {
      ignoreEncryption: true,
    });
    const pageCount = pdfDoc.getPageCount();

    if (pageCount > GEMINI_LIMITS.maxPages) {
      const estimatedChunks = Math.ceil(pageCount / GEMINI_LIMITS.chunkPages);
      return {
        filePath,
        fileName,
        fileSize,
        pageCount,
        needsChunking: true,
        estimatedChunks,
        reason: `Page count ${pageCount} exceeds 1000 page limit`,
      };
    }

    return {
      filePath,
      fileName,
      fileSize,
      pageCount,
      needsChunking: false,
      estimatedChunks: 1,
    };
  } catch (error) {
    // If we can't read the PDF, assume it doesn't need chunking
    // and let Gemini handle the error
    log.warning(`Could not analyze PDF ${fileName}: ${error}`);
    return {
      filePath,
      fileName,
      fileSize,
      pageCount: -1,
      needsChunking: false,
      estimatedChunks: 1,
      reason: `Could not analyze: ${error}`,
    };
  }
}

/**
 * Split a PDF into chunks
 */
export async function chunkPdf(filePath: string): Promise<ChunkingResult> {
  const fileName = path.basename(filePath, ".pdf");
  const tempDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "pdf-chunks-")
  );

  try {
    log.info(`Chunking PDF: ${filePath}`);

    // Read the original PDF
    const pdfBytes = await fs.promises.readFile(filePath);
    const pdfDoc = await PDFDocument.load(pdfBytes, {
      ignoreEncryption: true,
    });
    const totalPages = pdfDoc.getPageCount();

    log.info(`PDF has ${totalPages} pages, splitting into chunks...`);

    const chunks: PdfChunk[] = [];
    let currentPage = 0;
    let chunkIndex = 0;

    while (currentPage < totalPages) {
      // Calculate chunk range
      const pageStart = currentPage;
      const pageEnd = Math.min(
        currentPage + GEMINI_LIMITS.chunkPages - 1,
        totalPages - 1
      );
      const chunkPageCount = pageEnd - pageStart + 1;

      // Create new PDF for this chunk
      const chunkDoc = await PDFDocument.create();
      const pageIndices = Array.from(
        { length: chunkPageCount },
        (_, i) => pageStart + i
      );
      const copiedPages = await chunkDoc.copyPages(pdfDoc, pageIndices);

      for (const page of copiedPages) {
        chunkDoc.addPage(page);
      }

      // Save chunk to temp file
      const chunkFileName = `${fileName}_chunk_${chunkIndex + 1}.pdf`;
      const chunkFilePath = path.join(tempDir, chunkFileName);
      const chunkBytes = await chunkDoc.save();
      await fs.promises.writeFile(chunkFilePath, chunkBytes);

      const chunkStats = await fs.promises.stat(chunkFilePath);

      chunks.push({
        chunkIndex,
        totalChunks: -1, // Will update after
        filePath: chunkFilePath,
        fileName: chunkFileName,
        pageStart: pageStart + 1, // 1-indexed for display
        pageEnd: pageEnd + 1,
        pageCount: chunkPageCount,
        fileSize: chunkStats.size,
      });

      log.info(
        `  Chunk ${chunkIndex + 1}: pages ${pageStart + 1}-${pageEnd + 1} (${formatBytes(chunkStats.size)})`
      );

      currentPage = pageEnd + 1;
      chunkIndex++;
    }

    // Update total chunks count
    for (const chunk of chunks) {
      chunk.totalChunks = chunks.length;
    }

    log.info(
      `Split into ${chunks.length} chunks, stored in ${tempDir}`
    );

    return {
      success: true,
      originalFile: filePath,
      chunks,
      totalPages,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error(`Failed to chunk PDF: ${errorMsg}`);

    // Clean up temp directory on failure
    try {
      await fs.promises.rm(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }

    return {
      success: false,
      originalFile: filePath,
      chunks: [],
      totalPages: 0,
      error: errorMsg,
    };
  }
}

/**
 * Clean up chunk files after upload
 */
export async function cleanupChunks(chunks: PdfChunk[]): Promise<void> {
  if (chunks.length === 0) return;

  // Get the temp directory from the first chunk
  const tempDir = path.dirname(chunks[0].filePath);

  try {
    await fs.promises.rm(tempDir, { recursive: true });
    log.info(`Cleaned up chunk temp directory: ${tempDir}`);
  } catch (error) {
    log.warning(`Failed to cleanup chunks: ${error}`);
  }
}

/**
 * Format bytes to human readable string
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
