import { Page } from '@playwright/test';
import { TestUserData } from './data-generator';

export interface NavigationResult {
  success: boolean;
  stepsCompleted: number;
  finalUrl: string;
  stepLog: StepInfo[];
}

export interface StepInfo {
  step: number;
  path: string;
  action: string;
}

export class QuizNavigator {
  private page: Page;
  private userData: TestUserData;
  private maxSteps: number;
  private stepLog: StepInfo[] = [];

  constructor(page: Page, userData: TestUserData, maxSteps = 35) {
    this.page = page;
    this.userData = userData;
    this.maxSteps = maxSteps;
  }

  async navigate(): Promise<NavigationResult> {
    let stepNumber = 0;
    let previousPath = '';
    let stuckCount = 0;

    while (stepNumber < this.maxSteps) {
      stepNumber++;

      try {
        await this.page.waitForTimeout(1500);

        const currentUrl = this.page.url();
        const currentPath = new URL(currentUrl).pathname;

        if (this.isCompletionPage(currentUrl, currentPath)) {
          this.stepLog.push({ step: stepNumber, path: currentPath, action: 'COMPLETED' });
          return { success: true, stepsCompleted: stepNumber, finalUrl: currentUrl, stepLog: this.stepLog };
        }

        if (currentPath === previousPath) {
          stuckCount++;
          if (stuckCount >= 6) {
            return { success: false, stepsCompleted: stepNumber, finalUrl: currentUrl, stepLog: this.stepLog };
          }
        } else {
          stuckCount = 0;
        }
        previousPath = currentPath;

        const action = await this.performStepAction(currentPath);
        this.stepLog.push({ step: stepNumber, path: currentPath, action });
      } catch (error: any) {
        if (error.message?.includes('closed') || error.message?.includes('crashed')) {
          this.stepLog.push({ step: stepNumber, path: previousPath, action: `ERROR: ${error.message}` });
          return { success: false, stepsCompleted: stepNumber, finalUrl: '', stepLog: this.stepLog };
        }
        this.stepLog.push({ step: stepNumber, path: previousPath, action: `RETRY: ${error.message?.substring(0, 50)}` });
      }
    }

    return { success: false, stepsCompleted: stepNumber, finalUrl: this.page.url(), stepLog: this.stepLog };
  }

  private isCompletionPage(_: string, path: string): boolean {
    const completionPatterns = [
      'success', 'thank', 'complete', 'confirmation',
      'dashboard', 'booking-confirmed', 'lesson-booked',
      '/login', '/sign-in',
    ];
    if (completionPatterns.some((p) => path.includes(p))) return true;

    if (!path.includes('/sign-up/long/charlie/') && !path.includes('about:blank')) {
      return true;
    }

    return false;
  }

  private async performStepAction(currentPath: string): Promise<string> {
    const modalAction = await this.handleModal();
    if (modalAction) return modalAction;

    const filledInputs = await this.fillInputs();

    const selectedOption = await this.clickQuizOption();

    if (filledInputs || selectedOption) {
      await this.page.waitForTimeout(500);
      const newPath = new URL(this.page.url()).pathname;
      if (newPath !== currentPath) {
        return selectedOption ? 'selected-option-auto-advanced' : 'filled-and-advanced';
      }
      if (await this.clickContinueButton()) {
        return filledInputs ? 'filled-inputs-and-continued' : 'selected-and-continued';
      }
      return selectedOption ? 'selected-option' : 'filled-inputs';
    }

    if (await this.clickContinueButton()) {
      return 'clicked-continue';
    }

    if (await this.clickAnyButton()) {
      return 'clicked-button';
    }

    return 'no-action';
  }

  private async handleModal(): Promise<string | null> {
    const modalSelectors = [
      '[role="dialog"]',
      '[class*="modal"]',
      '[class*="overlay"]',
      '[class*="popup"]',
      '[class*="Modal"]',
      '[class*="Overlay"]',
    ];

    for (const selector of modalSelectors) {
      try {
        const modal = this.page.locator(selector).first();
        if (await modal.isVisible({ timeout: 500 })) {
          const modalItems = modal.locator('button, [role="button"], div[class*="card"], div[class*="option"], li, a');
          const count = await modalItems.count();

          for (let i = 0; i < count; i++) {
            const item = modalItems.nth(i);
            const text = (await item.textContent())?.trim() || '';
            if (text.includes('мати') || text.includes('батько') || text.includes('parent')) {
              await item.click();
              return 'modal-selected-parent';
            }
          }

          for (let i = 0; i < count; i++) {
            const item = modalItems.nth(i);
            const text = (await item.textContent())?.trim() || '';
            if (!text || text === '×' || text === 'X' || text === '✕' || text.length <= 1) continue;
            if (text.toLowerCase().includes('закрити') || text.toLowerCase().includes('close')) continue;
            await item.click();
            return `modal-selected: ${text.substring(0, 30)}`;
          }
        }
      } catch {
        continue;
      }
    }

    try {
      const parentOption = this.page.locator('text="Я — мати або батько"').first();
      if (await parentOption.isVisible({ timeout: 500 })) {
        await parentOption.click();
        return 'clicked-parent-option-directly';
      }
    } catch {}

    try {
      const childOption = this.page.locator('text="Я — дитина"').first();
      if (await childOption.isVisible({ timeout: 500 })) {
        await childOption.click();
        return 'clicked-child-option-directly';
      }
    } catch {}

    return null;
  }

  private async fillInputs(): Promise<boolean> {
    let filled = false;

    const emailSel = 'input[type="email"], input[name*="email"], input[placeholder*="mail"], input[placeholder*="email"], input[autocomplete="email"]';
    if (await this.isVisible(emailSel)) {
      await this.page.locator(emailSel).first().fill(this.userData.email);
      filled = true;
    }

    const phoneSel = 'input[type="tel"], input[name*="phone"], input[placeholder*="телефон"], input[placeholder*="phone"]';
    if (await this.isVisible(phoneSel)) {
      const phoneInput = this.page.locator(phoneSel).first();
      const currentValue = await phoneInput.inputValue();

      if (!currentValue || currentValue.replace(/\D/g, '').length < 9) {
        await phoneInput.click({ clickCount: 3 });
        await phoneInput.press('Backspace');
        await this.page.waitForTimeout(200);

        const uniqueNumber = '9' + String(Date.now()).slice(-8);
        await phoneInput.pressSequentially(uniqueNumber, { delay: 50 });
        await this.page.waitForTimeout(500);
        filled = true;
      }
    }

    const nameSel = 'input[name*="child"], input[name*="name"], input[placeholder*="ім\'я"], input[placeholder*="Ім\'я"], input[placeholder*="name"]';
    if (await this.isVisible(nameSel)) {
      await this.page.locator(nameSel).first().fill(this.userData.childName);
      filled = true;
    }

    if (!filled) {
      const genericInput = this.page.locator('input[type="text"]:visible, input:not([type]):visible').first();
      if (await genericInput.isVisible({ timeout: 500 }).catch(() => false)) {
        const placeholder = await genericInput.getAttribute('placeholder') || '';
        const name = await genericInput.getAttribute('name') || '';

        if (placeholder.toLowerCase().includes('ім') || name.toLowerCase().includes('name')) {
          await genericInput.fill(this.userData.childName);
        } else if (placeholder.toLowerCase().includes('mail')) {
          await genericInput.fill(this.userData.email);
        } else {
          await genericInput.fill(this.userData.childName);
        }
        filled = true;
      }
    }

    return filled;
  }

  private async clickContinueButton(): Promise<boolean> {
    const continuePatterns = [
      'button:has-text("Продовжити")',
      'button:has-text("Далі")',
      'button:has-text("Записатися")',
      'button:has-text("Забронювати")',
      'button:has-text("Підтвердити")',
      'button:has-text("Готово")',
      'button:has-text("Continue")',
      'button:has-text("Next")',
      'button:has-text("Submit")',
      'button[type="submit"]',
    ];

    for (const selector of continuePatterns) {
      try {
        const btn = this.page.locator(selector).first();
        if (await btn.isVisible({ timeout: 800 })) {
          try {
            await btn.waitFor({ state: 'attached', timeout: 500 });
            for (let attempt = 0; attempt < 6; attempt++) {
              if (!(await btn.isDisabled())) {
                await btn.click();
                await this.page.waitForTimeout(500);
                return true;
              }
              await this.page.waitForTimeout(500);
            }
          } catch {}
        }
      } catch {
        continue;
      }
    }
    return false;
  }

  private async clickQuizOption(): Promise<boolean> {
    const buttons = this.page.locator('button:visible');
    const count = await buttons.count();

    for (let i = 0; i < Math.min(count, 15); i++) {
      const btn = buttons.nth(i);
      try {
        const text = (await btn.textContent())?.trim() || '';
        const ariaLabel = await btn.getAttribute('aria-label') || '';

        if (!text) continue;
        if (text.toLowerCase().includes('назад') || ariaLabel.includes('back')) continue;
        const skipTexts = ['Продовжити', 'Далі', 'Записатися', 'Забронювати', 'Підтвердити', 'Готово', 'Continue', 'Next', 'Submit'];
        if (skipTexts.includes(text)) continue;

        if (await btn.isDisabled()) continue;

        await btn.click();
        await this.page.waitForTimeout(500);
        return true;
      } catch {
        continue;
      }
    }
    return false;
  }

  private async clickAnyButton(): Promise<boolean> {
    try {
      const btn = this.page.locator('button:visible:not([disabled])').first();
      if (await btn.isVisible({ timeout: 1000 })) {
        await btn.click();
        await this.page.waitForTimeout(500);
        return true;
      }
    } catch {}
    return false;
  }

  private async isVisible(selector: string): Promise<boolean> {
    try {
      return await this.page.locator(selector).first().isVisible({ timeout: 500 });
    } catch {
      return false;
    }
  }
}
