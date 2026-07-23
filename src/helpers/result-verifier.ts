import { Page } from '@playwright/test';

export interface VerificationResult {
  registrationCompleted: boolean;
  trialBooked: boolean;
  verificationMethod: 'ui' | 'network' | 'api';
  details: string;
}

export class ResultVerifier {
  private page: Page;
  private capturedResponses: CapturedResponse[] = [];

  constructor(page: Page) {
    this.page = page;
  }

  startCapturingNetworkCalls() {
    this.page.on('response', async (response) => {
      const url = response.url();
      const method = response.request().method();

      if (url.includes('stage.allright.com/api/')) {
        let responseBody: string | undefined;
        try {
          responseBody = await response.text();
        } catch {}

        this.capturedResponses.push({
          url,
          method,
          status: response.status(),
          postData: response.request().postData() || undefined,
          responseBody,
        });
      }
    });
  }

  async verifyBusinessResult(): Promise<VerificationResult> {
    const networkResult = this.verifyViaNetwork();
    if (networkResult.registrationCompleted && networkResult.trialBooked) {
      return networkResult;
    }

    const uiResult = await this.verifyViaUI();
    if (uiResult.registrationCompleted) {
      return uiResult;
    }

    return {
      registrationCompleted: networkResult.registrationCompleted || uiResult.registrationCompleted,
      trialBooked: networkResult.trialBooked || uiResult.trialBooked,
      verificationMethod: 'ui',
      details: `Network: ${networkResult.details}. UI: ${uiResult.details}`,
    };
  }

  private verifyViaNetwork(): VerificationResult {
    const userCreationCalls = this.capturedResponses.filter(
      (r) =>
        (r.url.includes('/users') || r.url.includes('/registration') || r.url.includes('/sign-up') || r.url.includes('/auth')) &&
        r.method === 'POST' &&
        r.status >= 200 &&
        r.status < 300
    );

    const bookingCalls = this.capturedResponses.filter(
      (r) =>
        (r.url.includes('/booking') || r.url.includes('/lesson') || r.url.includes('/trial') || r.url.includes('/schedule')) &&
        r.method === 'POST' &&
        r.status >= 200 &&
        r.status < 300
    );

    const registrationCompleted = userCreationCalls.length > 0;
    const trialBooked = bookingCalls.length > 0;

    return {
      registrationCompleted,
      trialBooked,
      verificationMethod: 'network',
      details: `User creation calls: ${userCreationCalls.length}, Booking calls: ${bookingCalls.length}. ` +
        `All captured: ${this.capturedResponses.filter((r) => r.url.includes('stage.allright.com')).map((r) => `${r.method} ${r.url.split('/api/')[1] || r.url} → ${r.status}`).join('; ')}`,
    };
  }

  private async verifyViaUI(): Promise<VerificationResult> {
    const currentUrl = this.page.url();
    const currentPath = new URL(currentUrl).pathname;

    const successPathPatterns = ['success', 'thank', 'complete', 'confirmation', 'dashboard', 'booking', 'lesson', 'login'];
    const hasSuccessPath = successPathPatterns.some((p) => currentPath.includes(p));

    const pageText = await this.page.locator('body').textContent().catch(() => '') || '';
    const successTextPatterns = [
      'дякуємо', 'вітаємо', 'заброньовано', 'урок заброньований',
      'готово', 'успішно', 'реєстрація завершена', 'ваш урок',
      'thank you', 'booked', 'confirmed', 'congratulations',
    ];
    const hasSuccessText = successTextPatterns.some((p) => pageText.toLowerCase().includes(p));

    const hasSuccessElement = await this.page.locator('[class*="success"], [class*="complete"], [class*="confirm"], [data-testid*="success"]')
      .first()
      .isVisible({ timeout: 2000 })
      .catch(() => false);

    const registrationCompleted = hasSuccessPath || hasSuccessText || hasSuccessElement;

    return {
      registrationCompleted,
      trialBooked: registrationCompleted,
      verificationMethod: 'ui',
      details: `Path match: ${hasSuccessPath}, Text match: ${hasSuccessText}, Element match: ${hasSuccessElement}. URL: ${currentUrl}`,
    };
  }

  getCapturedApiCalls(): CapturedResponse[] {
    return this.capturedResponses.filter((r) => r.url.includes('stage.allright.com'));
  }
}

interface CapturedResponse {
  url: string;
  method: string;
  status: number;
  postData?: string;
  responseBody?: string;
}
