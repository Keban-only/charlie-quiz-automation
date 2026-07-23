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

  constructor(page: Page, userData: TestUserData, maxSteps = 50) {
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
        await this.waitForPageReady();

        const currentUrl = this.page.url();
        const currentPath = new URL(currentUrl).pathname;

        if (this.isCompletionPage(currentUrl, currentPath)) {
          this.stepLog.push({ step: stepNumber, path: currentPath, action: 'COMPLETED' });
          return { success: true, stepsCompleted: stepNumber, finalUrl: currentUrl, stepLog: this.stepLog };
        }

        if (currentPath === previousPath) {
          stuckCount++;
          if (stuckCount >= 8) {
            return { success: false, stepsCompleted: stepNumber, finalUrl: currentUrl, stepLog: this.stepLog };
          }
        } else {
          stuckCount = 0;
        }
        previousPath = currentPath;

        const action = await this.performStepAction(currentPath);
        this.stepLog.push({ step: stepNumber, path: currentPath, action });

        await this.waitForNavigation(currentPath);
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

  private async waitForPageReady(): Promise<void> {
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForSelector('button:visible, input:visible, [role="button"]:visible', { timeout: 5000 }).catch(() => {});
  }

  private async waitForNavigation(previousPath: string): Promise<void> {
    try {
      await this.page.waitForFunction(
        (prev) => window.location.pathname !== prev,
        previousPath,
        { timeout: 3000 }
      );
      await this.page.waitForLoadState('domcontentloaded');
    } catch {
      await this.page.waitForTimeout(300);
    }
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

    if (filledInputs) {
      const newPath = new URL(this.page.url()).pathname;
      if (newPath !== currentPath) return 'filled-and-advanced';
      if (await this.clickContinueButton()) return 'filled-inputs-and-continued';
      if (await this.clickSubmitOrNext()) return 'filled-and-submitted';
      return 'filled-inputs';
    }

    if (await this.clickContinueButton()) {
      return 'clicked-continue';
    }

    const selectedOption = await this.clickQuizOption();
    if (selectedOption) {
      await this.page.waitForTimeout(500);
      const newPath = new URL(this.page.url()).pathname;
      if (newPath !== currentPath) return 'selected-option-auto-advanced';
      if (await this.clickContinueButton()) return 'selected-and-continued';
      return 'selected-option';
    }

    if (await this.clickSubmitOrNext()) {
      return 'clicked-submit';
    }

    return 'no-action';
  }

  private async clickSubmitOrNext(): Promise<boolean> {
    const submitSelectors = [
      'button[type="submit"]',
      'form button:visible',
      'button:has-text("Надіслати")',
      'button:has-text("Отримати")',
    ];

    for (const selector of submitSelectors) {
      try {
        const btn = this.page.locator(selector).first();
        if (await btn.isVisible({ timeout: 300 })) {
          if (!(await btn.isDisabled())) {
            await btn.click();
            return true;
          }
        }
      } catch {
        continue;
      }
    }
    return false;
  }

  private async handleModal(): Promise<string | null> {
    try {
      const parentOption = this.page.locator('text="Я — мати або батько"').first();
      if (await parentOption.isVisible({ timeout: 300 })) {
        await parentOption.click();
        return 'clicked-parent-option';
      }
    } catch {}

    try {
      const childOption = this.page.locator('text="Я — дитина"').first();
      if (await childOption.isVisible({ timeout: 300 })) {
        await childOption.click();
        return 'clicked-child-option';
      }
    } catch {}

    const modal = this.page.locator('[role="dialog"]').first();
    try {
      if (await modal.isVisible({ timeout: 300 })) {
        const modalText = await modal.textContent() || '';
        if (modalText.includes('+48') || modalText.includes('+380') || modalText.includes('+1')) {
          await this.page.keyboard.press('Escape');
          return null;
        }
        const modalItems = modal.locator('button, [role="button"]');
        const count = await modalItems.count();
        for (let i = 0; i < count; i++) {
          const item = modalItems.nth(i);
          const text = (await item.textContent())?.trim() || '';
          if (!text || text === '×' || text.length <= 1) continue;
          if (text.toLowerCase().includes('закрити') || text.toLowerCase().includes('close')) continue;
          await item.click();
          return `modal-selected: ${text.substring(0, 30)}`;
        }
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
      const digits = currentValue.replace(/\D/g, '');

      if (digits.length < 10) {
        await phoneInput.click();
        await this.page.waitForTimeout(200);
        const localNumber = this.userData.phone.replace(/^\+?380?/, '');
        await phoneInput.pressSequentially(localNumber, { delay: 40 });
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
      if (await genericInput.isVisible({ timeout: 300 }).catch(() => false)) {
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
        if (await btn.isVisible({ timeout: 500 })) {
          await btn.waitFor({ state: 'attached', timeout: 300 });
          if (!(await btn.isDisabled())) {
            await btn.click();
            return true;
          }
          await this.page.waitForFunction(
            (sel) => {
              const el = document.querySelector(sel) as HTMLButtonElement;
              return el && !el.disabled;
            },
            selector.replace(/:has-text\("([^"]+)"\)/, ''),
            { timeout: 2000 }
          ).catch(() => {});
          if (!(await btn.isDisabled())) {
            await btn.click();
            return true;
          }
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
        return true;
      } catch {
        continue;
      }
    }
    return false;
  }

  private async isVisible(selector: string): Promise<boolean> {
    try {
      return await this.page.locator(selector).first().isVisible({ timeout: 300 });
    } catch {
      return false;
    }
  }
}
