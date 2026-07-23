import { chromium, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

const QUIZ_URL = 'https://stage.allright.com/uk/app/sign-up/long/charlie/age-range';
const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');

async function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function getPageElements(page: Page) {
  return await page.evaluate(() => {
    const elements: any[] = [];

    document.querySelectorAll('button, [role="button"]').forEach((el) => {
      const text = (el as HTMLElement).innerText?.trim();
      if (!text) return;
      elements.push({
        type: 'button',
        text: text.substring(0, 100),
        dataTestId: el.getAttribute('data-testid') || el.getAttribute('data-test') || null,
        classes: el.className?.toString().substring(0, 200),
        disabled: (el as HTMLButtonElement).disabled || false,
        ariaLabel: el.getAttribute('aria-label'),
      });
    });

    document.querySelectorAll('input, select, textarea').forEach((el) => {
      const input = el as HTMLInputElement;
      elements.push({
        type: 'input',
        tag: el.tagName.toLowerCase(),
        inputType: input.type,
        name: input.name,
        placeholder: input.placeholder,
        value: input.value,
        dataTestId: el.getAttribute('data-testid') || el.getAttribute('data-test') || null,
        required: input.required,
        ariaLabel: el.getAttribute('aria-label'),
      });
    });

    document.querySelectorAll('[role="radio"], [role="checkbox"], [role="option"]').forEach((el) => {
      elements.push({
        type: 'choice',
        role: el.getAttribute('role'),
        text: (el as HTMLElement).innerText?.trim().substring(0, 100),
        ariaChecked: el.getAttribute('aria-checked'),
        dataTestId: el.getAttribute('data-testid') || el.getAttribute('data-test') || null,
      });
    });

    const headings: string[] = [];
    document.querySelectorAll('h1, h2, h3, h4, p').forEach((el) => {
      const text = (el as HTMLElement).innerText?.trim();
      if (text && text.length > 2 && text.length < 200) {
        headings.push(`[${el.tagName}] ${text}`);
      }
    });

    const currentPath = window.location.pathname;
    return { elements, headings, currentPath, title: document.title };
  });
}

async function fillInputIfPresent(page: Page): Promise<boolean> {
  let filled = false;


  const emailInput = page.locator('input[type="email"], input[name*="email"], input[placeholder*="mail"], input[placeholder*="Email"]').first();
  if (await emailInput.isVisible({ timeout: 1000 }).catch(() => false)) {
    const timestamp = Date.now();
    await emailInput.fill(`test.quiz.${timestamp}@example.com`);
    filled = true;
  }


  const phoneInput = page.locator('input[type="tel"], input[name*="phone"], input[placeholder*="телефон"], input[placeholder*="phone"]').first();
  if (await phoneInput.isVisible({ timeout: 1000 }).catch(() => false)) {
    await phoneInput.fill('+380991234567');
    filled = true;
  }


  const nameInput = page.locator('input[name*="name"], input[placeholder*="ім\'я"], input[placeholder*="name"], input[placeholder*="Ім\'я"]').first();
  if (await nameInput.isVisible({ timeout: 1000 }).catch(() => false)) {
    await nameInput.fill('Test Child');
    filled = true;
  }


  if (!filled) {
    const textInput = page.locator('input[type="text"]:visible, input:not([type]):visible').first();
    if (await textInput.isVisible({ timeout: 1000 }).catch(() => false)) {
      await textInput.fill('Test');
      filled = true;
    }
  }

  return filled;
}

async function main() {
  await ensureDir(SCREENSHOTS_DIR);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'uk-UA',
  });
  const page = await context.newPage();

  const apiCalls: { url: string; method: string; status?: number; body?: string }[] = [];

  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('stage.allright.com/api/') || url.includes('/graphql')) {
      let body: string | undefined;
      try {
        if (response.request().method() === 'POST') {
          body = response.request().postData()?.substring(0, 500) || undefined;
        }
      } catch {}
      apiCalls.push({
        url: url.substring(0, 300),
        method: response.request().method(),
        status: response.status(),
        body,
      });
    }
  });

  console.log('Opening quiz:', QUIZ_URL);
  await page.goto(QUIZ_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  const steps: any[] = [];
  let stepNumber = 0;
  let previousPath = '';
  let stuckCount = 0;
  const MAX_STEPS = 30;

  while (stepNumber < MAX_STEPS) {
    stepNumber++;
    await page.waitForTimeout(2000);

    const currentUrl = page.url();
    if (currentUrl === 'about:blank') {
      console.log('  Navigated to blank page, going back');
      await page.goBack();
      await page.waitForTimeout(2000);
      continue;
    }

    const pageData = await getPageElements(page);
    const currentPath = pageData.currentPath;

    const screenshotPath = path.join(SCREENSHOTS_DIR, `step-${String(stepNumber).padStart(2, '0')}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    const stepInfo = {
      step: stepNumber,
      url: currentUrl,
      path: currentPath,
      headings: pageData.headings,
      buttons: pageData.elements.filter((e: any) => e.type === 'button'),
      inputs: pageData.elements.filter((e: any) => e.type === 'input'),
      choices: pageData.elements.filter((e: any) => e.type === 'choice'),
    };
    steps.push(stepInfo);

    console.log(`\nStep ${stepNumber}: ${currentPath}`);
    console.log(`   Text: ${pageData.headings.slice(0, 3).join(' | ')}`);
    console.log(`   Buttons: ${stepInfo.buttons.map((b: any) => b.text).join(', ')}`);
    console.log(`   Inputs: ${stepInfo.inputs.length}, Choices: ${stepInfo.choices.length}`);

    if (
      currentPath.includes('success') ||
      currentPath.includes('thank') ||
      currentPath.includes('complete') ||
      currentPath.includes('confirmation') ||
      currentPath.includes('dashboard') ||
      currentPath.includes('booking') ||
      pageData.headings.some((h: string) =>
        h.toLowerCase().includes('дякуємо') ||
        h.toLowerCase().includes('вітаємо') ||
        h.toLowerCase().includes('урок заброньован') ||
        h.toLowerCase().includes('готово')
      )
    ) {
      console.log('\nReached completion page!');
      break;
    }

    if (currentPath === previousPath) {
      stuckCount++;
      if (stuckCount >= 4) {
        console.log('\nStuck, stopping.');
        break;
      }
    } else {
      stuckCount = 0;
    }
    previousPath = currentPath;

    const filledInput = await fillInputIfPresent(page);
    if (filledInput) {
      console.log('   → Filled input fields');
      await page.waitForTimeout(500);
    }

    const quizButtons = page.locator('button:visible').filter({ hasNot: page.locator('[aria-label="back"], [aria-label="назад"]') });
    const buttonCount = await quizButtons.count();

    if (buttonCount > 0) {
      let clicked = false;

      for (let i = 0; i < Math.min(buttonCount, 10); i++) {
        const btn = quizButtons.nth(i);
        const text = await btn.textContent().catch(() => '');
        const classes = await btn.getAttribute('class') || '';

        if (!text?.trim() || text?.trim().length === 0) continue;
        if (text?.toLowerCase().includes('назад') || text?.toLowerCase().includes('back')) continue;

        try {
          await btn.click();
          console.log(`   → Clicked: "${text?.trim().substring(0, 40)}"`);
          clicked = true;
          break;
        } catch {
          continue;
        }
      }

      if (!clicked) {
        console.log('   → No valid button to click');
      }
    }

    await page.waitForTimeout(1500);
  }

  const report = { quizUrl: QUIZ_URL, totalSteps: steps.length, steps, apiCalls, timestamp: new Date().toISOString() };
  const reportPath = path.join(__dirname, 'exploration-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log(`\nReport: ${reportPath}`);
  console.log(`API calls: ${apiCalls.length}`);
  apiCalls.filter(c => c.url.includes('stage.allright.com')).forEach((call) => {
    console.log(`  ${call.method} ${call.url} → ${call.status}`);
    if (call.body) console.log(`     Body: ${call.body.substring(0, 100)}`);
  });

  await browser.close();
}

main().catch(console.error);
