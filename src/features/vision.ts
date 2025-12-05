/**
 * Vision Support - Read and understand images
 * Supports: screenshots, diagrams, UI mockups, error images
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

export interface ImageData {
  type: "base64" | "url";
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  data: string;
}

export interface ImageAnalysis {
  description: string;
  detectedText?: string[];
  uiElements?: string[];
  codeSnippets?: string[];
}

// Supported image extensions
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);

/**
 * Check if a file is an image
 */
export function isImageFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

/**
 * Read an image file and convert to base64
 */
export function readImageAsBase64(filePath: string): ImageData | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const buffer = fs.readFileSync(filePath);
    const base64 = buffer.toString("base64");
    const ext = path.extname(filePath).toLowerCase();

    let mediaType: ImageData["mediaType"] = "image/png";
    if (ext === ".jpg" || ext === ".jpeg") mediaType = "image/jpeg";
    else if (ext === ".gif") mediaType = "image/gif";
    else if (ext === ".webp") mediaType = "image/webp";

    return {
      type: "base64",
      mediaType,
      data: base64,
    };
  } catch (error) {
    console.error("Failed to read image:", error);
    return null;
  }
}

/**
 * Build a message with image content for the API
 */
export function buildImageMessage(
  text: string,
  images: ImageData[]
): Array<{ type: string; [key: string]: unknown }> {
  const content: Array<{ type: string; [key: string]: unknown }> = [];

  // Add images first
  for (const image of images) {
    if (image.type === "base64") {
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: image.mediaType,
          data: image.data,
        },
      });
    } else {
      content.push({
        type: "image",
        source: {
          type: "url",
          url: image.data,
        },
      });
    }
  }

  // Add text
  content.push({
    type: "text",
    text,
  });

  return content;
}

/**
 * Request user to provide a screenshot
 */
export async function requestScreenshot(): Promise<string | null> {
  const result = await vscode.window.showInformationMessage(
    "Please select an image file",
    "Browse for Image"
  );

  if (result === "Browse for Image") {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: {
        Images: ["png", "jpg", "jpeg", "gif", "webp"],
      },
    });

    if (uris && uris[0]) {
      return uris[0].fsPath;
    }
  }

  return null;
}

/**
 * Common prompts for image analysis
 */
export const IMAGE_PROMPTS = {
  describeUI: "Describe this user interface. What elements do you see? What is the layout?",
  findErrors: "Look at this screenshot. Are there any error messages, warnings, or issues visible?",
  extractText: "Extract all readable text from this image.",
  analyzeCode: "This image contains code. What does the code do? Are there any issues?",
  compareMockup: "Compare this screenshot to the design mockup. What differences do you see?",
  debugVisual: "I'm debugging a visual issue. What do you see that might be wrong?",
};

/**
 * Get file info for an image
 */
export function getImageInfo(filePath: string): {
  exists: boolean;
  size?: number;
  extension?: string;
} {
  try {
    if (!fs.existsSync(filePath)) {
      return { exists: false };
    }

    const stats = fs.statSync(filePath);
    
    return {
      exists: true,
      size: stats.size,
      extension: path.extname(filePath).toLowerCase(),
    };
  } catch {
    return { exists: false };
  }
}

