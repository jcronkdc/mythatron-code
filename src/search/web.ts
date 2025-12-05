/**
 * Web Search - Search the internet for information
 * Uses DuckDuckGo (no API key needed) or Brave Search
 */

import * as vscode from "vscode";

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchOptions {
  maxResults?: number;
  region?: string;
}

export class WebSearch {
  private braveApiKey?: string;

  constructor() {
    const config = vscode.workspace.getConfiguration("claudeCode");
    this.braveApiKey = config.get<string>("braveSearchApiKey");
  }

  /**
   * Search the web
   */
  async search(
    query: string,
    options: WebSearchOptions = {}
  ): Promise<WebSearchResult[]> {
    const maxResults = options.maxResults || 5;

    // Try Brave Search first if API key available
    if (this.braveApiKey) {
      try {
        return await this.searchBrave(query, maxResults);
      } catch (error) {
        console.error("Brave Search failed:", error);
      }
    }

    // Fall back to DuckDuckGo (no API key needed)
    return this.searchDuckDuckGo(query, maxResults);
  }

  /**
   * Search using Brave Search API
   */
  private async searchBrave(
    query: string,
    maxResults: number
  ): Promise<WebSearchResult[]> {
    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`,
      {
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": this.braveApiKey!,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Brave Search error: ${response.status}`);
    }

    const data = await response.json() as {
      web?: {
        results?: Array<{
          title: string;
          url: string;
          description: string;
        }>;
      };
    };

    return (data.web?.results || []).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.description,
    }));
  }

  /**
   * Search using DuckDuckGo (via HTML scraping - no API key needed)
   */
  private async searchDuckDuckGo(
    query: string,
    maxResults: number
  ): Promise<WebSearchResult[]> {
    // DuckDuckGo instant answers API
    const response = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
    );

    if (!response.ok) {
      throw new Error(`DuckDuckGo error: ${response.status}`);
    }

    const data = await response.json() as {
      AbstractText?: string;
      AbstractURL?: string;
      AbstractSource?: string;
      RelatedTopics?: Array<{
        Text?: string;
        FirstURL?: string;
      }>;
    };

    const results: WebSearchResult[] = [];

    // Add abstract if available
    if (data.AbstractText && data.AbstractURL) {
      results.push({
        title: data.AbstractSource || "Wikipedia",
        url: data.AbstractURL,
        snippet: data.AbstractText,
      });
    }

    // Add related topics
    for (const topic of data.RelatedTopics || []) {
      if (results.length >= maxResults) break;
      if (topic.Text && topic.FirstURL) {
        results.push({
          title: topic.Text.split(" - ")[0] || topic.Text,
          url: topic.FirstURL,
          snippet: topic.Text,
        });
      }
    }

    return results;
  }

  /**
   * Fetch and extract text from a URL
   */
  async fetchPage(url: string): Promise<string> {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ClaudeCode/1.0)",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status}`);
    }

    const html = await response.text();

    // Simple HTML to text conversion
    return this.htmlToText(html);
  }

  /**
   * Convert HTML to plain text
   */
  private htmlToText(html: string): string {
    // Remove scripts and styles
    let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");

    // Remove HTML tags
    text = text.replace(/<[^>]+>/g, " ");

    // Decode HTML entities
    text = text.replace(/&nbsp;/g, " ");
    text = text.replace(/&amp;/g, "&");
    text = text.replace(/&lt;/g, "<");
    text = text.replace(/&gt;/g, ">");
    text = text.replace(/&quot;/g, '"');
    text = text.replace(/&#(\d+);/g, (_, code) =>
      String.fromCharCode(parseInt(code, 10))
    );

    // Collapse whitespace
    text = text.replace(/\s+/g, " ").trim();

    // Limit length
    return text.slice(0, 10000);
  }
}

// Singleton
let webSearch: WebSearch | null = null;

export function getWebSearch(): WebSearch {
  if (!webSearch) {
    webSearch = new WebSearch();
  }
  return webSearch;
}

export async function initWebSearch(): Promise<void> {
  webSearch = new WebSearch();
}

