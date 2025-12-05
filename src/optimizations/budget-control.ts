/**
 * Token Budget Controls
 * 
 * Cursor doesn't let you set spending limits. We do.
 */

import * as vscode from "vscode";

interface BudgetConfig {
  dailyLimit: number;      // Max $ per day
  sessionLimit: number;    // Max $ per session
  requestLimit: number;    // Max $ per request
  warningThreshold: number; // % of limit to warn at
  hardStop: boolean;       // Stop requests when limit hit
}

interface UsageTracking {
  today: number;
  session: number;
  lastRequest: number;
  dailyReset: number;
}

export class BudgetControl {
  private config: BudgetConfig = {
    dailyLimit: 10,
    sessionLimit: 5,
    requestLimit: 0.50,
    warningThreshold: 0.8,
    hardStop: false,
  };

  private usage: UsageTracking = {
    today: 0,
    session: 0,
    lastRequest: 0,
    dailyReset: Date.now(),
  };

  private onLimitReached?: (type: string, current: number, limit: number) => void;

  /**
   * Check if request is within budget
   */
  canMakeRequest(estimatedCost: number): { allowed: boolean; reason?: string } {
    this.checkDailyReset();

    // Check request limit
    if (estimatedCost > this.config.requestLimit) {
      if (this.config.hardStop) {
        return { allowed: false, reason: `Request cost $${estimatedCost.toFixed(4)} exceeds limit $${this.config.requestLimit}` };
      }
      this.warn("request", estimatedCost, this.config.requestLimit);
    }

    // Check session limit
    if (this.usage.session + estimatedCost > this.config.sessionLimit) {
      if (this.config.hardStop) {
        return { allowed: false, reason: `Session limit $${this.config.sessionLimit} would be exceeded` };
      }
      this.warn("session", this.usage.session + estimatedCost, this.config.sessionLimit);
    }

    // Check daily limit
    if (this.usage.today + estimatedCost > this.config.dailyLimit) {
      if (this.config.hardStop) {
        return { allowed: false, reason: `Daily limit $${this.config.dailyLimit} would be exceeded` };
      }
      this.warn("daily", this.usage.today + estimatedCost, this.config.dailyLimit);
    }

    return { allowed: true };
  }

  /**
   * Record usage
   */
  recordUsage(cost: number): void {
    this.usage.today += cost;
    this.usage.session += cost;
    this.usage.lastRequest = cost;
  }

  /**
   * Check and reset daily counter
   */
  private checkDailyReset(): void {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    
    if (now - this.usage.dailyReset > dayMs) {
      this.usage.today = 0;
      this.usage.dailyReset = now;
    }
  }

  /**
   * Issue warning
   */
  private warn(type: string, current: number, limit: number): void {
    const percent = (current / limit) * 100;
    
    if (percent >= this.config.warningThreshold * 100) {
      vscode.window.showWarningMessage(
        `Claude Code: ${type} budget at ${percent.toFixed(0)}% ($${current.toFixed(2)}/$${limit.toFixed(2)})`
      );
      this.onLimitReached?.(type, current, limit);
    }
  }

  /**
   * Get current usage
   */
  getUsage(): UsageTracking & { limits: BudgetConfig } {
    return { ...this.usage, limits: this.config };
  }

  /**
   * Configure budgets
   */
  configure(config: Partial<BudgetConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Set callback for limit warnings
   */
  onLimit(callback: (type: string, current: number, limit: number) => void): void {
    this.onLimitReached = callback;
  }

  /**
   * Reset session usage
   */
  resetSession(): void {
    this.usage.session = 0;
  }
}

export const budgetControl = new BudgetControl();

